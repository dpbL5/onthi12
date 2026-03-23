import os
import json
import zipfile
import tempfile
import docx
import uuid
import re
import time
import hashlib
from typing import List, Dict, Any, Tuple
from django.conf import settings
from django.core.cache import cache
from .ai_provider import get_client

# Ensure API key and model name are configured
ai_client = get_client()
RAG_GENERATION_MODEL = os.environ.get('AI_MODEL_NAME', ai_client.get_default_model())
FILE_EXTRACTION_MODEL = os.environ.get('AI_EXTRACTION_MODEL_NAME', ai_client.get_default_model())

# Cấu hình generation ưu tiên output JSON ổn định và giảm biến thiên.
GENERATION_CONFIG_JSON_STRICT = {
    'response_mime_type': 'application/json',
    'temperature': 0.1,
    'max_output_tokens': 16000,
}

GENERATION_CONFIG_RAG = {
    'response_mime_type': 'application/json',
    'temperature': 0.2,
    'max_output_tokens': 8192,
}

# max blocks for full document extraction - increased thanks to compact format
MAX_BLOCKS_EXTRACTION = 8000
RAG_MAX_CONTEXT_CHARS = int(os.environ.get('AI_RAG_MAX_CONTEXT_CHARS', '5000'))
RAG_MAX_CHUNK_CHARS = int(os.environ.get('AI_RAG_MAX_CHUNK_CHARS', '650'))
RAG_CACHE_TTL_SECONDS = int(os.environ.get('AI_RAG_CACHE_TTL_SECONDS', '300'))

# ─── Prompt: Trích xuất câu hỏi đa dạng từ tài liệu ────────────────────────
EXTRACTION_PROMPT = """
Bạn là hệ thống trích xuất chuyên gia (Expert Data Extractor). Đề thi theo định dạng THPT 2025.
Nhiệm vụ: đọc nội dung tài liệu (dạng COMPACT TEXT) và bóc tách TOÀN BỘ CÂU HỎI ...

QUY TẮC ĐỌC COMPACT TEXT:
- `**văn bản**`: Chữ in đậm.
- `<u>văn bản</u>`: Chữ gạch chân (thường là đáp án).
- `[IMG:sha256]`: Hình ảnh minh họa.

YÊU CẦU BẮT BUỘC:
1. Trích xuất TẤT CẢ câu hỏi có trong tài liệu từ đầu đến câu cuối cùng (thường từ 40-50 câu). Tuyệt đối KHÔNG ĐƯỢC BỎ SÓT hay viết tắt.
2. Giữ nguyên 100% văn bản gốc của câu hỏi và đáp án, không tự ý tóm tắt câu chữ.
3. Về hình ảnh:
   - CHỈ GIỮ LẠI các hình ảnh có ý nghĩa minh họa trực tiếp cho câu hỏi (đồ thị, bản đồ, hình học, sơ đồ thí nghiệm).
   - LOẠI BỎ: ảnh trang trí, logo, watermark, ô vuông báo điểm, viền khung...
   - Đặt block `{"type": "image", "sha256": "..."}` đúng vị trí ban đầu.
4. Về đáp án: Dựa vào "Định dạng trực tiếp" trong văn bản (chữ highlight, gạch chân, in đậm khác thường) hoặc "Bảng đáp án" cuối đề để tìm câu đúng.

PHÂN LOẠI 3 DẠNG CÂU HỎI (THPT 2025):

DẠNG 1 — multiple_choice (Trắc nghiệm 4 lựa chọn):
- Có 4 phương án A, B, C, D. Gán `is_correct: true` cho phương án đúng, các phương án khác `false`.

DẠNG 2 — true_false (Đúng/Sai):
- Gồm 1 ngữ cảnh chung và 4 phát biểu a, b, c, d. Gán `is_correct: true/false` cho từng phát biểu riêng biệt.

DẠNG 3 — short_answer (Trả lời ngắn):
- Thí sinh tính toán và điền kết quả số.
- BẮT BUỘC: Bạn phải tự trích xuất con số đáp án cuối cùng (nếu đề có ghi đáp án) và đưa ĐÚNG con số đó vào trường `correct_answer_text`. Tuyệt đối không để trống nếu đề có đáp án.

OUTPUT FORMAT BẮT BUỘC (Trả về duy nhất JSON array, không kèm text/giải thích):
[
  {
    "question_type": "multiple_choice",
    "difficulty": "medium", // 'easy'=Nhận biết, 'medium'=Thông hiểu, 'hard'=Vận dụng
    "content_json": [
       {"type": "text", "value": "Nội dung câu "},
       {"type": "image", "sha256": "a3f9c...", "width_pt": 78, "height_pt": 18.5},
       {"type": "text", "value": " là gì?"}
    ],
    "options": [
      { "content_json": [ {"type": "text", "value": "Phương án A"} ], "is_correct": true }
    ]
  },
  {
    "question_type": "true_false",
    "difficulty": "hard", // 'hard'=Vận dụng
    "context": "Ngữ cảnh thí nghiệm...",
    "content_json": [ {"type": "text", "value": "Xét các phát biểu:"} ],
    "options": [
      { "content_json": [ {"type": "text", "value": "Phát biểu a: ..."} ], "is_correct": true }
    ]
  },
  {
    "question_type": "short_answer",
    "difficulty": "hard", // 'hard'=Vận dụng
    "content_json": [ {"type": "text", "value": "Tính giá trị... "} ],
    "correct_answer_text": "42"
  }
]
"""



