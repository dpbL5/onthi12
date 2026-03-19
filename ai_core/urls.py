from django.urls import path
from .views import (
    RAGChatbotView, AIClassInsightView, 
    ClassDocumentListView, UploadClassDocumentView, DeleteClassDocumentView,
    AIExtractFromFileView, AIGenerateFromRAGView, AIBulkSaveQuestionsView
)

urlpatterns = [
    path('chat/', RAGChatbotView.as_view(), name='rag-chatbot'),
    path('insight/', AIClassInsightView.as_view(), name='ai-insight'),
    path('classes/<uuid:class_id>/documents/', ClassDocumentListView.as_view(), name='class-docs'),
    path('classes/<uuid:class_id>/documents/upload/', UploadClassDocumentView.as_view(), name='upload-class-doc'),
    path('documents/<int:doc_id>/', DeleteClassDocumentView.as_view(), name='delete-class-doc'),
    # AI Generation tools for Question Bank
    path('generate/extract-file/', AIExtractFromFileView.as_view(), name='ai-extract-file'),
    path('generate/from-rag/', AIGenerateFromRAGView.as_view(), name='ai-generate-rag'),
    path('generate/save-bulk/', AIBulkSaveQuestionsView.as_view(), name='ai-save-bulk'),
]
