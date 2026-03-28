from django.urls import path
from .views import (
    ClassListCreateView, 
    ClassDetailUpdateDeleteView, 
    ClassStudentListView, 
    JoinClassView, 
    SubjectListCreateView,
    SubjectDetailView,
    ClassStudentAddView,
    ClassStudentRemoveView
)

urlpatterns = [
    path('subjects/', SubjectListCreateView.as_view(), name='subject-list-create'),
    path('subjects/<int:pk>/', SubjectDetailView.as_view(), name='subject-detail'),
    path('', ClassListCreateView.as_view(), name='class-list-create'),
    path('<uuid:pk>/', ClassDetailUpdateDeleteView.as_view(), name='class-detail'),
    path('<uuid:pk>/students/', ClassStudentListView.as_view(), name='class-students'),
    path('<uuid:pk>/students/add/', ClassStudentAddView.as_view(), name='class-student-add'),
    path('<uuid:pk>/students/<uuid:student_id>/', ClassStudentRemoveView.as_view(), name='class-student-remove'),
    path('join/', JoinClassView.as_view(), name='class-join'),
]
