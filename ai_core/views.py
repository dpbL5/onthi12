import os
import json
import zipfile
import tempfile
import docx
import hashlib
import re

from django.core.cache import cache
import time
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import ValidationError
from rest_framework import status
from pgvector.django import L2Distance

from .models import DocumentChunk, Document, ClassInsight
from classes.models import Class
from .serializers import DocumentSerializer
from rest_framework.parsers import MultiPartParser, JSONParser
from rest_framework import permissions
from exams.models import Question, Option, Quiz, QuizQuestion
from exams.views import IsTeacherOrAdmin
from .services.ai_generator import AIGeneratorService
from .services.ai_provider import get_client
from .services.cloudinary_service import delete_from_cloudinary
from django.utils import timezone
from datetime import timedelta

AI_TUTOR_MODEL = os.environ.get('AI_TUTOR_MODEL_NAME', 'gpt-4.1')
AI_EXTRACTION_MODEL = os.environ.get('AI_EXTRACTION_MODEL_NAME', 'gpt-4.1')
ai_client = get_client()

class RAGChatbotView(APIView):
    """
    API Chatbot sử dụng kiến trúc RAG tích hợp file docx giảng dạy của nhà trường.
    """
    permission_classes = [IsAuthenticated]

    @staticmethod
    def _make_chat_cache_key(class_id, question):
        normalized_question = re.sub(r'\s+', ' ', str(question or '')).strip().lower()
        digest = hashlib.sha256(f"{class_id}|{normalized_question}".encode('utf-8')).hexdigest()
        return f"ai_tro_giang:chat:{digest}"

    def post(self, request):
        if not ai_client.is_configured():
            return Response({"error": "Chưa cấu hình AI API key trên server."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        class_id = request.data.get('class_id')
        question = request.data.get('question')

        if not class_id or not question:
            raise ValidationError("Vui lòng gửi đầy đủ 'class_id' và 'question'.")

        # --- Rate Limiting: 1 minute per question ---
        user_id = request.user.id
        cache_key = f"ai_tro_giang_last_chat_{user_id}"
        last_chat_time = cache.get(cache_key)
        
        if last_chat_time:
            wait_seconds = int(60 - (time.time() - last_chat_time))
            if wait_seconds > 0:
                return Response({
                    "error": f"Vui lòng đợi {wait_seconds} giây trước khi gửi câu hỏi tiếp theo.",
                    "wait_seconds": wait_seconds
                }, status=status.HTTP_429_TOO_MANY_REQUESTS)

        # Set new timestamp in cache
        cache.set(cache_key, time.time(), timeout=60)

        try:
            # Xác thực user có quyền vào lớp không
            classroom = Class.objects.get(id=class_id)
            user = request.user
            if getattr(user.role, 'name', None) == 'student':
                if not classroom.class_students.filter(student=user).exists():
                    return Response({"error": "Bạn không học lớp này!"}, status=status.HTTP_403_FORBIDDEN)
        except Class.DoesNotExist:
            return Response({"error": "Lớp học không tồn tại."}, status=status.HTTP_404_NOT_FOUND)

        try:
            response_cache_key = self._make_chat_cache_key(class_id=class_id, question=question)
            cached_answer = cache.get(response_cache_key)
            if isinstance(cached_answer, dict):
                return Response(cached_answer)

            # CẬP NHẬT: Gọi AIGeneratorService Optimize NotebookLM RAG
            chatbot_answer = AIGeneratorService.chat_with_tutor(class_id, question)
            
            payload = {
                "answer": chatbot_answer,
                "sources": [{"doc": "Kiến thức nội bộ lớp học"}]
            }
            cache.set(response_cache_key, payload, timeout=180)

            return Response(payload)

        except Exception as e:
            return Response({"error": f"Lỗi AI Core: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class AIClassInsightView(APIView):
    """
    Quản lý báo cáo AI Insight của lớp học.
    - GET: Lấy báo cáo hiện tại, kèm thông tin có được phép tạo mới không (5 ngày/lần).
    - POST: Yêu cầu tạo báo cáo mới (nếu đủ điều kiện).
    """
    permission_classes = [IsAuthenticated]

    def _check_permission(self, request):
        role_name = getattr(request.user.role, 'name', None)
        if role_name not in ['teacher', 'admin'] and not request.user.is_superuser:
            raise ValidationError("Chỉ giáo viên mới có quyền xem báo cáo AI Insight.")

    def get(self, request):
        self._check_permission(request)
        class_id = request.query_params.get('class_id')
        if not class_id:
            return Response({"error": "Thiếu class_id."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            insight = ClassInsight.objects.get(classroom_id=class_id)
            days_since_update = (timezone.now() - insight.updated_at).days
            can_generate = days_since_update >= 5
            days_remaining = max(0, 5 - days_since_update)
            
            return Response({
                "insight": insight.content,
                "updated_at": insight.updated_at,
                "can_generate": can_generate,
                "days_remaining": days_remaining
            })
        except ClassInsight.DoesNotExist:
            return Response({
                "insight": None,
                "can_generate": True,
                "days_remaining": 0
            })

    def post(self, request):
        self._check_permission(request)
        
        class_id = request.data.get('class_id')
        data = request.data.get('analytics_data')
        class_name = request.data.get('class_name', 'Lớp học')

        if not class_id or not data:
            return Response({"error": "Thiếu class_id hoặc dữ liệu phân tích."}, status=status.HTTP_400_BAD_REQUEST)

        # Kiểm tra Rate Limit 5 ngày
        try:
            insight = ClassInsight.objects.get(classroom_id=class_id)
            days_since_update = (timezone.now() - insight.updated_at).days
            if days_since_update < 5:
                days_remaining = 5 - days_since_update
                return Response({
                    "error": f"Bạn chỉ có thể cập nhật Insight 5 ngày 1 lần. Vui lòng thử lại sau {days_remaining} ngày."
                }, status=status.HTTP_429_TOO_MANY_REQUESTS)
        except ClassInsight.DoesNotExist:
            pass # Chưa có thì cho phép tạo

        try:
            system_prompt = f"""
Bạn là chuyên gia phân tích giáo dục của NVH Learning. 
Hãy phân tích dữ liệu kết quả học tập của lớp {class_name} dưới đây và đưa ra báo cáo ngắn gọn, súc tích.

DỮ LIỆU THỐNG KÊ:
{json.dumps(data, indent=2, ensure_ascii=False)}

YÊU CẦU BÁO CÁO:
1. Nhận xét tổng quan về phổ điểm (Khá, Giỏi, Trung bình).
2. Chỉ ra các "Lỗ hổng kiến thức" - những câu hỏi hoặc chủ đề mà nhiều học sinh làm sai nhất. Đưa ra nguyên nhân có thể dạng giả thuyết.
3. Đề xuất hành động cho giáo viên (ví dụ: cần ôn lại chương nào, khen thưởng nhóm học sinh nào).
4. SỬ DỤNG MARKDOWN:
   - Dùng heading (#, ##, ###) để phân chia cấu trúc rõ ràng.
   - Dùng in đậm (**text**) cho các ý chính.
   - Viết các công thức (nếu có) bằng định dạng LaTeX (ví dụ: $E=mc^2$ hoặc $$x = \\frac{{-b \\pm \\sqrt{{\\Delta}}}}{{2a}}$$).
   - Ngôn ngữ chuyên nghiệp, khuyến khích.

BÁO CÁO:
"""
            response = ai_client.generate_content(system_prompt)

            # Cập nhật đè lên database
            insight, created = ClassInsight.objects.update_or_create(
                classroom_id=class_id,
                defaults={'content': response.text}
            )

            return Response({
                "insight": insight.content,
                "updated_at": insight.updated_at,
                "can_generate": False,
                "days_remaining": 5
            })
        except Exception as e:
            return Response({"error": f"Lỗi AI Insight: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class ClassDocumentListView(APIView):
    """Lấy danh sách tài liệu RAG của một lớp học."""
    permission_classes = [IsAuthenticated]

    def get(self, request, class_id):
        try:
            classroom = Class.objects.get(id=class_id)
        except Class.DoesNotExist:
            return Response({"error": "Lớp học không tồn tại."}, status=status.HTTP_404_NOT_FOUND)
        
        # Verify access
        user = request.user
        role_name = getattr(user.role, 'name', None)
        if role_name == 'student':
            if not classroom.class_students.filter(student=user).exists():
                return Response({"error": "Bạn không học lớp này!"}, status=status.HTTP_403_FORBIDDEN)
        
        docs = Document.objects.filter(classroom=classroom).order_by('-uploaded_at')
        serializer = DocumentSerializer(docs, many=True)
        return Response(serializer.data)

class UploadClassDocumentView(APIView):
    """Giáo viên upload tài liệu, dùng Gemini bóc tách văn bản và tạo Vector Embeddings lưu vào DB."""
    permission_classes = [IsAuthenticated]

    def post(self, request, class_id):
        user = request.user
        role_name = getattr(user.role, 'name', None)
        if role_name not in ['teacher', 'admin'] and not user.is_superuser:
            return Response({"error": "Chỉ giáo viên mới có quyền upload tài liệu RAG."}, status=status.HTTP_403_FORBIDDEN)

        try:
            classroom = Class.objects.get(id=class_id)
        except Class.DoesNotExist:
            return Response({"error": "Lớp học không tồn tại."}, status=status.HTTP_404_NOT_FOUND)

        file_obj = request.FILES.get('file')
        if not file_obj:
            return Response({"error": "Vui lòng đính kèm file."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            ext = os.path.splitext(file_obj.name)[1]
            with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp_file:
                for chunk in file_obj.chunks():
                    tmp_file.write(chunk)
                tmp_file_path = tmp_file.name

            # CẬP NHẬT: Sử dụng Optimize 1-Shot của AIGeneratorService
            # Upload lên Cloudinary trước khi tạo record Document
            from .services.cloudinary_service import upload_to_cloudinary
            cloudinary_res = upload_to_cloudinary(tmp_file_path, file_name=file_obj.name, resource_type='raw')
            
            doc_obj = Document.objects.create(
                classroom=classroom,
                title=file_obj.name,
                # Note: We omit 'file=file_obj' because Vercel file system is read-only.
                # All documents are now managed via Cloudinary (see file_url below).
                file_url=cloudinary_res.get('secure_url') if cloudinary_res else None,
                cloudinary_public_id=cloudinary_res.get('public_id') if cloudinary_res else None
            )

            try:
                extraction_result = AIGeneratorService.ingest_document(tmp_file_path, doc_obj.id)
                os.remove(tmp_file_path)
                
                serializer = DocumentSerializer(doc_obj)
                response_data = serializer.data
                response_data['knowledge_chunks_count'] = extraction_result.get('knowledge_chunks_count', 0)
                response_data['questions_extracted'] = len(extraction_result.get('questions', []))
                
                return Response(response_data, status=status.HTTP_201_CREATED)
            except Exception as ai_err:
                # Nếu lỗi trích xuất AI, xoá cả bản ghi DB và file trên Cloudinary
                if doc_obj.cloudinary_public_id:
                    delete_from_cloudinary(doc_obj.cloudinary_public_id, resource_type='raw')
                doc_obj.delete()
                if os.path.exists(tmp_file_path):
                    os.remove(tmp_file_path)
                return Response({"error": f"Lỗi xử lý hệ thống AI: {str(ai_err)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        except Exception as e:
            return Response({"error": f"Lỗi upload: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class DeleteClassDocumentView(APIView):
    """Giáo viên xoá tài liệu RAG, các chunks tự động cascade."""
    permission_classes = [IsAuthenticated]

    def delete(self, request, doc_id):
        user = request.user
        role_name = getattr(user.role, 'name', None)
        if role_name not in ['teacher', 'admin'] and not user.is_superuser:
            return Response({"error": "Chỉ giáo viên mới có quyền xoá tài liệu."}, status=status.HTTP_403_FORBIDDEN)
            
        try:
            doc = Document.objects.get(id=doc_id)
            # Xoá file trên Cloudinary trước
            if doc.cloudinary_public_id:
                delete_from_cloudinary(doc.cloudinary_public_id, resource_type='raw')
            
            doc.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        except Document.DoesNotExist:
            return Response({"error": "Không tìm thấy tài liệu."}, status=status.HTTP_404_NOT_FOUND)


# ─── AI QUESTION GENERATOR VIEWS ────────────────────────────────────────────

class AIExtractFromFileView(APIView):
    """Nhận file upload hoặc URL, trích xuất câu hỏi qua AI."""
    permission_classes = [IsAuthenticated, IsTeacherOrAdmin]
    parser_classes = [MultiPartParser, JSONParser]

    def post(self, request):
        files_data = request.data.get('files')
        file_obj = request.FILES.get('file')
        file_url = request.data.get('file_url')
        file_name = request.data.get('file_name', 'downloaded_file.docx')
        subject_id = request.data.get('subject_id')
        subject_name = ""
        
        if subject_id:
            try:
                from classes.models import Subject
                subject_name = Subject.objects.get(id=subject_id).name
            except Exception:
                pass

        import tempfile
        import os
        import traceback as tb
        to_process = []
        if files_data and isinstance(files_data, list):
            to_process = files_data
        elif file_url:
            to_process.append({'file_url': file_url, 'file_name': file_name})
        elif file_obj:
            to_process.append({'file_obj': file_obj})

        if not to_process:
            return Response({"error": "No files provided."}, status=status.HTTP_400_BAD_REQUEST)

        import requests
        import mimetypes
        from requests.adapters import HTTPAdapter
        from urllib3.util.retry import Retry

        # Configure retry strategy
        retry_strategy = Retry(
            total=3,
            backoff_factor=1,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["HEAD", "GET", "OPTIONS"]
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        http_session = requests.Session()
        http_session.mount("https://", adapter)
        http_session.mount("http://", adapter)

        all_questions = []
        all_images_map = {}

        try:
            for item in to_process:
                tmp_file_path = None
                try:
                    target_file_obj = item.get('file_obj')
                    target_file_url = item.get('file_url')
                    target_file_name = item.get('file_name', 'downloaded.docx')

                    if target_file_obj:
                        ext = os.path.splitext(target_file_obj.name)[1]
                        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp_file:
                            for chunk in target_file_obj.chunks():
                                tmp_file.write(chunk)
                            tmp_file_path = tmp_file.name
                        mime_type = target_file_obj.content_type
                    elif target_file_url:
                        ext = os.path.splitext(target_file_name)[1]
                        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp_file:
                            # Use custom session with retries and timeout
                            resp = http_session.get(target_file_url, stream=True, timeout=30)
                            resp.raise_for_status()
                            for chunk in resp.iter_content(chunk_size=8192):
                                tmp_file.write(chunk)
                            tmp_file_path = tmp_file.name
                        mime_type, _ = mimetypes.guess_type(target_file_name)
                        if not mime_type:
                            mime_type = 'application/octet-stream'

                    if tmp_file_path:
                        questions_data, images_map = AIGeneratorService.extract_from_file(
                            file_path=tmp_file_path,
                            mime_type=mime_type,
                            subject_name=subject_name
                        )
                        all_questions.extend(questions_data)
                        all_images_map.update(images_map)
                        all_images_map.update(images_map)

                finally:
                    if tmp_file_path and os.path.exists(tmp_file_path):
                        try:
                            os.remove(tmp_file_path)
                        except Exception:
                            pass
                    
                    # Cleanup from Cloudinary to save space
                    p_id = item.get('public_id')
                    r_type = item.get('resource_type', 'raw')
                    if p_id:
                        print(f"Triggering Cloudinary cleanup for {p_id} ({r_type})...")
                        delete_from_cloudinary(p_id, resource_type=r_type)
            # DEDUPLICATION LOGIC: Remove duplicate extracted questions
            unique_questions = []
            seen_hashes = set()
            for q in all_questions:
                # Build a signature for the question to catch duplicates
                content_json = q.get('content_json', [])
                
                text_parts = [(q.get('text') or '').strip()]
                text_parts.extend([str(b.get('value', '')) for b in content_json if isinstance(b, dict) and b.get('type') == 'text'])
                text_parts.extend([str(b.get('sha256', '')) for b in content_json if isinstance(b, dict) and b.get('type') == 'image'])
                
                if q.get('image'):
                    text_parts.append(str(q.get('image')))
                
                options = q.get('options', [])
                for opt in options:
                    opt_content = opt.get('content_json', [])
                    text_parts.append((opt.get('text') or '').strip())
                    text_parts.extend([str(b.get('value', '')) for b in opt_content if isinstance(b, dict) and b.get('type') == 'text'])
                    text_parts.extend([str(b.get('sha256', '')) for b in opt_content if isinstance(b, dict) and b.get('type') == 'image'])
                    text_parts.append(str(opt.get('is_correct', False)))
                
                if q.get('correct_answer_text'):
                    text_parts.append(str(q.get('correct_answer_text')).strip())
                    
                raw_sig = "||".join(text_parts)
                normalized_sig = re.sub(r'\s+', ' ', raw_sig).strip().lower()
                sig_hash = hashlib.md5(normalized_sig.encode('utf-8')).hexdigest()
                
                if sig_hash not in seen_hashes:
                    seen_hashes.add(sig_hash)
                    unique_questions.append(q)

            return Response({"questions": unique_questions, "images": all_images_map})
        except Exception as e:
            tb.print_exc()
            msg = str(e)
            if "429" in msg or "quota" in msg.lower():
                msg = "AI hiện đang bận hoặc hết hạn mức (Quota exceeded)."
            return Response({"error": msg}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class AIGenerateFromRAGView(APIView):
    """Sinh câu hỏi từ tri thức nội bộ (RAG) của lớp học."""
    permission_classes = [IsAuthenticated, IsTeacherOrAdmin]

    def post(self, request):
        class_id = request.data.get('class_id')
        topic = request.data.get('topic', '')
        count = int(request.data.get('count', 5))
        difficulty = request.data.get('difficulty', 'medium')
        question_types = request.data.get('question_types', 'multiple_choice')
        document_id = request.data.get('document_id')  # Tuỳ chọn: Lọc theo 1 tài liệu cụ thể

        if not class_id:
            return Response({"error": "Thiếu class_id."}, status=status.HTTP_400_BAD_REQUEST)
        if not topic.strip():
            return Response({"error": "Thiếu chủ đề (topic)."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            questions_data = AIGeneratorService.generate_from_rag(
                topic=topic,
                count=count,
                difficulty=difficulty,
                class_id=class_id,
                question_types=question_types,
                document_id=document_id,
            )
            return Response({"questions": questions_data})

        except Exception as e:
            msg = str(e)
            if "429" in msg or "quota" in msg.lower():
                msg = "Hệ thống AI đạt giới hạn (429). Hãy đợi một lát hoặc giảm số lượng câu hỏi cần sinh."
            return Response({"error": msg}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class AIBulkSaveQuestionsView(APIView):
    """
    Nhận danh sách câu hỏi (đã review) từ client, lưu vào DB.
    Hỗ trợ cả 3 dạng question_type. Optionally chèn vào Quiz.
    Xử lý việc liên kết khối Image (qua SHA-256) vào QuestionImage.
    """
    permission_classes = [IsAuthenticated, IsTeacherOrAdmin]

    def post(self, request):
        questions_data = request.data.get('questions', [])
        quiz_id = request.data.get('quiz_id')
        subject_id = request.data.get('subject_id')

        if not questions_data or not subject_id:
            return Response(
                {"error": "Missing questions or subject_id."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            from classes.models import Subject
            from exams.models import ImageBank, QuestionImage
            subject = Subject.objects.get(id=subject_id)
            quiz = Quiz.objects.get(id=quiz_id) if quiz_id else None

            saved_questions = []
            rejected_questions = []

            for index, q_data in enumerate(questions_data):
                q_type = q_data.get('question_type', 'multiple_choice')
                content_json = q_data.get('content_json', [])
                if not isinstance(content_json, list):
                    content_json = []

                normalized_text = (q_data.get('text', '') or '').strip()
                if not normalized_text:
                    normalized_text = self._blocks_to_text(content_json)

                if not normalized_text and not self._has_image_block(content_json):
                    rejected_questions.append({
                        'index': index,
                        'reason': 'missing_question_content',
                    })
                    continue

                # 1. Tạo Question
                question = Question.objects.create(
                    question_type=q_type,
                    text=normalized_text,
                    content_json=content_json,
                    image=q_data.get('image', ''),
                    context=q_data.get('context', '') or '',
                    correct_answer_text=q_data.get('correct_answer_text', '') or '',
                    explanation=q_data.get('explanation', '') or '',
                    subject=subject,
                    difficulty=q_data.get('difficulty', 'medium'),
                    created_by=request.user,
                )

                # 1.1 Quét ImageBlock trong Question.stem
                self._link_images(question, content_json, placement='stem', uploaded_by=request.user)

                # 2. Tạo Options (cho multiple_choice và true_false)
                if q_type in ('multiple_choice', 'true_false'):
                    for opt_idx, opt in enumerate(q_data.get('options', [])):
                        opt_content = opt.get('content_json', [])
                        if not isinstance(opt_content, list):
                            opt_content = []
                        opt_text = (opt.get('text', '') or '').strip()
                        if not opt_text:
                            opt_text = self._blocks_to_text(opt_content)

                        option = Option.objects.create(
                            question=question,
                            text=opt_text,
                            content_json=opt_content,
                            is_correct=opt.get('is_correct', False),
                        )
                        # Quét ImageBlock trong từng phương án
                        self._link_images(question, opt_content, placement=f'choice_{opt_idx}', uploaded_by=request.user)

                # 3. Chèn vào Quiz nếu có
                if quiz:
                    max_order = QuizQuestion.objects.filter(quiz=quiz).count()
                    QuizQuestion.objects.create(
                        quiz=quiz,
                        question=question,
                        order=max_order + 1,
                        points=0.0,
                    )

                    quiz_questions = list(
                        QuizQuestion.objects.filter(quiz=quiz).order_by('order')
                    )
                    total_questions = len(quiz_questions)
                    if total_questions > 0:
                        points_per_question = round(10.0 / total_questions, 2)
                        for qq in quiz_questions:
                            qq.points = points_per_question
                        QuizQuestion.objects.bulk_update(quiz_questions, ['points'])

                saved_questions.append(question.id)

            return Response({
                "detail": f"Đã lưu thành công {len(saved_questions)} câu hỏi.",
                "saved_ids": saved_questions,
                "rejected": rejected_questions,
            })

        except Exception as e:
            msg = str(e)
            if "429" in msg or "quota" in msg.lower():
                msg = "Có lỗi xảy ra khi gọi AI. Vui lòng kiểm tra lại kết nối hoặc hạn mức API."
            return Response({"error": msg}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def _link_images(self, question, content_json, placement, uploaded_by=None):
        """Duyệt JSON blocks, nếu có type=image, link vào QuestionImage."""
        from exams.models import ImageBank, QuestionImage
        
        if not isinstance(content_json, list):
            return

        pos = 0
        for block in content_json:
            if block.get('type') == 'image':
                sha256_hash = block.get('sha256')
                direct_url = block.get('url')
                
                if sha256_hash:
                    try:
                        img_bank = ImageBank.objects.get(sha256=sha256_hash)
                        QuestionImage.objects.get_or_create(
                            question=question,
                            image=img_bank,
                            position=pos,
                            placement=placement,
                            defaults={
                                'source_type': 'ai_scan',
                                'uploaded_by': uploaded_by,
                            },
                        )
                        pos += 1
                    except ImageBank.DoesNotExist:
                        # Fallback: Nếu không có ImageBank nhưng có URL trong block
                        if direct_url:
                            QuestionImage.objects.create(
                                question=question,
                                image_url=direct_url,
                                position=pos,
                                placement=placement,
                                source_type='ai_scan',
                                uploaded_by=uploaded_by
                            )
                            pos += 1
                elif direct_url:
                    # Trường hợp chỉ có URL (vd: AI sinh từ RAG hoặc URL trực tiếp)
                    QuestionImage.objects.create(
                        question=question,
                        image_url=direct_url,
                        position=pos,
                        placement=placement,
                        source_type='ai_scan',
                        uploaded_by=uploaded_by
                    )
                    pos += 1

    def _blocks_to_text(self, blocks):
        if not isinstance(blocks, list):
            return ''
        parts = []
        for b in blocks:
            if isinstance(b, dict):
                if b.get('type') == 'text' and isinstance(b.get('value'), str):
                    parts.append(b.get('value'))
                elif b.get('type') == 'image' and b.get('sha256'):
                    parts.append(f"\n[IMAGE_PLACEHOLDER:{b.get('sha256')}]\n")
        return ' '.join(parts).strip()

    def _has_image_block(self, blocks):
        if not isinstance(blocks, list):
            return False
        return any(isinstance(b, dict) and b.get('type') == 'image' for b in blocks)

# ─── MẢNG 3: AI CÁ NHÂN HÓA ─────────────────────────────────────────────────

class AIPersonalizedPathView(APIView):
    """Đề xuất lộ trình học tập cá nhân hóa dựa trên kết quả các bài quiz."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        
        from exams.models import QuizAttempt, StudentAnswer
        attempts = QuizAttempt.objects.filter(student=user, is_completed=True).select_related('quiz')
        
        if not attempts.exists():
            return Response({"insight": "Bạn chưa hoàn thành bài thi nào để AI có thể phân tích lộ trình học tập. Hãy hoàn thành ít nhất 1 bài thi."})
            
        subject_stats = {}
        answers = StudentAnswer.objects.filter(attempt__in=attempts).select_related('quiz_question__question', 'quiz_question__question__subject')
        for ans in answers:
            q = ans.quiz_question.question
            subj = q.subject.name if q.subject else "Chung"
            is_corr = ans.is_correct()
            
            if subj not in subject_stats:
                subject_stats[subj] = {'total': 0, 'correct': 0}
            subject_stats[subj]['total'] += 1
            if is_corr:
                subject_stats[subj]['correct'] += 1
                
        prompt = f"""
Bạn là một gia sư AI tận tâm. Dựa trên dữ liệu dưới đây, hãy đề xuất một lộ trình học tập ngắn gọn, tập trung vào môn học có độ chính xác dưới 60%.
Dữ liệu học tập (Môn: Số câu đúng / Tổng số câu):
{json.dumps(subject_stats, ensure_ascii=False)}

YÊU CẦU BÁO CÁO:
1. Nhận xét ngắn gọn, khích lệ.
2. Đề xuất 2-3 bước hành động cụ thể.
3. Sử dụng Markdown (Heading, in đậm).
"""
        try:
            response = ai_client.generate_content(prompt)
            return Response({"insight": response.text})
        except Exception:
            return Response({"error": "Lỗi kết nối AI."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class AIGenerateQuickTestView(APIView):
    """Tạo nhanh 1 bài quiz ngẫu nhiên tập trung vào điểm yếu."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        try:
            from exams.models import Question, Quiz, QuizQuestion
            import random
            from django.utils import timezone
            
            # Logic: Collect questions the student got wrong recently
            from exams.models import StudentAnswer
            wrong_answers = StudentAnswer.objects.filter(attempt__student=user, attempt__is_completed=True).order_by('-id')[:50]
            wrong_questions = [ans.quiz_question.question for ans in wrong_answers if not ans.is_correct()]
            
            pool = list(set(wrong_questions))
            if len(pool) < 5:
                # Not enough wrong questions, pad with some random questions from DB
                pool.extend(list(Question.objects.all().order_by('?')[:10]))
                pool = list(set(pool))
                
            if not pool:
                return Response({"error": "Không có đủ câu hỏi trong ngân hàng để tạo Quick Test."}, status=status.HTTP_400_BAD_REQUEST)
                
            selected = random.sample(pool, min(10, len(pool)))
            
            quiz = Quiz.objects.create(
                title=f"Phục thù - Luyện tập thần tốc ngày {timezone.now().strftime('%d/%m')}",
                description="Bài kiểm tra tự động tạo ra từ phân tích điểm yếu của bạn, tập trung vào các câu bạn đã làm sai.",
                duration_minutes=len(selected) * 2,
                is_published=True
            )
            
            for idx, q in enumerate(selected):
                QuizQuestion.objects.create(
                    quiz=quiz,
                    question=q,
                    order=idx + 1,
                    points=round(10.0 / len(selected), 2)
                )
                
            return Response({"quiz_id": quiz.id, "message": "Quick Test đã sẵn sàng!"})
            
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
