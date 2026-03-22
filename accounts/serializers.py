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
    role_name = serializers.CharField(write_only=True, required=False)

    class Meta:
        model = User
        fields = ['email', 'username', 'password', 'first_name', 'last_name', 'role_name']
        extra_kwargs = {'password': {'write_only': True}}

    def create(self, validated_data):
        role_name = validated_data.pop('role_name', Role.STUDENT)
        user = User.objects.create_user(
            email=validated_data['email'],
            username=validated_data['username'],
            password=validated_data['password'],
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', ''),
        )
        try:
            target_role, _ = Role.objects.get_or_create(name=role_name)
            user.role = target_role
            user.save()

            import random, string
            if role_name == Role.TEACHER:
                code = 'GV-' + ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
                TeacherProfile.objects.create(user=user, teacher_code=code)
            else:
                code = 'HS-' + ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
                StudentProfile.objects.create(user=user, student_code=code)
        except Exception:
            pass
            
        return user
