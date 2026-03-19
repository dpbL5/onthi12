from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser
from django.utils import timezone
from django.db.models import Q
from django.db import transaction
from django.core.files.base import ContentFile
from classes.models import Class, Topic
from .models import Question, Option, Quiz, QuizQuestion, QuizAttempt, StudentAnswer, ImageBank, QuestionImage
from .serializers import (
    QuestionSerializer, OptionSerializer, QuizSerializer,
    QuizQuestionSerializer, QuizAttemptSerializer, QuizQuestionPublicSerializer,
    TopicSerializer,
)
import hashlib
import os


class IsTeacherOrAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        role_name = getattr(request.user.role, 'name', None)
        return role_name in ['teacher', 'admin'] or request.user.is_superuser


class IsTeacherOrAdminOrStudentReadOnly(permissions.BasePermission):
    """
    Giáo viên/Admin có toàn quyền.
    Học sinh chỉ được phép xem (GET) nếu là thành viên của lớp.
    """
    def has_permission(self, request, view):
        user = request.user
        role_name = getattr(user.role, 'name', None)
        if role_name in ['teacher', 'admin'] or user.is_superuser:
            return True
        if role_name == 'student' and request.method in permissions.SAFE_METHODS:
            return True
        return False


# ─── TEACHER / ADMIN: Topic CRUD ─────────────────────────────────────────────

class TopicListCreateView(generics.ListCreateAPIView):
    """Giáo viên xem và tạo chủ đề cho môn học"""
    serializer_class = TopicSerializer
    permission_classes = [permissions.IsAuthenticated, IsTeacherOrAdmin]

    def get_queryset(self):
        subject_id = self.request.query_params.get('subject')
        qs = Topic.objects.all()
        if subject_id:
            qs = qs.filter(subject_id=subject_id)
        return qs

class TopicDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Topic.objects.all()
    serializer_class = TopicSerializer
    permission_classes = [permissions.IsAuthenticated, IsTeacherOrAdmin]


# ─── TEACHER / ADMIN: Question Bank CRUD ─────────────────────────────────────

class QuestionListCreateView(generics.ListCreateAPIView):
    """Giáo viên xem ngân hàng câu hỏi và tạo mới."""
    serializer_class = QuestionSerializer
    permission_classes = [permissions.IsAuthenticated, IsTeacherOrAdmin]

    def get_queryset(self):
        qs = (
            Question.objects
            .select_related('subject', 'topic', 'created_by')
            .prefetch_related('options', 'question_images__image', 'question_images__uploaded_by')
            .order_by('-created_at')
        )
        subject_id = self.request.query_params.get('subject')
        difficulty = self.request.query_params.get('difficulty')
        q_type = self.request.query_params.get('question_type')
        search = self.request.query_params.get('search')

        if subject_id:
            qs = qs.filter(subject_id=subject_id)
        if difficulty:
            qs = qs.filter(difficulty=difficulty)
        if q_type:
            qs = qs.filter(question_type=q_type)
        if search:
            qs = qs.filter(Q(text__icontains=search) | Q(context__icontains=search))
            
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class QuestionDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = (
        Question.objects
        .select_related('subject', 'topic', 'created_by')
        .prefetch_related('options', 'question_images__image', 'question_images__uploaded_by')
    )
    serializer_class = QuestionSerializer
    permission_classes = [permissions.IsAuthenticated, IsTeacherOrAdmin]

class BulkDeleteQuestionsView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsTeacherOrAdmin]
    
    def post(self, request):
        ids = request.data.get('ids', [])
        if not ids:
            return Response({'error': 'No IDs provided'}, status=status.HTTP_400_BAD_REQUEST)
        
        count, _ = Question.objects.filter(id__in=ids).delete()
        return Response({'message': f'Deleted {count} questions successfully'})