EXTRACTION_PROMPT_GENERIC = """
Bạn là hệ thống trích xuất câu hỏi từ tài liệu học tập.

Nhiệm vụ:
- Đọc tài liệu đầu vào (PDF hoặc ảnh).
- Trích xuất các câu hỏi theo 3 dạng: multiple_choice, true_false, short_answer.
- Nếu không chắc đáp án đúng, để is_correct=false hoặc để trống correct_answer_text.
- BẮT BUỘC trích xuất đầy đủ tất cả câu hỏi có trong tài liệu, không chỉ câu đầu tiên.

QUAN TRỌNG:
1. Trả về duy nhất JSON array, không có giải thích.
2. Mỗi câu phải có text rõ ràng, không để rỗng.
3. Dùng format chuẩn bên dưới.

QUY TẮC ẢNH (RẤT QUAN TRỌNG):
    - KHÔNG lấy hoặc KHÔNG giữ các ảnh KHÔNG LIÊN QUAN tới nội dung câu hỏi: các hình trang trí, watermark, khung/ô vuông để ghi đáp án, checkbox, hoặc các shape chỉ phục vụ bố cục.
    - Chỉ giữ ảnh khi ảnh đó trực tiếp minh hoạ (đồ thị, sơ đồ, hình vẽ, ảnh thí nghiệm, mô tả hình học...).
    - Nếu một ảnh chỉ biểu thị ô trống/ô đáp án hay là hình đánh dấu (ví dụ ô vuông để thí sinh gạch), hãy bỏ ảnh đó khỏi `content_json`.
    - Nếu không chắc, ưu tiên loại bỏ ảnh trang trí hơn là giữ ảnh không liên quan.

OUTPUT FORMAT:
[
    {
        "question_type": "multiple_choice",
        "text": "Nội dung câu hỏi",
        "difficulty": "medium",
        "options": [
            {"text": "A", "is_correct": false},
            {"text": "B", "is_correct": true},
            {"text": "C", "is_correct": false},
            {"text": "D", "is_correct": false}
        ]
    },
    {
        "question_type": "true_false",
        "text": "Xét các phát biểu sau",
        "context": "Ngữ cảnh nếu có",
        "difficulty": "medium",
        "options": [
            {"text": "Phát biểu a", "is_correct": true},
            {"text": "Phát biểu b", "is_correct": false},
            {"text": "Phát biểu c", "is_correct": true},
            {"text": "Phát biểu d", "is_correct": false}
        ]
    },
    {
        "question_type": "short_answer",
        "text": "Nội dung câu hỏi trả lời ngắn",
        "difficulty": "hard",
        "correct_answer_text": "42"
    }
]
"""

# LƯU Ý ẢNH: Khi sinh câu hỏi từ context, KHÔNG chèn các ảnh trang trí hoặc ô vuông/khung để ghi đáp án.
# Chỉ sử dụng ảnh nếu ảnh trực tiếp hỗ trợ nội dung câu hỏi (ví dụ: sơ đồ, đồ thị, hình thí nghiệm). Nếu ảnh trong context là decorative hoặc dùng cho layout/đáp án, hãy bỏ qua.

