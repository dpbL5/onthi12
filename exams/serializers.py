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


from django.db import transaction

class QuestionSerializer(serializers.ModelSerializer):
    options = OptionSerializer(many=True, read_only=True)
    question_images = QuestionImageSerializer(many=True, read_only=True)
    options_data = serializers.ListField(child=serializers.DictField(), required=False, write_only=True)
    images_data = serializers.ListField(child=serializers.DictField(), required=False, write_only=True)
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
            'created_at', 'options', 'question_images', 'options_data', 'images_data'
        ]

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

    def validate(self, attrs):
        content_json = self.initial_data.get('content_json') or attrs.get('content_json')
        text = self.initial_data.get('text') or attrs.get('text', '')
        text = str(text).strip() if text else ''

        if content_json is not None and not text:
            text = self._blocks_to_text(content_json)

        if content_json is not None and not text and not self._has_image_block(content_json):
            raise serializers.ValidationError({"text": "Question content cannot be empty"})

        attrs['text'] = text
        if content_json is not None:
             attrs['content_json'] = content_json
             
        attrs['options_data'] = self.initial_data.get('options', [])
        attrs['images_data'] = self.initial_data.get('question_images', [])
        return attrs

    def create(self, validated_data):
        options_data = validated_data.pop('options_data', [])
        images_data = validated_data.pop('images_data', [])
        
        request = self.context.get('request')
        user = request.user if request else None

        with transaction.atomic():
            question = Question.objects.create(created_by=user, **validated_data)
            self._handle_options(question, options_data)
            self._handle_images(question, images_data, user)
            return question

    def update(self, instance, validated_data):
        options_data = validated_data.pop('options_data', None)
        images_data = validated_data.pop('images_data', None)
        
        request = self.context.get('request')
        user = request.user if request else getattr(instance, 'created_by', None)

        with transaction.atomic():
            for attr, value in validated_data.items():
                setattr(instance, attr, value)
            instance.save()
            
            if options_data is not None:
                instance.options.all().delete()
                self._handle_options(instance, options_data)
                
            if images_data is not None:
                instance.question_images.all().delete()
                self._handle_images(instance, images_data, user)
                
            return instance

    def _handle_options(self, question, options_data):
        if not isinstance(options_data, list):
            return
        for opt in options_data:
            opt_content = opt.get('content_json')
            opt_text = str(opt.get('text') or '').strip()
            if not opt_text and isinstance(opt_content, list):
                opt_text = self._blocks_to_text(opt_content)
                
            Option.objects.create(
                question=question,
                text=opt_text,
                content_json=opt_content or [],
                is_correct=opt.get('is_correct', False)
            )

    def _handle_images(self, question, images_data, user):
        if not isinstance(images_data, list):
            return
        for img in images_data:
            sha256 = img.get('sha256')
            url = img.get('url')
            if not sha256:
                continue
                
            img_bank, created = ImageBank.objects.get_or_create(
                sha256=sha256,
                defaults={
                    'original_filename': img.get('original_filename', ''),
                    'mime_type': 'image/jpeg',
                    'width_pt': img.get('width_pt'),
                    'height_pt': img.get('height_pt')
                }
            )
            
            if url and (created or not img_bank.image_file or not img_bank.image_file.name.startswith('http')):
                img_bank.image_file.name = url
                img_bank.save()

            QuestionImage.objects.create(
                question=question,
                image=img_bank,
                placement=img.get('placement', 'stem'),
                position=int(img.get('position', 0)),
                source_type=img.get('source_type', 'user_upload'),
                uploaded_by=user,
                note=img.get('note', '')
            )


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
