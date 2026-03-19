from django.db import models
from classes.models import Class
from pgvector.django import VectorField

class Document(models.Model):
    """A document uploaded for a specific class to be used by AI."""
    classroom = models.ForeignKey(Class, on_delete=models.CASCADE, related_name='documents')
    title = models.CharField(max_length=255)
    file_path = models.CharField(max_length=500, null=True, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.title

class DocumentChunk(models.Model):
    """A chunk of text from a document, embedding via Gemini."""
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name='chunks')
    chunk_index = models.IntegerField()
    content = models.TextField()
    # 768 dimensions — matches output_dimensionality used by models/gemini-embedding-001
    embedding = VectorField(dimensions=768, null=True, blank=True)

    class Meta:
        ordering = ['document', 'chunk_index']

    def __str__(self):
        return f"Chunk {self.chunk_index} of {self.document.title}"

class ClassInsight(models.Model):
    """Stores the latest AI-generated insight report for a classroom."""
    classroom = models.OneToOneField(Class, on_delete=models.CASCADE, related_name='ai_insight')
    content = models.TextField()
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"AI Insight for {self.classroom.name}"