# ─── Prompt: Sinh câu hỏi từ tri thức nội bộ (RAG) ──────────────────────────
RAG_GENERATION_PROMPT_TEMPLATE = """
Bạn là giáo viên chuyên môn và hệ thống tạo câu hỏi tự động cho NVH Learning.
Nhiệm vụ: Dựa vào TÀI LIỆU TRÍCH XUẤT được cung cấp, tạo ra {count} câu hỏi chất lượng cao tuân thủ định dạng đề thi THPT 2025.

YÊU CẦU:
- Chủ đề / phạm vi: {topic}
- Số lượng câu hỏi: {count}
- Độ khó: {difficulty} (Nhận biết/Thông hiểu/Vận dụng)
- Dạng câu hỏi cần tạo: {question_types}

QUY TẮC CỐT LÕI (BẮT BUỘC):
1. CHỈ dựa trên nội dung trong TÀI LIỆU TRÍCH XUẤT. KHÔNG tự bịa thông tin bên ngoài.
2. Với dạng "multiple_choice" (Nhiều lựa chọn):
   - Phần dẫn ngắn gọn, 1 đáp án đúng và 3 đáp án sai đồng nhất về độ dài. Cung cấp Lời giải chi tiết ở trường `explanation`.
3. Với dạng "true_false" (Đúng/Sai):
   - BẮT BUỘC PHẢI CÓ Tình huống/Ngữ cảnh (bối cảnh) khoảng 3-10 dòng đặt vào trường `context`. Nếu không có, bạn phải tổng hợp bối cảnh từ tài liệu.
   - 4 phát biểu a, b, c, d độc lập, thể hiện 3 mức nhận thức: Nhận biết, Thông hiểu, Vận dụng. Học sinh BẮT BUỘC phải đọc `context` mới làm được, không được chung chung.
   - Cung cấp giải thích chi tiết cho cả 4 ý gộp chung vào trường `explanation` của câu hỏi.
4. Với dạng "short_answer" (Trả lời ngắn):
   - Đòi hỏi tính toán hoặc phân tích sâu để ra MỘT CON SỐ CỤ THỂ hoặc một CỤM TỪ cực ngắn cực chuẩn xác.
   - Bắt buộc điền kết quả vào `correct_answer_text`.
   - Lời giải được ghi ở `explanation`.

TÀI LIỆU TRÍCH XUẤT:
{context}

OUTPUT FORMAT BẮT BUỘC (Trả về duy nhất JSON array, không text bên ngoài):
[
  {{
    "question_type": "multiple_choice",
    "difficulty": "{difficulty}",
    "text": "Nội dung phần dẫn câu hỏi trắc nghiệm?",
    "explanation": "Giải thích chi tiết vì sao đáp án này đúng và các đáp án khác sai...",
    "options": [
      {{"text": "Phương án A", "is_correct": true}},
      {{"text": "Phương án B", "is_correct": false}},
      {{"text": "Phương án C", "is_correct": false}},
      {{"text": "Phương án D", "is_correct": false}}
    ]
  }},
  {{
    "question_type": "true_false",
    "difficulty": "{difficulty}",
    "context": "Nội dung bối cảnh/ngữ cảnh thực tế bắt buộc phải có để học sinh tư duy (3-10 dòng).",
    "text": "Xét các phát biểu sau:",
    "explanation": "a) Sai vì... b) Đúng vì... c) Đúng vì... d) Sai vì...",
    "options": [
      {{"text": "Phát biểu a (Nhận biết)", "is_correct": true}},
      {{"text": "Phát biểu b (Thông hiểu)", "is_correct": false}},
      {{"text": "Phát biểu c (Vận dụng)", "is_correct": true}},
      {{"text": "Phát biểu d (Vận dụng cao)", "is_correct": false}}
    ]
  }},
  {{
    "question_type": "short_answer",
    "difficulty": "{difficulty}",
    "text": "Nội dung câu hỏi yêu cầu tính toán hoặc phân tích:",
    "correct_answer_text": "42",
    "explanation": "Giải thích từng bước tính toán để ra kết quả 42..."
  }}
]
"""


