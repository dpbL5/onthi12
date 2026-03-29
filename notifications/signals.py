"""
Signal: khi Quiz được công khai lần đầu (is_published False → True),
tự động tạo Notification cho tất cả học sinh trong lớp đó.
"""
from django.db.models.signals import post_save
from django.dispatch import receiver


@receiver(post_save, sender='exams.Quiz')
def notify_students_on_quiz_publish(sender, instance, created, **kwargs):
    """
    - created=True  : quiz mới tạo ra, kiểm tra nếu ngay lập tức published
    - created=False : quiz vừa được update, kiểm tra nếu vừa chuyển sang published
    """
    from exams.models import Quiz
    from classes.models import ClassStudent
    from .models import Notification

    quiz = instance

    if not quiz.is_published:
        return

    # Bỏ qua bài thi cá nhân (VD: Phục thù)
    if quiz.assigned_to is not None:
        return

    # Kiểm tra xem đã có notification cho quiz này chưa để tránh duplicate
    if Notification.objects.filter(
        verb=Notification.VERB_PUBLISHED_QUIZ,
        target_id=quiz.id,
    ).exists():
        return

    # Lấy danh sách học sinh trong lớp
    student_ids = ClassStudent.objects.filter(
        classroom=quiz.classroom
    ).values_list('student_id', flat=True)

    if not student_ids:
        return

    actor = quiz.created_by
    actor_name = actor.full_name or actor.username if actor else 'Giáo viên'
    message = f'{actor_name} vừa công bố đề thi: "{quiz.title}"'

    notifications = [
        Notification(
            recipient_id=sid,
            actor=actor,
            verb=Notification.VERB_PUBLISHED_QUIZ,
            message=message,
            target_id=quiz.id,
        )
        for sid in student_ids
    ]
    Notification.objects.bulk_create(notifications, ignore_conflicts=True)
