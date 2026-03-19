import uuid
from django.db import models
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin

class Role(models.Model):
    STUDENT = 'student'
    TEACHER = 'teacher'
    ADMIN = 'admin'
    ROLE_CHOICES = [
        (STUDENT, 'Học sinh'),
        (TEACHER, 'Giáo viên'),
        (ADMIN, 'Quản trị viên'),
    ]
    name = models.CharField(max_length=20, choices=ROLE_CHOICES, unique=True)
    class Meta:
        db_table = 'roles'
    def __str__(self):
        return self.get_name_display()

class UserManager(BaseUserManager):
    def create_user(self, username, email, password=None, **extra_fields):
        if not username:
            raise ValueError('Username là bắt buộc')
        if not email:
            raise ValueError('Email là bắt buộc')
        email = self.normalize_email(email)
        user = self.model(username=username, email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, username, email, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        return self.create_user(username, email, password, **extra_fields)

class User(AbstractBaseUser, PermissionsMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    role = models.ForeignKey(Role, on_delete=models.PROTECT, null=True, blank=True, related_name='users')
    email = models.EmailField(unique=True)
    username = models.CharField(max_length=150, unique=True)
    first_name = models.CharField(max_length=100, blank=True)
    last_name = models.CharField(max_length=100, blank=True)
    avatar_url = models.URLField(blank=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    objects = UserManager()
    USERNAME_FIELD = 'username'
    REQUIRED_FIELDS = ['email']
    class Meta:
        db_table = 'users'

    def __str__(self):
        return f'{self.email} ({self.username})'

    @property
    def full_name(self):
        return f'{self.last_name} {self.first_name}'.strip()

class StudentProfile(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='student_profile')
    student_code = models.CharField(max_length=20, unique=True)
    notes = models.TextField(blank=True)
    class Meta:
        db_table = 'student_profiles'

    def __str__(self):
        return f'{self.student_code} — {self.user.full_name}'

class TeacherProfile(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='teacher_profile')
    teacher_code = models.CharField(max_length=20, unique=True)
    specialization = models.CharField(max_length=200, blank=True)
    class Meta:
        db_table = 'teacher_profiles'

    def __str__(self):
        return f'{self.teacher_code} — {self.user.full_name}'