class AIGeneratorService:
    """Service tạo/trích xuất câu hỏi bằng AI — dùng chung cho cả File extraction và RAG."""

    @staticmethod
    def _extract_question_list_from_parsed(parsed: Any) -> List[Dict[str, Any]]:
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict):
            for key in ('questions', 'items', 'data', 'results'):
                value = parsed.get(key)
                if isinstance(value, list):
                    return value
        return []

    @staticmethod
    def _parse_model_json(text: str) -> List[Dict[str, Any]]:
        """Làm sạch response của model AI (Gemini/OpenAI) và parse thành JSON."""
        clean_text = text.strip()

        # 1) Parse trực tiếp nếu response đã là JSON thuần.
        try:
            parsed = json.loads(clean_text)
            parsed_list = AIGeneratorService._extract_question_list_from_parsed(parsed)
            if parsed_list:
                return parsed_list
        except json.JSONDecodeError:
            pass

        # 2) Tìm fenced code blocks kiểu ```json ... ```.
        code_blocks = re.findall(r'```(?:json)?\s*(.*?)```', clean_text, flags=re.DOTALL | re.IGNORECASE)
        for block in code_blocks:
            try:
                parsed = json.loads(block.strip())
                parsed_list = AIGeneratorService._extract_question_list_from_parsed(parsed)
                if parsed_list:
                    return parsed_list
            except json.JSONDecodeError:
                continue

        # 3) Tìm JSON array đầu tiên bằng bracket matching (tránh regex greedy).
        candidate = AIGeneratorService._extract_first_json_array(clean_text)
        if candidate:
            try:
                parsed = json.loads(candidate)
                parsed_list = AIGeneratorService._extract_question_list_from_parsed(parsed)
                if parsed_list:
                    return parsed_list
            except json.JSONDecodeError:
                pass

        print("--- FAILED TO PARSE AI JSON ---")
        print(f"Raw Text: {text[:1200]}...")
        print("------------------------------------")

        # 4) Fallback: cố gắng sửa JSON bị cắt.
        repaired = AIGeneratorService._repair_truncated_json(clean_text)
        if repaired:
            try:
                parsed = json.loads(repaired)
                parsed_list = AIGeneratorService._extract_question_list_from_parsed(parsed)
                if parsed_list:
                    print(f"[parse] Recovered {len(parsed_list)} items from truncated JSON.")
                    return parsed_list
            except json.JSONDecodeError:
                pass

        return []

    @staticmethod
    def _repair_truncated_json(text: str) -> str:
        """
        Cố gắng vá JSON array bị cắt giữa chừng bằng cách:
        1. Tìm vị trí object cuối cùng hoàn chỉnh trong array.
        2. Đóng array tại đó.
        Trả về chuỗi JSON hợp lệ hoặc rỗng nếu không phục hồi được.
        """
        # Tìm phần bắt đầu array
        start = text.find('[')
        if start == -1:
            return ''

        # Dùng bracket matching để tìm object cuối cùng hoàn chỉnh
        depth = 0
        in_string = False
        escaped = False
        last_complete_obj_end = -1
        obj_depth_start = -1

        for i in range(start, len(text)):
            ch = text[i]
            if in_string:
                if escaped:
                    escaped = False
                elif ch == '\\':
                    escaped = True
                elif ch == '"':
                    in_string = False
                continue

            if ch == '"':
                in_string = True
            elif ch == '[':
                depth += 1
            elif ch == ']':
                depth -= 1
                if depth == 0:
                    return ''  # Array hoàn chỉnh, không cần sửa
            elif ch == '{' and depth == 1:
                obj_depth_start = i
            elif ch == '}' and depth == 1:
                last_complete_obj_end = i

        if last_complete_obj_end == -1:
            return ''

        # Cắt tại object hoàn chỉnh cuối cùng + đóng array
        repaired = text[start:last_complete_obj_end + 1] + ']'
        return repaired

    @staticmethod
    def _extract_first_json_array(text: str) -> str:
        """Trích xuất JSON array đầu tiên trong chuỗi bằng bracket matching."""
        start = text.find('[')
        if start == -1:
            return ''

        depth = 0
        in_string = False
        escaped = False

        for i in range(start, len(text)):
            ch = text[i]
            if in_string:
                if escaped:
                    escaped = False
                elif ch == '\\':
                    escaped = True
                elif ch == '"':
                    in_string = False
                continue

            if ch == '"':
                in_string = True
            elif ch == '[':
                depth += 1
            elif ch == ']':
                depth -= 1
                if depth == 0:
                    return text[start:i + 1]

        # Nếu chạy hết chuỗi mà depth > 0, mảng bị cắt (truncated).
        # Trả về toàn bộ phần còn lại để có thể được sửa chữa bởi fallback.
        return text[start:]

    @staticmethod
    def _blocks_to_text(blocks: Any) -> str:
        if not isinstance(blocks, list):
            return ''
        parts = []
        for b in blocks:
            if isinstance(b, dict):
                if b.get('type') == 'text' and isinstance(b.get('value'), str):
                    parts.append(b.get('value'))
                elif b.get('type') == 'image' and b.get('sha256'):
                    parts.append(f"\n[IMAGE_PLACEHOLDER:{b.get('sha256')}]\n")
        return ' '.join(parts).strip()

    @staticmethod
    def _has_image_block(blocks: Any) -> bool:
        if not isinstance(blocks, list):
            return False
        return any(isinstance(b, dict) and b.get('type') == 'image' for b in blocks)

    @staticmethod
    def _is_content_block(item: Any) -> bool:
        if not isinstance(item, dict):
            return False
        return item.get('type') in ('text', 'image') and ('value' in item or 'sha256' in item)

    @staticmethod
    def _looks_like_content_blocks_list(items: Any) -> bool:
        """True chỉ khi list này hoàn toàn là content blocks,
        không phải question objects (có question_type key)."""
        if not isinstance(items, list) or not items:
            return False
        # Nếu bất kỳ item nào có question_type hoặc text key → đây là questions
        if any(
            isinstance(it, dict) and ('question_type' in it or 'options' in it)
            for it in items
        ):
            return False
        block_count = sum(1 for it in items if AIGeneratorService._is_content_block(it))
        return block_count / len(items) >= 0.8

    @staticmethod
    def _to_question_from_blocks(blocks: List[Dict[str, Any]]) -> Dict[str, Any]:
        # Fallback: khi model trả về content blocks thay vì question objects.
        return {
            'question_type': 'short_answer',
            'difficulty': 'medium',
            'content_json': blocks,
            'correct_answer_text': '',
        }

    @staticmethod
    def _count_question_markers(text: str) -> int:
        if not text:
            return 0
        patterns = [
            r'\bcâu\s*\d+\b',
            r'(^|\n)\s*\d+\s*[\).:-]',
            r'(^|\n)\s*[ivxlcdm]+\s*[\).:-]',
        ]
        total = 0
        for p in patterns:
            total += len(re.findall(p, text, flags=re.IGNORECASE | re.MULTILINE))
        return total

    @staticmethod
    def _split_text_to_short_answer_questions(text: str, max_questions: int = 200) -> List[Dict[str, Any]]:
        if not text or not text.strip():
            return []

        splitter = re.compile(
            r'(?=(?:^|\n)\s*(?:câu\s*\d+|\d+\s*[\).:-]|[ivxlcdm]+\s*[\).:-]))',
            flags=re.IGNORECASE,
        )
        chunks = [c.strip() for c in splitter.split(text) if c and c.strip()]

        if len(chunks) <= 1:
            return []

        questions = []
        for chunk in chunks[:max_questions]:
            questions.append({
                'question_type': 'short_answer',
                'difficulty': 'medium',
                'content_json': [{'type': 'text', 'value': chunk}],
                'correct_answer_text': '',
            })
        return questions

    @staticmethod
    def _compact_text_for_rag(text: str, max_chars: int = RAG_MAX_CHUNK_CHARS) -> str:
        if not text:
            return ''
        compact = re.sub(r'\s+', ' ', str(text)).strip()
        if len(compact) <= max_chars:
            return compact
        return compact[: max_chars - 3].rstrip() + '...'

    @staticmethod
    def _build_rag_context(chunks: List[Any], max_total_chars: int = RAG_MAX_CONTEXT_CHARS) -> str:
        contexts = []
        seen_signatures = set()
        total_chars = 0

        for chunk in chunks:
            text = AIGeneratorService._compact_text_for_rag(getattr(chunk, 'content', ''))
            if not text:
                continue

            signature = text[:180].lower()
            if signature in seen_signatures:
                continue
            seen_signatures.add(signature)

            doc_title = getattr(getattr(chunk, 'document', None), 'title', 'Tài liệu')
            line = f"[{doc_title}]: {text}"

            projected = total_chars + len(line)
            if contexts and projected > max_total_chars:
                break

            contexts.append(line)
            total_chars = projected

        return "\n\n---\n\n".join(contexts)

    @staticmethod
    def _make_rag_cache_key(**kwargs: Any) -> str:
        payload = json.dumps(kwargs, sort_keys=True, ensure_ascii=False)
        digest = hashlib.sha256(payload.encode('utf-8')).hexdigest()
        return f"ai_gen:rag:{digest}"

    @staticmethod
    def _fallback_questions_from_blocks(blocks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        text = AIGeneratorService._blocks_to_text(blocks)
        marker_count = AIGeneratorService._count_question_markers(text)
        if marker_count >= 2:
            split_qs = AIGeneratorService._split_text_to_short_answer_questions(text)
            if split_qs:
                print(f"[fallback] Split block text into {len(split_qs)} question candidates (markers={marker_count}).")
                return split_qs
        return [AIGeneratorService._to_question_from_blocks(blocks)]

    @staticmethod
    def _compact_blocks_for_prompt(blocks: List[Dict[str, Any]], max_blocks: int = 1400) -> List[Dict[str, Any]]:
        """
        Giảm token đầu vào bằng cách chỉ giữ field cần thiết cho model.
        V3: Loại `url` khỏi image block — giảm đáng kể input token.
        """
        compact = []
        for b in blocks:
            if not isinstance(b, dict):
                continue
            b_type = b.get('type')
            if b_type == 'text':
                raw_val = b.get('value') or ''
                if not str(raw_val).strip():
                    continue
                # Giữ xuống dòng để model nhận diện ranh giới câu hỏi tốt hơn.
                item = {'type': 'text', 'value': raw_val}
                # Giữ lại fmt nếu có — đây là tín hiệu đáp án đúng quan trọng
                fmt = b.get('fmt')
                if fmt:
                    item['fmt'] = fmt
                compact.append(item)
            elif b_type == 'image':
                # QUAN TRỌNG: Bỏ `url` — chỉ giữ sha256 + kích thước để model biết ảnh ở đây.
                item = {'type': 'image', 'sha256': b.get('sha256')}
                if b.get('width_pt') is not None:
                    item['width_pt'] = b.get('width_pt')
                if b.get('height_pt') is not None:
                    item['height_pt'] = b.get('height_pt')
                compact.append(item)

        # Truncate by character count first (OpenAI 128k context roughly 500k chars)
        # We aim for ~350k chars of SOURCE to leave room for prompt and output.
        MAX_TOTAL_CHARS = 350000
        
        # Determine how many blocks we can keep from the head and tail
        if len(compact) > max_blocks:
            # Ưu tiên lấy phần cuối nếu có bảng đáp án
            answer_tbl_idx = [
                i for i, it in enumerate(compact)
                if isinstance(it, dict)
                and it.get('type') == 'text'
                and '[BẢNG ĐÁP ÁN]' in str(it.get('value', '')).upper()
            ]
            if answer_tbl_idx:
                tail_start = max(0, answer_tbl_idx[-1] - 40)
                tail = compact[tail_start:]
                head_slots = max_blocks - len(tail)
                if head_slots <= 0:
                    compact = tail[-max_blocks:]
                else:
                    compact = compact[:head_slots] + tail
            else:
                compact = compact[:max_blocks]

        # Final check: total character length of serialized JSON
        final_compact = []
        current_chars = 0
        
        # We process from both ends? No, let's just do a simple cumulative limit for now.
        # If it's too long, we truncate.
        serialized_test = json.dumps(compact, ensure_ascii=False)
        if len(serialized_test) <= MAX_TOTAL_CHARS:
            return compact

        print(f"[compact] SOURCE JSON length ({len(serialized_test)}) exceeds {MAX_TOTAL_CHARS}. Further truncating...")
        for b in compact:
            item_str = json.dumps(b, ensure_ascii=False)
            if current_chars + len(item_str) + 2 > MAX_TOTAL_CHARS: # +2 for comma/bracket
                break
            final_compact.append(b)
            current_chars += len(item_str) + 2
            
        return final_compact

    @staticmethod
    def _to_compact_source(blocks: List[Dict[str, Any]]) -> str:
        """
        Convert blocks to a compact string format to save tokens.
        """
        lines = []
        for b in blocks:
            if not isinstance(b, dict): continue
            b_type = b.get('type')
            if b_type == 'text':
                val = str(b.get('value', '')).strip()
                if not val: continue
                fmt = b.get('fmt', {})
                if fmt.get('bold'): val = f"**{val}**"
                if fmt.get('underline'): val = f"<u>{val}</u>"
                lines.append(val)
            elif b_type == 'image':
                lines.append(f"[IMG:{b.get('sha256', '')}]")
        return "\n".join(lines)

    @staticmethod
    def _normalize_question_type(raw_type: Any) -> str:
        q_type = str(raw_type or 'multiple_choice').strip().lower()
        if q_type in ('multiple_choice', 'mcq', 'multiple-choice', 'multiple choice', 'trac_nghiem'):
            return 'multiple_choice'
        if q_type in ('true_false', 'true-false', 'true false', 'dung_sai', 'đúng_sai'):
            return 'true_false'
        if q_type in ('short_answer', 'short-answer', 'short answer', 'tu_luan_ngan'):
            return 'short_answer'
        return 'multiple_choice'

    @staticmethod
    def _coerce_options(options_raw: Any) -> List[Dict[str, Any]]:
        if isinstance(options_raw, dict):
            ordered_keys = [k for k in ('A', 'B', 'C', 'D', 'a', 'b', 'c', 'd') if k in options_raw]
            if not ordered_keys:
                ordered_keys = list(options_raw.keys())
            items = []
            for key in ordered_keys:
                value = options_raw.get(key)
                if isinstance(value, dict):
                    item = dict(value)
                    item.setdefault('text', str(value.get('text') or ''))
                else:
                    item = {'text': str(value or '')}
                item['_label'] = str(key)
                items.append(item)
            return items

        if isinstance(options_raw, list):
            items = []
            for opt in options_raw:
                if isinstance(opt, dict):
                    items.append(opt)
                elif isinstance(opt, str):
                    items.append({'text': opt})
            return items

        return []

    @staticmethod
    def _normalize_questions(raw_questions: List[Dict]) -> List[Dict]:
        """
        Chuẩn hoá output — đảm bảo mỗi câu hỏi tuân thủ format thống nhất
        để frontend và bulk-save logic xử lý được.
        """
        normalized = []
        skipped = 0
        for idx, q in enumerate(raw_questions):
            if not isinstance(q, dict):
                print(f"[normalize] Skipped item {idx}: not a dict (type={type(q)})")
                skipped += 1
                continue

            # Trường hợp item là content block đơn lẻ (không phải question object).
            if AIGeneratorService._is_content_block(q):
                q = AIGeneratorService._to_question_from_blocks([q])

            q_type = AIGeneratorService._normalize_question_type(q.get('question_type') or q.get('type'))

            content_json = q.get('content_json', q.get('content', []))
            if not isinstance(content_json, list):
                content_json = []

            q_text = (
                q.get('text')
                or q.get('stem')
                or q.get('question')
                or q.get('prompt')
                or ''
            )
            q_text = str(q_text).strip()
            if not q_text:
                q_text = AIGeneratorService._blocks_to_text(content_json)

            if not content_json and q_text:
                content_json = [{'type': 'text', 'value': q_text}]

            item = {
                'question_type': q_type,
                'content_json': content_json,
                'text': q_text,
                'image': q.get('image', ''),
                'difficulty': q.get('difficulty', 'medium'),
                'context': q.get('context', ''),
                'correct_answer_text': (
                    q.get('correct_answer_text')
                    or q.get('answer')
                    or q.get('result')
                    or ''
                ),
                'options': [],
            }

            if q_type in ('multiple_choice', 'true_false'):
                raw_opts = AIGeneratorService._coerce_options(
                    q.get('options', q.get('choices', q.get('answers', [])))
                )

                for opt in raw_opts:
                    opt_content = opt.get('content_json', [])
                    if not isinstance(opt_content, list):
                        opt_content = []

                    opt_text = (opt.get('text') or '').strip()
                    if not opt_text:
                        opt_text = AIGeneratorService._blocks_to_text(opt_content)

                    if not opt_content and opt_text:
                        opt_content = [{'type': 'text', 'value': opt_text}]

                    item['options'].append({
                        'content_json': opt_content,
                        'text': opt_text,
                        'is_correct': bool(opt.get('is_correct', False)),
                        '_label': opt.get('_label'),
                    })

                # Suy diễn đáp án đúng nếu model trả về dạng key riêng.
                q_correct = q.get('correct_option') or q.get('answer_key') or q.get('correct_answer')
                has_correct = any(bool(o.get('is_correct')) for o in item['options'])
                if q_correct and item['options'] and not has_correct:
                    key = str(q_correct).strip()
                    idx_from_key = None
                    if len(key) == 1 and key.upper() in ('A', 'B', 'C', 'D'):
                        idx_from_key = ord(key.upper()) - ord('A')
                    elif key.isdigit():
                        n = int(key)
                        if 1 <= n <= len(item['options']):
                            idx_from_key = n - 1

                    if idx_from_key is not None and 0 <= idx_from_key < len(item['options']):
                        item['options'][idx_from_key]['is_correct'] = True

                # Làm sạch field nội bộ không dùng downstream.
                for o in item['options']:
                    if '_label' in o:
                        o.pop('_label', None)

            # Bỏ qua câu không có stem text và cũng không có ảnh trong stem.
            if not item['text'] and not AIGeneratorService._has_image_block(item['content_json']):
                print(f"[normalize] Skipped item {idx}: no text stem and no image block. Keys in raw: {list(q.keys())}")
                skipped += 1
                continue

            normalized.append(item)

        if skipped:
            print(f"[normalize] Total skipped: {skipped}/{len(raw_questions)}")
        return normalized

    # ─── 1. Trích xuất từ file (PDF, Docx, Ảnh) ──────────────────────────

    @classmethod
    def extract_from_file(cls, file_path: str, mime_type: str = None, subject_name: str = "") -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
        """Trích xuất câu hỏi từ file."""
        if not ai_client.is_configured(): raise ValueError("AI API key is not configured.")
        print(f"--- STARTING AI EXTRACTION FROM FILE: {file_path} ---")
        ext = os.path.splitext(file_path)[1].lower()
        images_map = {}
        try:
            if ext == '.docx':
                response, images_map = cls._extract_docx(file_path, subject_name=subject_name)
            else:
                response = cls._extract_generic(file_path, subject_name=subject_name)
            
            raw_text = response.text
            questions = cls._parse_model_json(raw_text)
            if not questions: raise ValueError("AI trả về dữ liệu không đúng JSON array.")
            if cls._looks_like_content_blocks_list(questions):
                questions = cls._fallback_questions_from_blocks(questions)
            normalized = cls._normalize_questions(questions)
            if len(normalized) == 1:
                only = normalized[0]
                if only.get('question_type') == 'short_answer' and not only.get('options'):
                    split_qs = cls._split_text_to_short_answer_questions(str(only.get('text') or ''))
                    if split_qs: normalized = cls._normalize_questions(split_qs)
            if not normalized: raise ValueError("AI không trích xuất được câu hỏi hợp lệ.")
            return normalized, images_map
        except Exception as e:
            print(f"ERROR in extract_from_file: {str(e)}"); raise

    @classmethod
    def _extract_docx(cls, file_path: str, subject_name: str = ""):
        """Trích xuất DOCX - Single-pass."""
        from .docx_parser import DocxNativeParser
        try:
            content_blocks = DocxNativeParser.parse_docx(file_path)
            images_map = {b['sha256']: b['url'] for b in content_blocks if b.get('type') == 'image' and b.get('sha256')}
            compact_blocks = cls._compact_blocks_for_prompt(content_blocks, max_blocks=MAX_BLOCKS_EXTRACTION)
            compact_text_source = cls._to_compact_source(compact_blocks)
            prompt = f"Nội dung DOCX (Compact). Môn: {subject_name or 'Tự động'}.\n\nSOURCE:\n{compact_text_source}"
            class _FR:
                def __init__(self, t): self.text = t
            resp = ai_client.generate_content([EXTRACTION_PROMPT, prompt], model=FILE_EXTRACTION_MODEL, config=GENERATION_CONFIG_JSON_STRICT)
            return _FR(resp.text), images_map
        except Exception as e: raise ValueError(f"Lỗi DOCX: {e}")

    @classmethod
    def _extract_generic(cls, file_path: str, subject_name: str = ""):
        """PDF/Image - Single-pass."""
        uploaded_file = ai_client.upload_file(path=file_path)
        try:
            parts = [EXTRACTION_PROMPT_GENERIC, uploaded_file]
            if subject_name: parts.append(f"\nMôn: {subject_name}")
            return ai_client.generate_content(parts, model=FILE_EXTRACTION_MODEL, config=GENERATION_CONFIG_JSON_STRICT)
        finally:
            if hasattr(uploaded_file, 'name') and uploaded_file.name:
                try: ai_client.delete_file(uploaded_file.name)
                except Exception: pass

    # ─── 2. RAG & AI Tutor ──────────────────────────────────────────────

    @classmethod
    def generate_from_rag(cls, topic: str, count: int, difficulty: str, class_id: str, question_types: str = 'multiple_choice', document_id: int = None):
        """Sinh câu hỏi từ RAG."""
        from ai_core.models import DocumentChunk
        from pgvector.django import L2Distance
        query_emb = ai_client.embed_content(content=topic, task_type="RETRIEVAL_QUERY", output_dimensionality=768)
        qs = DocumentChunk.objects.filter(document__classroom_id=class_id)
        if document_id: qs = qs.filter(document_id=document_id)
        chunks = qs.annotate(dist=L2Distance('embedding', query_emb)).order_by('dist')[:20]
        context = cls._build_rag_context(list(chunks))
        if not context.strip(): raise ValueError("Lớp chưa có tài liệu.")
        prompt = RAG_GENERATION_PROMPT_TEMPLATE.format(count=count, topic=topic, difficulty=difficulty, question_types=question_types, context=context)
        resp = ai_client.generate_content(prompt, model=RAG_GENERATION_MODEL, config=GENERATION_CONFIG_RAG)
        return cls._normalize_questions(cls._parse_model_json(resp.text))

    @classmethod
    def ingest_document(cls, file_path: str, document_id: int) -> Dict[str, Any]:
        """Ingest document for RAG."""
        from ai_core.models import Document, DocumentChunk
        doc = Document.objects.get(id=document_id)
        ext = os.path.splitext(file_path)[1].lower()
        try:
            if ext == '.docx':
                from .docx_parser import DocxNativeParser
                text = cls._blocks_to_text(DocxNativeParser.parse_docx(file_path))
            elif ext == '.pdf':
                import fitz
                pdf = fitz.open(file_path)
                text = "\n".join([p.get_text() for p in pdf])
                pdf.close()
            else: raise ValueError("Không hỗ trợ RAG cho định dạng này.")
            if not text.strip(): return {"knowledge_chunks_count": 0}
            chunk_size = 1500
            chunks = [text[i:i+chunk_size] for i in range(0, len(text), chunk_size)]
            for idx, c in enumerate(chunks):
                emb = ai_client.embed_content(content=c, task_type="RETRIEVAL_DOCUMENT", output_dimensionality=768)
                DocumentChunk.objects.create(document=doc, chunk_index=idx, content=c, embedding=emb)
            return {"knowledge_chunks_count": len(chunks)}
        except Exception as e: print(f"Ingest error: {e}"); raise

    @classmethod
    def chat_with_tutor(cls, class_id: str, question: str) -> str:
        """AI Tutor Chat (RAG)."""
        from ai_core.models import DocumentChunk
        from pgvector.django import L2Distance
        query_emb = ai_client.embed_content(content=question, task_type="RETRIEVAL_QUERY", output_dimensionality=768)
        chunks = DocumentChunk.objects.filter(document__classroom_id=class_id).annotate(dist=L2Distance('embedding', query_emb)).order_by('dist')[:10]
        context = cls._build_rag_context(list(chunks), max_total_chars=10000)
        if not context.strip(): return "Lớp chưa có tài liệu tham khảo."
        prompt = f"Bạn là AI Tutor của NVH Learning. Trả lời dựa trên ngữ cảnh này:\n{context}\n\nHọc sinh hỏi: {question}"
        resp = ai_client.generate_content(prompt, model=RAG_GENERATION_MODEL)
        return resp.text
