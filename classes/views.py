from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from django.utils.decorators import method_decorator
from django.views.decorators.cache import cache_page
from django.views.decorators.vary import vary_on_headers

from .models import Class, ClassStudent, Subject
from .serializers import ClassSerializer, SubjectSerializer
from accounts.models import User


def _is_admin(user):
    """Check via role model, not is_staff."""
    return getattr(user.role, 'name', None) == 'admin' or user.is_superuser


class SubjectListCreateView(generics.ListCreateAPIView):
    """List all subjects or create a new one (admin only for create)."""
    queryset = Subject.objects.all()
    serializer_class = SubjectSerializer

    def get_permissions(self):
        return [permissions.IsAuthenticated()]   # admin check done in create()

    def create(self, request, *args, **kwargs):
        if not _is_admin(request.user):
            return Response({'detail': 'Chỉ admin mới có thể tạo môn học.'}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)


class SubjectDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Retrieve, update or delete a subject (admin only for update/delete)."""
    queryset = Subject.objects.all()
    serializer_class = SubjectSerializer
    permission_classes = [permissions.IsAuthenticated]

    def update(self, request, *args, **kwargs):
        if not _is_admin(request.user):
            return Response({'detail': 'Chỉ admin mới có thể sửa môn học.'}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if not _is_admin(request.user):
            return Response({'detail': 'Chỉ admin mới có thể xoá môn học.'}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)


@method_decorator(cache_page(60 * 15), name='dispatch')
@method_decorator(vary_on_headers('Authorization'), name='dispatch')
class ClassListCreateView(generics.ListCreateAPIView):
    serializer_class = ClassSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        role_name = getattr(user.role, 'name', None)
        if _is_admin(user):
            return Class.objects.all().select_related('subject', 'teacher')
        elif role_name == 'teacher':
            return Class.objects.filter(teacher=user).select_related('subject', 'teacher')
        elif role_name == 'student':
            return Class.objects.filter(class_students__student=user).select_related('subject', 'teacher')
        return Class.objects.none()

    def perform_create(self, serializer):
        # Only teachers can create classes
        if not (getattr(self.request.user.role, 'name', None) in ('teacher', 'admin') or self.request.user.is_superuser):
            raise permissions.exceptions.PermissionDenied('Chỉ giáo viên mới có thể tạo lớp.')
        # In Class model, teacher is assigned here.
        serializer.save(teacher=self.request.user)


class ClassDetailUpdateDeleteView(generics.RetrieveUpdateDestroyAPIView):
    """Retrieve, update or delete a specific class."""
    serializer_class = ClassSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = Class.objects.all().select_related('subject', 'teacher')

    def update(self, request, *args, **kwargs):
        classroom = self.get_object()
        if not (_is_admin(request.user) or (getattr(request.user.role, 'name', None) == 'teacher' and classroom.teacher == request.user)):
            return Response({'detail': 'Bạn không có quyền sửa lớp này.'}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        classroom = self.get_object()
        if not (_is_admin(request.user) or (getattr(request.user.role, 'name', None) == 'teacher' and classroom.teacher == request.user)):
            return Response({'detail': 'Bạn không có quyền xoá lớp này.'}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)


class ClassStudentListView(generics.ListAPIView):
    """List students in a class. Accessible by the class teacher or admin."""
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request, pk=None):
        try:
            classroom = Class.objects.get(pk=pk)
        except Class.DoesNotExist:
            return Response({'detail': 'Lớp không tồn tại.'}, status=status.HTTP_404_NOT_FOUND)

        role_name = getattr(request.user.role, 'name', None)
        is_class_teacher = (role_name == 'teacher' and classroom.teacher == request.user)

        if not (_is_admin(request.user) or is_class_teacher):
            return Response(
                {'detail': 'Bạn không có quyền xem danh sách học sinh lớp này.'},
                status=status.HTTP_403_FORBIDDEN
            )

        members = ClassStudent.objects.filter(classroom=classroom).select_related('student')
        data = [
            {
                'id': str(m.student.id),
                'username': m.student.username,
                'email': m.student.email,
                'full_name': m.student.full_name,
                'joined_at': m.joined_at,
            }
            for m in members
        ]
        return Response({'class_name': classroom.name, 'student_count': len(data), 'students': data})


class JoinClassView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if getattr(request.user.role, 'name', None) != 'student':
            return Response(
                {'detail': 'Chỉ học sinh mới có thể tham gia lớp bằng mã.'},
                status=status.HTTP_403_FORBIDDEN
            )
        code = request.data.get('invite_code')
        if not code:
            return Response({'detail': 'Vui lòng cung cấp mã lớp.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            classroom = Class.objects.get(invite_code=code)
        except Class.DoesNotExist:
            return Response({'detail': 'Mã lớp không hợp lệ.'}, status=status.HTTP_404_NOT_FOUND)
        if ClassStudent.objects.filter(classroom=classroom, student=request.user).exists():
            return Response({'detail': 'Bạn đã tham gia lớp này.'}, status=status.HTTP_400_BAD_REQUEST)
        ClassStudent.objects.create(classroom=classroom, student=request.user)
        return Response({
            'detail': 'Tham gia lớp thành công.',
            'class_id': str(classroom.id),
            'class_name': classroom.name
        })


class ClassStudentAddView(APIView):
    """Teacher adds a student by username or email."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        try:
            classroom = Class.objects.get(pk=pk)
        except Class.DoesNotExist:
            return Response({'detail': 'Lớp không tồn tại.'}, status=status.HTTP_404_NOT_FOUND)

        role_name = getattr(request.user.role, 'name', None)
        is_class_teacher = (role_name == 'teacher' and classroom.teacher == request.user)

        if not (_is_admin(request.user) or is_class_teacher):
            return Response(
                {'detail': 'Bạn không có quyền thêm học sinh vào lớp này.'},
                status=status.HTTP_403_FORBIDDEN
            )

        identifier = request.data.get('identifier')
        if not identifier:
            return Response({'detail': 'Vui lòng cung cấp username hoặc email của học sinh.'}, status=status.HTTP_400_BAD_REQUEST)

        # Try to find user by email first, then username
        student = User.objects.filter(email=identifier).first()
        if not student:
            student = User.objects.filter(username=identifier).first()

        if not student:
            return Response({'detail': 'Không tìm thấy học sinh với thông tin này.'}, status=status.HTTP_404_NOT_FOUND)

        student_role = getattr(student.role, 'name', None)
        if student_role != 'student':
            return Response({'detail': 'Người dùng này không phải là học sinh.'}, status=status.HTTP_400_BAD_REQUEST)

        if ClassStudent.objects.filter(classroom=classroom, student=student).exists():
            return Response({'detail': 'Học sinh đã có trong lớp.'}, status=status.HTTP_400_BAD_REQUEST)

        ClassStudent.objects.create(classroom=classroom, student=student)
        return Response({
            'detail': 'Đã thêm học sinh vào lớp thành công.',
            'student_id': str(student.id),
            'username': student.username,
            'full_name': student.full_name
        }, status=status.HTTP_201_CREATED)


class ClassStudentRemoveView(APIView):
    """Teacher removes a student from the class using student's id."""
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, pk, student_id):
        try:
            classroom = Class.objects.get(pk=pk)
        except Class.DoesNotExist:
            return Response({'detail': 'Lớp không tồn tại.'}, status=status.HTTP_404_NOT_FOUND)

        role_name = getattr(request.user.role, 'name', None)
        is_class_teacher = (role_name == 'teacher' and classroom.teacher == request.user)

        if not (_is_admin(request.user) or is_class_teacher):
            return Response(
                {'detail': 'Bạn không có quyền xoá học sinh khỏi lớp này.'},
                status=status.HTTP_403_FORBIDDEN
            )

        try:
            membership = ClassStudent.objects.get(classroom=classroom, student_id=student_id)
            membership.delete()
            return Response({'detail': 'Đã xoá học sinh khỏi lớp.'}, status=status.HTTP_204_NO_CONTENT)
        except ClassStudent.DoesNotExist:
            return Response({'detail': 'Học sinh không có trong lớp này.'}, status=status.HTTP_404_NOT_FOUND)

