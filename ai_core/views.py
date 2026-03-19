import os
import json
import zipfile
import tempfile
import docx
import google.generativeai as genai

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
from rest_framework.parsers import MultiPartParser
from rest_framework import permissions
from exams.models import Question, Option, Quiz, QuizQuestion
from exams.views import IsTeacherOrAdmin
from .services.ai_generator import AIGeneratorService
from django.utils import timezone
from datetime import timedelta

# Ensure API key is configured if available
api_key = os.environ.get('GEMINI_API_KEY')
if api_key:
    genai.configure(api_key=api_key)

class RAGChatbotView(APIView):
    """
    API Chatbot sử dụng kiến trúc RAG tích hợp file docx giảng dạy của nhà trường.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not api_key:
            return Response({"error": "Chưa cấu hình GEMINI_API_KEY trên server."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        class_id = request.data.get('class_id')
        question = request.data.get('question')

        if not class_id or not question:
            raise ValidationError("Vui lòng gửi đầy đủ 'class_id' và 'question'.")

        # --- Rate Limiting: 1 minute per question ---
        user_id = request.user.id
        cache_key = f"ai_tutor_last_chat_{user_id}"
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
            # Bước 1: Chuyển đổi câu hỏi thành Vector Embeddings
            embed_result = genai.embed_content(
                model="models/gemini-embedding-001",
                content=question,
                task_type="retrieval_query",
                output_dimensionality=768
            )
            query_embedding = embed_result['embedding']

            # Bước 2: Tìm kiếm gần tương đồng trên PostgreSQL Vector (pgvector)
            # Lấy 5 khối kiến thức có khoảng cách nhỏ nhất (nghĩa là sát nhất với câu hỏi)
            closest_chunks = DocumentChunk.objects.filter(
                document__classroom=classroom
            ).annotate(
                distance=L2Distance('embedding', query_embedding)
            ).order_by('distance')[:5]

            # Rút trích văn bản làm ngữ cảnh
            contexts = []
            sources = []
            for chunk in closest_chunks:
                contexts.append(f"Tài liệu [{chunk.document.title}]: {chunk.content}")
                if chunk.document.title not in [s['doc'] for s in sources]:
                    sources.append({"doc": chunk.document.title})

            context_text = "\n\n---\n\n".join(contexts)

            if not context_text:
                context_text = "Không có tài liệu nào trong lớp học này."

            # Bước 3: Tạo Prompt yêu cầu Gemini đóng vai gia sư, có ép Context vào
            system_prompt = f"""
Bạn là AI Gia sư tận tậm của Hệ thống NVH Learning. Bạn được kết nối bộ não với kho tài liệu học tập của nhà trường.
Nhiệm vụ của bạn là giải đáp thắc mắc CÂU HỎI của học sinh bằng cách sử dụng TÀI LIỆU TRÍCH XUẤT dưới đây.

LƯU Ý NGHIÊM NGẶT:
1. Bạn CHỈ trả lời dựa trên thông tin có trong TÀI LIỆU TRÍCH XUẤT.
2. Nếu TÀI LIỆU TRÍCH XUẤT không chứa thông tin để trả lời, HÃY TRẢ LỜI: "Tài liệu môn học của NVH Learning trong bài giảng chưa đề cập đến vấn đề này. Hãy hỏi lại giáo viên trên lớp nhé!"
3. Không được đoán mò hoặc tựa nạp kiến thức mạng ngoài vào để tránh sai sót sách giáo khoa nhà trường.
4. Trình bày thân thiện, động viên học sinh học tập, có format rõ ràng, dùng bullet point hoặc xuống dòng dễ đọc.

TÀI LIỆU TRÍCH XUẤT:
{context_text}

