from rest_framework import serializers
from .models import Class, ClassStudent, Subject
from accounts.serializers import UserSerializer


class SubjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Subject
        fields = ['id', 'name']


class ClassSerializer(serializers.ModelSerializer):
    teacher = UserSerializer(read_only=True)
    subject_name = serializers.CharField(source='subject.name', read_only=True)
    student_count = serializers.SerializerMethodField()
    total_quizzes = serializers.SerializerMethodField()
    total_attempts = serializers.SerializerMethodField()
    avg_score = serializers.SerializerMethodField()

    class Meta:
        model = Class
        fields = ['id', 'name', 'subject', 'subject_name', 'teacher', 'invite_code', 'description', 'created_at', 'student_count', 'total_quizzes', 'total_attempts', 'avg_score']
        read_only_fields = ['invite_code', 'teacher', 'subject_name', 'student_count', 'total_quizzes', 'total_attempts', 'avg_score']

    def get_student_count(self, obj):
        return obj.class_students.count()

    def get_total_quizzes(self, obj):
        return obj.quizzes.count()

    def get_total_attempts(self, obj):
        from exams.models import QuizAttempt
        return QuizAttempt.objects.filter(quiz__classroom=obj, is_completed=True).count()

    def get_avg_score(self, obj):
        from exams.models import QuizAttempt
        from django.db.models import Avg
        avg = QuizAttempt.objects.filter(quiz__classroom=obj, is_completed=True).aggregate(Avg('score'))['score__avg']
        return round(avg, 2) if avg else 0.0