class UpdateQuestionFullView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsTeacherOrAdmin]

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

    def _normalize_question_payload(self, payload):
        content_json = payload.get('content_json')
        if content_json is not None and not isinstance(content_json, list):
            raise ValueError('content_json must be a list')

        text = payload.get('text')
        if text is not None:
            text = (text or '').strip()

        if content_json is not None and not text:
            text = self._blocks_to_text(content_json)

        if content_json is not None and not text and not self._has_image_block(content_json):
            raise ValueError('Question content cannot be empty')

        return {
            'text': text,
            'content_json': content_json,
            'difficulty': payload.get('difficulty'),
            'question_type': payload.get('question_type'),
            'context': payload.get('context'),
            'correct_answer_text': payload.get('correct_answer_text'),
            'topic_id': payload.get('topic_id') if 'topic_id' in payload else '__keep__',
            'options': payload.get('options') if 'options' in payload else None,
        }

    def put(self, request, pk):
        try:
            q = Question.objects.get(pk=pk)
        except Question.DoesNotExist:
            return Response({'error': 'Question not found'}, status=status.HTTP_404_NOT_FOUND)

        try:
            normalized = self._normalize_question_payload(request.data)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        options_data = normalized['options']
        validated_options = None
        if options_data is not None:
            if not isinstance(options_data, list):
                return Response({'error': 'options must be a list'}, status=status.HTTP_400_BAD_REQUEST)

            validated_options = []
            for opt in options_data:
                opt_content = opt.get('content_json')
                if opt_content is not None and not isinstance(opt_content, list):
                    return Response({'error': 'option.content_json must be a list'}, status=status.HTTP_400_BAD_REQUEST)

                opt_text = (opt.get('text') or '').strip()
                if not opt_text and isinstance(opt_content, list):
                    opt_text = self._blocks_to_text(opt_content)

                validated_options.append({
                    'text': opt_text,
                    'content_json': opt_content,
                    'is_correct': opt.get('is_correct', False),
                })

        with transaction.atomic():
            if normalized['text'] is not None:
                q.text = normalized['text']
            if normalized['content_json'] is not None:
                q.content_json = normalized['content_json']
            if normalized['difficulty'] is not None:
                q.difficulty = normalized['difficulty']
            if normalized['question_type'] is not None:
                q.question_type = normalized['question_type']
            if normalized['context'] is not None:
                q.context = normalized['context']
            if normalized['correct_answer_text'] is not None:
                q.correct_answer_text = normalized['correct_answer_text']

            if normalized['topic_id'] != '__keep__':
                q.topic_id = normalized['topic_id'] or None

            q.save()

            if validated_options is not None:
                q.options.all().delete()
                for opt in validated_options:
                    Option.objects.create(
                        question=q,
                        text=opt['text'],
                        content_json=opt['content_json'],
                        is_correct=opt.get('is_correct', False)
                    )

        q = (
            Question.objects
            .select_related('subject', 'topic', 'created_by')
            .prefetch_related('options', 'question_images__image', 'question_images__uploaded_by')
            .get(pk=pk)
        )
        return Response(QuestionSerializer(q, context={'request': request}).data)


class OptionListCreateView(generics.ListCreateAPIView):
    serializer_class = OptionSerializer
    permission_classes = [permissions.IsAuthenticated, IsTeacherOrAdmin]

    def get_queryset(self):
        question_id = self.kwargs.get('question_id')
        return Option.objects.filter(question_id=question_id)

    def perform_create(self, serializer):
        question_id = self.kwargs.get('question_id')
        serializer.save(question_id=question_id)


