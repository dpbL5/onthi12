import os
import django
import random
import string
import uuid

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'nvh_learning.settings')
django.setup()

from django.contrib.auth import get_user_model
from accounts.models import Role, TeacherProfile, StudentProfile
from classes.models import Class, Subject, ClassStudent

User = get_user_model()

def clear_database():
    print("Clearing database...")
    # Delete in order to handle foreign keys
    ClassStudent.objects.all().delete()
    Class.objects.all().delete()
    Subject.objects.all().delete()
    TeacherProfile.objects.all().delete()
    StudentProfile.objects.all().delete()
    User.objects.all().delete()
    Role.objects.all().delete()
    print("Database cleared.")

def generate_random_password():
    return "Test@123456" # Simple password for all accounts for testing

def seed_data():
    # 1. Ensure Roles exist
    roles = {}
    for r_choice in Role.ROLE_CHOICES:
        role, _ = Role.objects.get_or_create(name=r_choice[0])
        roles[r_choice[0]] = role
    
    print("Roles created.")

    # 2. Create 1 Administrator
    admin_user = User.objects.create_superuser(
        username='admin_system',
        email='admin@huyenlearning.edu.vn',
        password='Admin@123456',
        first_name='Admin',
        last_name='System',
        role=roles[Role.ADMIN]
    )
    print(f"Created Admin: {admin_user.username}")

    # 3. Create 3 Teachers
    teachers = []
    subject_names = ['Toán học', 'Vật lý', 'Hóa học']
    subjects = []
    
    for i in range(1, 4):
        username = f'teacher{i}'
        email = f'teacher{i}@huyenlearning.edu.vn'
        teacher_user = User.objects.create_user(
            username=username,
            email=email,
            password='Teacher@123456',
            first_name=f'Teacher',
            last_name=f'Number {i}',
            role=roles[Role.TEACHER]
        )
        # Create profile
        TeacherProfile.objects.create(
            user=teacher_user,
            teacher_code=f'GV{1000 + i}',
            specialization=subject_names[i-1]
        )
        teachers.append(teacher_user)
        
        # Create corresponding subject
        sub, _ = Subject.objects.get_or_create(name=subject_names[i-1])
        subjects.append(sub)
        print(f"Created Teacher: {username} for {subject_names[i-1]}")

    # 4. Create 30 Students
    students = []
    for i in range(1, 31):
        username = f'student{i}'
        email = f'student{i}@student.edu.vn'
        student_user = User.objects.create_user(
            username=username,
            email=email,
            password='Student@123456',
            first_name=f'S{i}',
            last_name='Student',
            role=roles[Role.STUDENT]
        )
        # Create profile
        StudentProfile.objects.create(
            user=student_user,
            student_code=f'HS{20260000 + i}',
            notes=f'Ghi chú cho học sinh {i}'
        )
        students.append(student_user)
    print(f"Created 30 Students.")

    # 5. Create 3 Classes, each with 15 students
    # Class 1: Teacher 1, Subject 1, Students 1-15
    # Class 2: Teacher 2, Subject 2, Students 6-20
    # Class 3: Teacher 3, Subject 3, Students 16-30
    
    class_groups = [
        {'name': 'Lớp 12A1', 'teacher': teachers[0], 'subject': subjects[0], 'student_range': students[0:15]},
        {'name': 'Lớp 11B2', 'teacher': teachers[1], 'subject': subjects[1], 'student_range': students[5:20]},
        {'name': 'Lớp 10C3', 'teacher': teachers[2], 'subject': subjects[2], 'student_range': students[15:30]},
    ]
    
    for cg in class_groups:
        cls = Class.objects.create(
            name=cg['name'],
            teacher=cg['teacher'],
            subject=cg['subject'],
            description=f'Lớp học {cg["name"]} do {cg["teacher"].full_name} giảng dạy môn {cg["subject"].name}'
        )
        for student in cg['student_range']:
            ClassStudent.objects.create(classroom=cls, student=student)
        print(f"Created Class: {cls.name} with {len(cg['student_range'])} students.")

    # 6. Save credentials summary
    with open('test_accounts_credentials.txt', 'w', encoding='utf-8') as f:
        f.write("HỆ THỐNG TÀI KHOẢN SEED - NGUYÊN VĂN HUYÊN LEARNING\n")
        f.write("-" * 50 + "\n")
        f.write(f"Admin: admin_system | admin@huyenlearning.edu.vn | Admin@123456\n")
        f.write("-" * 50 + "\n")
        for i, t in enumerate(teachers):
            f.write(f"Teacher {i+1}: {t.username} | {t.email} | Teacher@123456\n")
        f.write("-" * 50 + "\n")
        f.write("Học sinh: student1 -> student30 | Mật khẩu: Student@123456\n")
        f.write("-" * 50 + "\n")
        f.write("Cấu trúc lớp:\n")
        for cg in class_groups:
            f.write(f"- {cg['name']}: {len(cg['student_range'])} học sinh\n")

if __name__ == "__main__":
    clear_database()
    seed_data()
    print("\nSeeding completed successfully!")
