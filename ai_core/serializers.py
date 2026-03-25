from rest_framework import serializers
from .models import Document

class DocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Document
        fields = ['id', 'title', 'file', 'file_url', 'cloudinary_public_id', 'uploaded_at', 'classroom']
        read_only_fields = ['id', 'file_url', 'cloudinary_public_id', 'uploaded_at', 'classroom']
