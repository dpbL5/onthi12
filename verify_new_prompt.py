import os
import django
import sys
import json

# Set up Django environment
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'nvh_learning.settings')
django.setup()

import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from ai_core.services.ai_generator import AIGeneratorService
from ai_core.models import DocumentChunk

def test_new_prompt():
    print("--- START NEW PROMPT VERIFICATION ---")
    chunk = DocumentChunk.objects.first()
    if not chunk:
        print("Error: No DocumentChunk found in DB.")
        return

    class_id = str(chunk.document.classroom_id)
    
    try:
        print(f"Generating questions for class: {class_id}...")
        # Generate mixed questions
        questions = AIGeneratorService.generate_from_rag(
            topic='kiến thức cơ bản', 
            count=3, 
            difficulty='medium', 
            class_id=class_id, 
            question_types='all'
        )
        
        print("\n--- GENERATED QUESTIONS ---")
        for i, q in enumerate(questions):
            print(f"\n[Question {i+1}] Type: {q.get('question_type')}")
            print(f"Context: {q.get('context', 'None')}")
            print(f"Text: {q.get('text')}")
            if q.get('options'):
                print("Options:")
                for o in q['options']:
                    print(f" - {o.get('text')} (Correct: {o.get('is_correct')})")
            print(f"Explanation: {q.get('explanation')}")
            
        print("\nVerification successful!")
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Verification failed: {e}")

if __name__ == "__main__":
    test_new_prompt()
