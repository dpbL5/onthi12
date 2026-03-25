import os
import django
import sys
import json
import io

# Set up Django environment
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'nvh_learning.settings')
django.setup()

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from ai_core.services.ai_generator import AIGeneratorService
from ai_core.models import DocumentChunk

def test_refined_prompt():
    print("--- START REFINED PROMPT VERIFICATION ---")
    chunk = DocumentChunk.objects.first()
    if not chunk:
        print("Error: No DocumentChunk found in DB.")
        return

    class_id = str(chunk.document.classroom_id)
    
    try:
        print(f"Generating questions for class: {class_id}...")
        # Generate mixed questions
        questions = AIGeneratorService.generate_from_rag(
            topic='Mạng máy tính và thiết bị mạng', 
            count=2, 
            difficulty='medium', 
            class_id=class_id, 
            question_types='all'
        )
        
        print("\n--- GENERATED JSON OUTPUT (First Question) ---")
        if questions:
            print(json.dumps(questions[0], indent=2, ensure_ascii=False))
            
            print("\n--- FIELD CHECK ---")
            q = questions[0]
            fields = ['question_type', 'text', 'explanation', 'difficulty', 'topic', 'subject']
            for f in fields:
                print(f"Field '{f}': {'Present' if f in q else 'MISSING'}")
        
        print("\nVerification successful!")
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Verification failed: {e}")

if __name__ == "__main__":
    test_refined_prompt()
