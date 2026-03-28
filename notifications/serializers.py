from rest_framework import serializers
from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    quiz_url = serializers.SerializerMethodField()
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = [
            'id', 'verb', 'message', 'target_id',
            'is_read', 'created_at', 'quiz_url', 'actor_name',
        ]
        read_only_fields = fields

    def get_quiz_url(self, obj):
        if obj.verb == Notification.VERB_PUBLISHED_QUIZ and obj.target_id:
            return f'/exams/taker/{obj.target_id}/'
        return None

    def get_actor_name(self, obj):
        if obj.actor:
            return obj.actor.full_name or obj.actor.username
        return None
