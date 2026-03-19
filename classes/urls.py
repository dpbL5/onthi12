from django.urls import path
from .views import (
    ClassListCreateView, 
    ClassDetailUpdateDeleteView, 
    ClassStudentListView, 
    JoinClassView, 
    SubjectListCreateView,
    SubjectDetailView
)

urlpatterns = [
    path('subjects/', SubjectListCreateView.as_view(), name='subject-list-create'),
    path('subjects/<int:pk>/', SubjectDetailView.as_view(), name='subject-detail'),
    path('', ClassListCreateView.as_view(), name='class-list-create'),
    path('<uuid:pk>/', ClassDetailUpdateDeleteView.as_view(), name='class-detail'),
    path('<uuid:pk>/students/', ClassStudentListView.as_view(), name='class-students'),
    path('join/', JoinClassView.as_view(), name='class-join'),
]