class UploadImageView(APIView):
    """Xử lý việc upload ảnh từ Editor (ví dụ Markdown/TinyMCE) vào CSDL."""
    permission_classes = [permissions.IsAuthenticated, IsTeacherOrAdmin]
    parser_classes = [MultiPartParser]

    def post(self, request):
        file_obj = request.FILES.get('image') or request.FILES.get('file')
        if not file_obj:
            return Response({"error": "No image provided."}, status=status.HTTP_400_BAD_REQUEST)

        import uuid, os
        from django.conf import settings
        
        try:
            ext = os.path.splitext(file_obj.name)[1].lower()
            if ext not in ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']:
                return Response({"error": "Unsupported image format."}, status=status.HTTP_400_BAD_REQUEST)

            file_name = f"editor_{uuid.uuid4().hex}{ext}"
            save_dir = os.path.join(settings.MEDIA_ROOT, 'editor_uploads')
            os.makedirs(save_dir, exist_ok=True)
            save_path = os.path.join(save_dir, file_name)

            with open(save_path, 'wb+') as destination:
                for chunk in file_obj.chunks():
                    destination.write(chunk)

            # URL phục vụ ảnh qua đường dẫn MEDIA_URL
            image_url = f"{settings.MEDIA_URL}editor_uploads/{file_name}"

            # API response cho TinyMCE/QuillJs typically requires { "location": "url" } or similar
            # Markdown usually expects just an URL or similar JSON
            return Response({
                "url": image_url,
                "location": image_url,  # TinyMCE
            })

        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class QuestionImageUploadView(APIView):
    """Upload ảnh cho câu hỏi, deduplicate theo SHA-256 và lưu vào ImageBank."""
    permission_classes = [permissions.IsAuthenticated, IsTeacherOrAdmin]
    parser_classes = [MultiPartParser]

    ALLOWED_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'}
    ALLOWED_MIME_TYPES = {
        'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'
    }

    def post(self, request):
        file_obj = request.FILES.get('image') or request.FILES.get('file')
        if not file_obj:
            return Response({'error': 'No image provided.'}, status=status.HTTP_400_BAD_REQUEST)

        ext = os.path.splitext(file_obj.name)[1].lower()
        if ext not in self.ALLOWED_EXTENSIONS:
            return Response({'error': 'Unsupported image format.'}, status=status.HTTP_400_BAD_REQUEST)

        content_type = (file_obj.content_type or '').lower()
        if content_type and content_type not in self.ALLOWED_MIME_TYPES:
            return Response({'error': 'Unsupported image MIME type.'}, status=status.HTTP_400_BAD_REQUEST)

        file_bytes = file_obj.read()
        if not file_bytes:
            return Response({'error': 'Image is empty.'}, status=status.HTTP_400_BAD_REQUEST)

        sha256_hash = hashlib.sha256(file_bytes).hexdigest()
        relative_path = f'questions/images/bank/{sha256_hash}{ext}'

        image_bank, created = ImageBank.objects.get_or_create(
            sha256=sha256_hash,
            defaults={
                'original_filename': file_obj.name,
                'mime_type': content_type or None,
                'file_size': len(file_bytes),
            }
        )

        if created:
            image_bank.image_file.save(relative_path, ContentFile(file_bytes), save=True)

        request_source_type = request.data.get('source_type', 'user_upload')
        source_type = request_source_type if request_source_type in {'ai_scan', 'user_upload', 'system'} else 'user_upload'

        question_id = request.data.get('question_id')
        question_image = None
        if question_id:
            try:
                question = Question.objects.get(pk=question_id)
            except Question.DoesNotExist:
                return Response({'error': 'Question not found.'}, status=status.HTTP_404_NOT_FOUND)

            placement = request.data.get('placement', 'stem')
            try:
                position = int(request.data.get('position', 0))
            except (TypeError, ValueError):
                position = 0

            question_image, _ = QuestionImage.objects.get_or_create(
                question=question,
                image=image_bank,
                placement=placement,
                position=position,
                defaults={
                    'source_type': source_type,
                    'uploaded_by': request.user,
                    'note': request.data.get('note', ''),
                }
            )

        image_url = image_bank.image_file.url if image_bank.image_file else None
        if image_url and request is not None:
            image_url = request.build_absolute_uri(image_url)

        return Response({
            'sha256': image_bank.sha256,
            'url': image_url,
            'image_bank_created': created,
            'question_image_id': question_image.id if question_image else None,
            'source_type': source_type,
        }, status=status.HTTP_201_CREATED)


