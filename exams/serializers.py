from rest_framework import serializers
from .models import Question, Option, Quiz, QuizQuestion, QuizAttempt, StudentAnswer, ImageBank, QuestionImage
from classes.models import Subject, Class


class OptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Option
        fields = ['id', 'text', 'content_json', 'is_correct', 'explanation']


class ImageBankSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = ImageBank
        fields = [
            'sha256', 'image_url', 'original_filename', 'mime_type', 'file_size',
            'width_pt', 'height_pt', 'created_at',
        ]

    def get_image_url(self, obj):
        request = self.context.get('request')
        if not obj.image_file:
            return None
        
        # Nếu url đã lưu là direct URL (Cloudinary)
        if obj.image_file.name.startswith('http'):
            return obj.image_file.name

        url = obj.image_file.url
        if request:
            return request.build_absolute_uri(url)
        return url


class QuestionImageSerializer(serializers.ModelSerializer):
    image = ImageBankSerializer(read_only=True)
    uploaded_by_username = serializers.CharField(source='uploaded_by.username', read_only=True)

    class Meta:
        model = QuestionImage
        fields = [
            'id', 'image', 'position', 'placement', 'source_type',
            'uploaded_by', 'uploaded_by_username', 'note', 'created_at',
        ]


class QuestionSerializer(serializers.ModelSerializer):
    options = OptionSerializer(many=True, read_only=True)
    question_images = QuestionImageSerializer(many=True, read_only=True)
    subject_name = serializers.CharField(source='subject.name', read_only=True)
    question_type_display = serializers.CharField(
        source='get_question_type_display', read_only=True
    )

    class Meta:
        model = Question
        fields = [
            'id', 'question_type', 'question_type_display',
            'subject', 'subject_name', 'difficulty',
            'text', 'content_json', 'context', 'image', 'correct_answer_text',
            'created_at', 'options', 'question_images',
        ]


class QuizQuestionSerializer(serializers.ModelSerializer):
    question = QuestionSerializer(read_only=True)
    question_id = serializers.PrimaryKeyRelatedField(
        queryset=Question.objects.all(), source='question', write_only=True
    )
    quiz = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = QuizQuestion
        fields = ['id', 'quiz', 'question', 'question_id', 'order', 'points']


class QuizSerializer(serializers.ModelSerializer):
    classroom_name = serializers.CharField(source='classroom.name', read_only=True)
    subject_name = serializers.CharField(source='classroom.subject.name', read_only=True)
    subject_id = serializers.IntegerField(source='classroom.subject.id', read_only=True)
    question_count = serializers.SerializerMethodField()
    my_attempt = serializers.SerializerMethodField()

    class Meta:
        model = Quiz
        fields = [
            'id', 'title', 'description', 'classroom', 'classroom_name',
            'subject_name', 'subject_id', 'duration_minutes', 'is_published', 'publish_at',
            'created_at', 'due_date', 'question_count', 'my_attempt',
        ]

    def get_question_count(self, obj):
        return obj.quiz_questions.count()

    def get_my_attempt(self, obj):
        user = self.context.get('request').user
        if not user or user.is_anonymous:
            return None
        attempt = QuizAttempt.objects.filter(quiz=obj, student=user).first()
        if attempt:
            return {
                'id': attempt.id,
                'score': attempt.score,
                'is_completed': attempt.is_completed,
                'start_time': attempt.start_time,
            }
        return None


class QuizAttemptSerializer(serializers.ModelSerializer):
    student_name = serializers.SerializerMethodField()
    quiz_title = serializers.CharField(source='quiz.title', read_only=True)

    class Meta:
        model = QuizAttempt
        fields = [
            'id', 'quiz', 'quiz_title', 'student', 'student_name',
            'start_time', 'end_time', 'score', 'is_completed',
        ]

    def get_student_name(self, obj):
        return f"{obj.student.last_name} {obj.student.first_name}".strip() or obj.student.username


# ─── Public (Student) Read-Only Serializers (Anti-Cheat) ─────────────────────

class OptionPublicSerializer(serializers.ModelSerializer):
    class Meta:
        model = Option
        fields = ['id', 'text', 'content_json']  # Không phơi bày is_correct


class QuestionPublicSerializer(serializers.ModelSerializer):
    options = OptionPublicSerializer(many=True)
    question_images = QuestionImageSerializer(many=True)

    class Meta:
        model = Question
        fields = ['id', 'question_type', 'text', 'content_json', 'context', 'image', 'options', 'question_images']
        # Lưu ý: KHÔNG trả correct_answer_text cho học sinh


class QuizQuestionPublicSerializer(serializers.ModelSerializer):
    question = QuestionPublicSerializer()

    class Meta:
        model = QuizQuestion
        fields = ['id', 'question', 'order', 'points']