CÂU HỎI TỪ HỌC SINH: {question}
"""
            # Gọi LLM (Gemini Flash)
            model = genai.GenerativeModel('gemini-flash-latest')
            response = model.generate_content(system_prompt)

            return Response({
                "answer": response.text,
                "sources": sources
            })

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
            model = genai.GenerativeModel('gemini-flash-latest')
            response = model.generate_content(system_prompt)

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

            extracted_text = ""
            
            # --- Xử lý .docx: Trích text VÀ mô tả ảnh nhúng (cho RAG) ---
            if ext.lower() == '.docx':
                try:
                    print(f"Extracting text + images from DOCX: {tmp_file_path}")
                    doc_reader = docx.Document(tmp_file_path)
                    extracted_text = "\n".join([para.text for para in doc_reader.paragraphs if para.text.strip()])

                    # Trích ảnh nhúng, dùng Gemini mô tả từng ảnh, gắn vào text
                    image_descriptions = []
                    img_tmp_paths = []
                    try:
                        with zipfile.ZipFile(tmp_file_path, 'r') as z:
                            image_entries = [n for n in z.namelist() if n.startswith('word/media/')]
                            for entry in image_entries:
                                img_ext = os.path.splitext(entry)[1].lower()
                                if img_ext in ('.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'):
                                    img_data = z.read(entry)
                                    with tempfile.NamedTemporaryFile(delete=False, suffix=img_ext) as tmp_img:
                                        tmp_img.write(img_data)
                                        img_tmp_paths.append(tmp_img.name)

                        if img_tmp_paths:
                            print(f"  Found {len(img_tmp_paths)} embedded images. Describing with Gemini...")
                            img_model = genai.GenerativeModel('gemini-flash-latest')
                            for idx, img_path in enumerate(img_tmp_paths):
                                try:
                                    uploaded_img = genai.upload_file(path=img_path)
                                    desc_response = img_model.generate_content([
                                        uploaded_img,
                                        "Mô tả chi tiết nội dung của hình ảnh này (có thể là đồ thị, công thức, biểu đồ, mính họa...) theo ngôn ngữ Việt Nam, súc tích, chính xác."
                                    ])
                                    image_descriptions.append(f"[Hình ảnh {idx+1}]: {desc_response.text}")
                                    try:
                                        genai.delete_file(uploaded_img.name)
                                    except Exception:
                                        pass
                                except Exception as img_err:
                                    print(f"  Could not describe image {idx+1}: {img_err}")
                    finally:
                        for p in img_tmp_paths:
                            try:
                                os.remove(p)
                            except Exception:
                                pass

                    if image_descriptions:
                        extracted_text += "\n\n--- MÔ TẢ HÌNH ẢNH TRONG TÀI LIỆU ---\n" + "\n".join(image_descriptions)
                        print(f"  Appended {len(image_descriptions)} image descriptions to text.")

                except Exception as docx_err:
                    print(f"DOCX extraction failed: {str(docx_err)}")

            # --- Nếu chưa có text (hoặc không phải docx), dùng Gemini File API (PDF/Ảnh) ---
            if not extracted_text.strip():
                try:
                    print(f"Uploading file {tmp_file_path} to Gemini for text extraction...")
                    uploaded_file = genai.upload_file(path=tmp_file_path)

                    model_extract = genai.GenerativeModel('gemini-flash-latest')
                    prompt = "Hãy trích xuất lại toàn bộ văn bản và bảng biểu có trong tài liệu này một cách chính xác nhất. Đừng thêm bớt nội dung bình luận nào cả. Chỉ nguyên văn bản trong tài liệu."
                    response = model_extract.generate_content([uploaded_file, prompt])
                    extracted_text = response.text

                    try:
                        genai.delete_file(uploaded_file.name)
                    except Exception:
                        pass
                except Exception as gemini_err:
                    print(f"Gemini File API failed: {str(gemini_err)}")

            if not extracted_text.strip():
                os.remove(tmp_file_path)
                return Response({"error": "Không thể trích xuất văn bản từ tài liệu này (Gemini không hỗ trợ hoặc file lỗi)."}, status=status.HTTP_400_BAD_REQUEST)

            # Lưu Document object
            doc_obj = Document.objects.create(
                classroom=classroom,
                title=file_obj.name,
                file_path=file_obj.name # Tạm lưu tên file
            )

            # Chia văn bản thành các chunks và tính vector qua Gemini
            words = extracted_text.split()
            chunk_size = 300
            chunks = []
            for i in range(0, len(words), chunk_size):
                chunk = ' '.join(words[i:i + chunk_size])
                if len(chunk.strip()) > 0:
                    chunks.append(chunk)

            for idx, chunk_text in enumerate(chunks):
                embed_result = genai.embed_content(
                    model="models/gemini-embedding-001",
                    content=chunk_text,
                    task_type="retrieval_document",
                    output_dimensionality=768
                )
                embedding = embed_result['embedding']
                DocumentChunk.objects.create(
                    document=doc_obj,
                    chunk_index=idx,
                    content=chunk_text,
                    embedding=embedding
                )

            os.remove(tmp_file_path)
            
            serializer = DocumentSerializer(doc_obj)
            return Response(serializer.data, status=status.HTTP_201_CREATED)

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
            doc.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        except Document.DoesNotExist:
            return Response({"error": "Không tìm thấy tài liệu."}, status=status.HTTP_404_NOT_FOUND)


# ─── AI QUESTION GENERATOR VIEWS ────────────────────────────────────────────

class AIExtractFromFileView(APIView):
    """Nhận file upload, trích xuất câu hỏi qua AI (3 dạng THPT 2025)."""
    permission_classes = [IsAuthenticated, IsTeacherOrAdmin]
    parser_classes = [MultiPartParser]

    def post(self, request):
        file_obj = request.FILES.get('file')
        if not file_obj:
            return Response({"error": "No file provided."}, status=status.HTTP_400_BAD_REQUEST)

        import tempfile
        import os
        import traceback as tb

        tmp_file_path = None
        try:
            ext = os.path.splitext(file_obj.name)[1]
            with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp_file:
                for chunk in file_obj.chunks():
                    tmp_file.write(chunk)
                tmp_file_path = tmp_file.name

            questions_data = AIGeneratorService.extract_from_file(
                file_path=tmp_file_path,
                mime_type=file_obj.content_type,
            )
            return Response({"questions": questions_data})

        except Exception as e:
            # In traceback ra console của Django runserver để dễ debug
            tb.print_exc()
            msg = str(e)
            if "429" in msg or "quota" in msg.lower():
                msg = "AI hiện đang bận hoặc hết hạn mức (Quota exceeded). Vui lòng thử lại sau 1-2 phút."
            return Response({"error": msg}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        finally:
            # Luôn dọn file tạm dù thành công hay lỗi
            if tmp_file_path and os.path.exists(tmp_file_path):
                try:
                    os.remove(tmp_file_path)
                except Exception:
                    pass


class AIGenerateFromRAGView(APIView):
    """Sinh câu hỏi từ tri thức nội bộ (RAG) của lớp học."""
    permission_classes = [IsAuthenticated, IsTeacherOrAdmin]

    def post(self, request):
        class_id = request.data.get('class_id')
        topic = request.data.get('topic', '')
        count = int(request.data.get('count', 5))
        difficulty = request.data.get('difficulty', 'medium')
        question_types = request.data.get('question_types', 'multiple_choice')

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
                        points=1.0,
                    )

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
            if block.get('type') == 'image' and block.get('sha256'):
                sha256_hash = block.get('sha256')
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
                    pass # Image might have been deleted or skipped

    def _blocks_to_text(self, blocks):
        if not isinstance(blocks, list):
            return ''
        parts = []
        for b in blocks:
            if isinstance(b, dict) and b.get('type') == 'text' and isinstance(b.get('value'), str):
                parts.append(b.get('value'))
        return ' '.join(parts).strip()

    def _has_image_block(self, blocks):
        if not isinstance(blocks, list):
            return False
        return any(isinstance(b, dict) and b.get('type') == 'image' for b in blocks)
