from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role, User
from classes.models import Class, ClassStudent, Subject


class ClassesApiTests(APITestCase):
    def setUp(self):
        self.student_role, _ = Role.objects.get_or_create(name=Role.STUDENT)
        self.teacher_role, _ = Role.objects.get_or_create(name=Role.TEACHER)
        self.admin_role, _ = Role.objects.get_or_create(name=Role.ADMIN)

        self.admin = User.objects.create_user(
            username="admin_classes",
            email="admin_classes@example.com",
            password="AdminPass123",
            role=self.admin_role,
            is_staff=True,
        )
        self.teacher = User.objects.create_user(
            username="teacher_classes",
            email="teacher_classes@example.com",
            password="TeacherPass123",
            role=self.teacher_role,
        )
        self.teacher2 = User.objects.create_user(
            username="teacher_classes_2",
            email="teacher_classes_2@example.com",
            password="TeacherPass123",
            role=self.teacher_role,
        )
        self.student = User.objects.create_user(
            username="student_classes",
            email="student_classes@example.com",
            password="StudentPass123",
            role=self.student_role,
        )

        self.subject = Subject.objects.create(name="Toan")
        self.classroom = Class.objects.create(
            name="12A1",
            subject=self.subject,
            teacher=self.teacher,
        )

    def _auth(self, username, password):
        login_res = self.client.post(
            "/api/accounts/login/",
            {"username": username, "password": password},
            format="json",
        )
        token = login_res.data["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    def test_admin_can_create_subject(self):
        self._auth("admin_classes", "AdminPass123")
        res = self.client.post("/api/classes/subjects/", {"name": "Ly"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertTrue(Subject.objects.filter(name="Ly").exists())

    def test_student_cannot_create_subject(self):
        self._auth("student_classes", "StudentPass123")
        res = self.client.post("/api/classes/subjects/", {"name": "Hoa"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_teacher_can_create_class(self):
        self._auth("teacher_classes", "TeacherPass123")
        payload = {
            "name": "12A2",
            "subject": self.subject.id,
            "description": "Lop hoc test",
        }
        res = self.client.post("/api/classes/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertTrue(Class.objects.filter(name="12A2", teacher=self.teacher).exists())

    def test_student_cannot_create_class(self):
        self._auth("student_classes", "StudentPass123")
        payload = {
            "name": "12A3",
            "subject": self.subject.id,
        }
        res = self.client.post("/api/classes/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_student_join_class_success(self):
        self._auth("student_classes", "StudentPass123")
        res = self.client.post(
            "/api/classes/join/",
            {"invite_code": self.classroom.invite_code},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(ClassStudent.objects.filter(classroom=self.classroom, student=self.student).exists())

    def test_student_join_class_invalid_code(self):
        self._auth("student_classes", "StudentPass123")
        res = self.client.post("/api/classes/join/", {"invite_code": "INVALID1"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_other_teacher_cannot_view_class_students(self):
        self._auth("teacher_classes_2", "TeacherPass123")
        res = self.client.get(f"/api/classes/{self.classroom.id}/students/")
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
