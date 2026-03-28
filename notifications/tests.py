from rest_framework.test import APITestCase
from rest_framework import status

from accounts.models import Role, User
from classes.models import Class, ClassStudent, Subject
from exams.models import Quiz
from notifications.models import Notification


class NotificationSignalTests(APITestCase):
    def setUp(self):
        self.student_role, _ = Role.objects.get_or_create(name=Role.STUDENT)
        self.teacher_role, _ = Role.objects.get_or_create(name=Role.TEACHER)

        self.teacher = User.objects.create_user(
            username='notif_teacher', email='notif_teacher@test.com',
            password='pass', role=self.teacher_role,
        )
        self.student1 = User.objects.create_user(
            username='notif_student1', email='notif_student1@test.com',
            password='pass', role=self.student_role,
        )
        self.student2 = User.objects.create_user(
            username='notif_student2', email='notif_student2@test.com',
            password='pass', role=self.student_role,
        )
        self.student_not_enrolled = User.objects.create_user(
            username='notif_student3', email='notif_student3@test.com',
            password='pass', role=self.student_role,
        )

        self.subject = Subject.objects.get_or_create(name='Toán')[0]
        self.classroom = Class.objects.create(
            name='12A_notif', subject=self.subject, teacher=self.teacher,
        )
        ClassStudent.objects.create(classroom=self.classroom, student=self.student1)
        ClassStudent.objects.create(classroom=self.classroom, student=self.student2)

    def _auth(self, user):
        res = self.client.post('/api/accounts/login/', {
            'username': user.username, 'password': 'pass',
        }, format='json')
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {res.data["access"]}')

    # ── Signal tests ─────────────────────────────────────────────────────────

    def test_notifications_created_on_publish(self):
        """Publishing a quiz creates one notification per enrolled student."""
        quiz = Quiz.objects.create(
            title='Đề thi Toán 1', classroom=self.classroom,
            created_by=self.teacher, is_published=True,
        )
        notifs = Notification.objects.filter(target_id=quiz.id)
        self.assertEqual(notifs.count(), 2)
        recipients = set(notifs.values_list('recipient_id', flat=True))
        self.assertIn(self.student1.id, recipients)
        self.assertIn(self.student2.id, recipients)

    def test_unenrolled_student_does_not_get_notification(self):
        """Students not in the class must not receive notifications."""
        quiz = Quiz.objects.create(
            title='Đề thi Toán 2', classroom=self.classroom,
            created_by=self.teacher, is_published=True,
        )
        self.assertFalse(
            Notification.objects.filter(
                target_id=quiz.id, recipient=self.student_not_enrolled,
            ).exists()
        )

    def test_no_notification_if_not_published(self):
        """Creating a draft quiz (is_published=False) must NOT create notifications."""
        quiz = Quiz.objects.create(
            title='Đề nháp', classroom=self.classroom,
            created_by=self.teacher, is_published=False,
        )
        self.assertEqual(Notification.objects.filter(target_id=quiz.id).count(), 0)

    def test_signal_idempotent_on_resave(self):
        """Re-saving an already-published quiz must NOT create duplicate notifications."""
        quiz = Quiz.objects.create(
            title='Đề thi Toán 3', classroom=self.classroom,
            created_by=self.teacher, is_published=True,
        )
        first_count = Notification.objects.filter(target_id=quiz.id).count()
        # Simulate teacher saving the quiz again without changing published state
        quiz.title = 'Đề thi Toán 3 (sửa tên)'
        quiz.save()
        self.assertEqual(
            Notification.objects.filter(target_id=quiz.id).count(), first_count
        )

    def test_notification_message_contains_quiz_title(self):
        """The auto-generated message should include the quiz title."""
        quiz = Quiz.objects.create(
            title='Đặc Sắc Toán', classroom=self.classroom,
            created_by=self.teacher, is_published=True,
        )
        notif = Notification.objects.filter(target_id=quiz.id).first()
        self.assertIn('Đặc Sắc Toán', notif.message)

    # ── API tests ────────────────────────────────────────────────────────────

    def _create_published_quiz(self, title='Quiz API Test'):
        return Quiz.objects.create(
            title=title, classroom=self.classroom,
            created_by=self.teacher, is_published=True,
        )

    def test_student_can_list_own_notifications(self):
        self._create_published_quiz()
        self._auth(self.student1)
        res = self.client.get('/api/notifications/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(res.data['count'], 1)

    def test_unread_count_returns_correct_number(self):
        self._create_published_quiz('Quiz UC1')
        self._create_published_quiz('Quiz UC2')
        self._auth(self.student1)
        res = self.client.get('/api/notifications/unread-count/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['count'], 2)

    def test_mark_one_read(self):
        quiz = self._create_published_quiz()
        notif = Notification.objects.get(target_id=quiz.id, recipient=self.student1)
        self._auth(self.student1)
        res = self.client.patch(f'/api/notifications/{notif.id}/read/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        notif.refresh_from_db()
        self.assertTrue(notif.is_read)

    def test_mark_all_read(self):
        self._create_published_quiz('Q_MAR1')
        self._create_published_quiz('Q_MAR2')
        self._auth(self.student1)
        res = self.client.post('/api/notifications/mark-all-read/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['marked_read'], 2)
        # Verify
        count_res = self.client.get('/api/notifications/unread-count/')
        self.assertEqual(count_res.data['count'], 0)

    def test_cannot_mark_other_users_notification_read(self):
        quiz = self._create_published_quiz()
        notif = Notification.objects.get(target_id=quiz.id, recipient=self.student1)
        # student2 tries to mark student1's notification
        self._auth(self.student2)
        res = self.client.patch(f'/api/notifications/{notif.id}/read/')
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)
        notif.refresh_from_db()
        self.assertFalse(notif.is_read)

    def test_unauthenticated_cannot_access(self):
        self.client.credentials()  # clear auth
        res = self.client.get('/api/notifications/')
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)
