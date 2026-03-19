from rest_framework import serializers
from .models import User, Role, StudentProfile, TeacherProfile

class RoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ['id', 'name']

class UserSerializer(serializers.ModelSerializer):
    role = RoleSerializer(read_only=True)
    class Meta:
        model = User
        fields = ['id', 'email', 'username', 'first_name', 'last_name', 'role', 'avatar_url', 'created_at']

class RegisterSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['email', 'username', 'password', 'first_name', 'last_name']
        extra_kwargs = {'password': {'write_only': True}}

    def create(self, validated_data):
        user = User.objects.create_user(
            email=validated_data['email'],
            username=validated_data['username'],
            password=validated_data['password'],
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', ''),
        )
        try:
            student_role, _ = Role.objects.get_or_create(name=Role.STUDENT)
            user.role = student_role
            user.save()

            import random, string
            code = 'HS-' + ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
            StudentProfile.objects.create(user=user, student_code=code)
        except Exception:
            pass
            
        return user