class QuestionImageLinkView(APIView):
    """Gắn ảnh có sẵn trong ImageBank vào câu hỏi (dùng cho AI scan hoặc tái sử dụng ảnh)."""
    permission_classes = [permissions.IsAuthenticated, IsTeacherOrAdmin]

    def post(self, request, pk):
        try:
            question = Question.objects.get(pk=pk)
        except Question.DoesNotExist:
            return Response({'error': 'Question not found.'}, status=status.HTTP_404_NOT_FOUND)

        sha256_hash = request.data.get('sha256')
        if not sha256_hash:
            return Response({'error': 'sha256 is required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            image_bank = ImageBank.objects.get(sha256=sha256_hash)
        except ImageBank.DoesNotExist:
            return Response({'error': 'Image not found in ImageBank.'}, status=status.HTTP_404_NOT_FOUND)

        placement = request.data.get('placement', 'stem')
        try:
            position = int(request.data.get('position', 0))
        except (TypeError, ValueError):
            position = 0

        request_source_type = request.data.get('source_type', 'ai_scan')
        source_type = request_source_type if request_source_type in {'ai_scan', 'user_upload', 'system'} else 'ai_scan'

        question_image, created = QuestionImage.objects.get_or_create(
            question=question,
            image=image_bank,
            placement=placement,
            position=position,
            defaults={
                'source_type': source_type,
                'uploaded_by': request.user,
                'note': request.data.get('note', ''),
            }
        )

        return Response({
            'question_image_id': question_image.id,
            'created': created,
            'sha256': image_bank.sha256,
            'placement': placement,
            'position': position,
            'source_type': question_image.source_type,
        })


class QuestionImageUnlinkView(APIView):
    """Gỡ liên kết ảnh khỏi câu hỏi, đồng thời xóa ảnh gốc trong ImageBank nếu không còn câu hỏi nào liên kết."""
    permission_classes = [permissions.IsAuthenticated, IsTeacherOrAdmin]

    def delete(self, request, pk, qimg_id):
        try:
            qimg = QuestionImage.objects.get(id=qimg_id, question_id=pk)
        except QuestionImage.DoesNotExist:
            return Response({'error': 'Question image link not found.'}, status=status.HTTP_404_NOT_FOUND)

        image_bank = qimg.image
        qimg.delete()
        
        if not QuestionImage.objects.filter(image=image_bank).exists():
            if image_bank.image_file:
                image_bank.image_file.delete(save=False)
            image_bank.delete()

        return Response(status=status.HTTP_204_NO_CONTENT)


# ─── TEACHER / ADMIN: Quiz CRUD ─────────────────────────────────────────────

class QuizListCreateView(generics.ListCreateAPIView):
    serializer_class = QuizSerializer
    permission_classes = [permissions.IsAuthenticated, IsTeacherOrAdmin]

    def get_queryset(self):
        user = self.request.user
        class_id = self.request.query_params.get('class_id')
        
        # Enforce class_id filter as per requirement: exams only show in their class detail
        if not class_id:
            return Quiz.objects.none()
            
        role_name = getattr(user.role, 'name', None)
        base_qs = Quiz.objects.select_related('classroom', 'classroom__subject', 'created_by').filter(classroom_id=class_id)
        
        if role_name == 'admin' or user.is_superuser:
            return base_qs
        
        return base_qs.filter(created_by=user)

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class QuizDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = QuizSerializer
    permission_classes = [permissions.IsAuthenticated, IsTeacherOrAdminOrStudentReadOnly]

    def get_queryset(self):
        user = self.request.user
        role_name = getattr(user.role, 'name', None)
        base_qs = Quiz.objects.select_related('classroom', 'classroom__subject', 'created_by')

        if role_name == 'admin' or user.is_superuser:
            return base_qs
            
        if role_name == 'teacher':
            return base_qs.filter(created_by=user)
            
        if role_name == 'student':
            # Students can only see published quizzes in classes they are enrolled in
            return base_qs.filter(
                classroom__class_students__student=user,
                is_published=True
            ).filter(
                Q(publish_at__isnull=True) | Q(publish_at__lte=timezone.now())
            )
            
        return Quiz.objects.none()


class QuizQuestionListCreateView(generics.ListCreateAPIView):
    serializer_class = QuizQuestionSerializer
    permission_classes = [permissions.IsAuthenticated, IsTeacherOrAdmin]

    def get_queryset(self):
        quiz_id = self.kwargs.get('quiz_id')
        return (
            QuizQuestion.objects
            .filter(quiz_id=quiz_id)
            .select_related('question', 'quiz')
            .prefetch_related('question__options', 'question__question_images__image', 'question__question_images__uploaded_by')
        )

    def perform_create(self, serializer):
        quiz_id = self.kwargs.get('quiz_id')
        serializer.save(quiz_id=quiz_id)


class QuizQuestionDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = (
        QuizQuestion.objects
        .select_related('question', 'quiz')
        .prefetch_related('question__options', 'question__question_images__image', 'question__question_images__uploaded_by')
    )
    serializer_class = QuizQuestionSerializer
    permission_classes = [permissions.IsAuthenticated, IsTeacherOrAdmin]


# ─── STUDENT: Take Exam ─────────────────────────────────────────────────────

class StudentQuizListView(generics.ListAPIView):
    serializer_class = QuizSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if getattr(user.role, 'name', None) != 'student':
            return Quiz.objects.none()
            
        class_id = self.request.query_params.get('class_id')
        if not class_id:
            return Quiz.objects.none()

        return Quiz.objects.filter(
            classroom_id=class_id,
            classroom__class_students__student=user, 
            is_published=True
        ).filter(
            Q(publish_at__isnull=True) | Q(publish_at__lte=timezone.now())
        )


class QuizStartView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, quiz_id):
        user = request.user
        try:
            quiz = Quiz.objects.get(id=quiz_id, is_published=True)
        except Quiz.DoesNotExist:
            return Response(
                {'detail': 'Đề thi không tồn tại hoặc chưa được mở.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not quiz.classroom.class_students.filter(student=user).exists():
            return Response({'detail': 'Bạn không thuộc lớp học này.'}, status=status.HTTP_403_FORBIDDEN)

        attempt, created = QuizAttempt.objects.get_or_create(quiz=quiz, student=user)
        if attempt.is_completed:
            return Response(
                {'detail': 'Bạn đã thi bài này rồi.', 'score': attempt.score},
                status=status.HTTP_400_BAD_REQUEST,
            )

        questions = (
            QuizQuestion.objects
            .filter(quiz=quiz)
            .select_related('question')
            .prefetch_related('question__options', 'question__question_images__image', 'question__question_images__uploaded_by')
        )
        serializer = QuizQuestionPublicSerializer(questions, many=True)

        return Response({
            'attempt_id': attempt.id,
            'duration_minutes': quiz.duration_minutes,
            'start_time': attempt.start_time,
            'questions': serializer.data,
        })


class QuizSubmitView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, attempt_id):
        user = request.user
        try:
            attempt = QuizAttempt.objects.get(id=attempt_id, student=user)
        except QuizAttempt.DoesNotExist:
            return Response({'detail': 'Lượt thi không tồn tại.'}, status=status.HTTP_404_NOT_FOUND)

        if attempt.is_completed:
            return Response({'detail': 'Bài này đã được nộp.'}, status=status.HTTP_400_BAD_REQUEST)

        answers_data = request.data.get('answers', [])
        total_points = 0
        earned_points = 0

        for answer in answers_data:
            qq_id = answer.get('quiz_question_id')
            opt_id = answer.get('selected_option_id')
            answer_text = answer.get('answer_text')

            try:
                qq = QuizQuestion.objects.get(id=qq_id, quiz=attempt.quiz)
                q_type = qq.question.question_type

                if q_type == 'short_answer':
                    sa = StudentAnswer.objects.create(
                        attempt=attempt, quiz_question=qq, answer_text=answer_text,
                    )
                    total_points += qq.points
                    if sa.is_correct():
                        earned_points += qq.points
                else:
                    opt = Option.objects.get(id=opt_id, question=qq.question) if opt_id else None
                    sa = StudentAnswer.objects.create(
                        attempt=attempt, quiz_question=qq, selected_option=opt,
                    )
                    total_points += qq.points
                    if sa.is_correct():
                        earned_points += qq.points

            except (QuizQuestion.DoesNotExist, Option.DoesNotExist):
                continue

        # Câu chưa trả lời vẫn tính vào tổng điểm
        remaining_qs = attempt.quiz.quiz_questions.exclude(
            id__in=[a.get('quiz_question_id') for a in answers_data]
        )
        for rq in remaining_qs:
            total_points += rq.points

        final_score = (earned_points / total_points * 10) if total_points > 0 else 0
        final_score = round(final_score, 2)

        attempt.score = final_score
        attempt.is_completed = True
        attempt.end_time = timezone.now()
        attempt.save()

        return Response({
            'detail': 'Nộp bài thành công!',
            'score': final_score,
            'earned_points': earned_points,
            'total_points': total_points,
        })


class RandomQuestionGeneratorView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsTeacherOrAdmin]

    def post(self, request, quiz_id):
        topic_id = request.data.get('topic_id')
        count = int(request.data.get('count', 5))
        difficulty = request.data.get('difficulty', 'medium')
        
        try:
            quiz = Quiz.objects.get(id=quiz_id)
            if not topic_id:
                return Response({'error': 'Vui lòng cung cấp topic_id.'}, status=status.HTTP_400_BAD_REQUEST)
            
            # Lấy các câu hỏi thuộc topic và difficulty, chưa có trong quiz
            existing_q_ids = quiz.quiz_questions.values_list('question_id', flat=True)
            candidate_qs = Question.objects.filter(
                topic_id=topic_id,
                difficulty=difficulty
            ).exclude(id__in=existing_q_ids)
            
            import random
            candidate_list = list(candidate_qs)
            if not candidate_list:
                return Response({'error': 'Không tìm thấy câu hỏi phù hợp trong ngân hàng.'}, status=status.HTTP_404_NOT_FOUND)
                
            selected_qs = random.sample(candidate_list, min(count, len(candidate_list)))
            
            max_order = 0
            latest_qq = quiz.quiz_questions.order_by('-order').first()
            if latest_qq:
                max_order = latest_qq.order
                
            new_qqs = []
            for i, q in enumerate(selected_qs, 1):
                qq = QuizQuestion.objects.create(
                    quiz=quiz,
                    question=q,
                    order=max_order + i,
                    points=1.0
                )
                new_qqs.append(qq)
                
            return Response({'message': f'Đã thêm {len(new_qqs)} câu hỏi ngẫu nhiên vào đề.'})
            
        except Quiz.DoesNotExist:
            return Response({'error': 'Quiz không tồn tại.'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ─── ANALYTICS ───────────────────────────────────────────────────────────────

class ClassAnalyticsView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsTeacherOrAdmin]

    def get(self, request, class_id):
        try:
            classroom = Class.objects.get(id=class_id)
        except Class.DoesNotExist:
            return Response({"error": "Lớp học không tồn tại."}, status=status.HTTP_404_NOT_FOUND)

        quizzes = Quiz.objects.filter(classroom=classroom)
        analytics = {
            "class_name": classroom.name,
            "total_quizzes": quizzes.count(),
            "quizzes": [],
        }

        for quiz in quizzes:
            attempts = QuizAttempt.objects.filter(quiz=quiz, is_completed=True)
            if not attempts.exists():
                continue

            from django.db.models import Avg, Max, Min
            stats = attempts.aggregate(
                avg_score=Avg('score'), max_score=Max('score'), min_score=Min('score'),
            )

            q_stats = []
            quiz_qs = QuizQuestion.objects.filter(quiz=quiz)
            for qq in quiz_qs:
                total_ans = StudentAnswer.objects.filter(quiz_question=qq, attempt__quiz=quiz).count()
                if total_ans == 0:
                    continue
                correct_ans = sum(
                    1 for ans in StudentAnswer.objects.filter(quiz_question=qq, attempt__quiz=quiz)
                    if ans.is_correct()
                )
                accuracy = (correct_ans / total_ans) * 100
                q_stats.append({
                    "question_text": qq.question.text[:100],
                    "accuracy": round(accuracy, 1),
                })

            q_stats.sort(key=lambda x: x['accuracy'])
            trouble_questions = q_stats[:3]

            analytics["quizzes"].append({
                "quiz_title": quiz.title,
                "average_score": round(stats['avg_score'], 2) if stats['avg_score'] else 0,
                "max_score": stats['max_score'],
                "min_score": stats['min_score'],
                "total_attempts": attempts.count(),
                "trouble_questions": trouble_questions,
            })

        return Response(analytics)
