import os
import json
import zipfile
import tempfile
import docx
import uuid
import re
import google.generativeai as genai
from typing import List, Dict, Any
from django.conf import settings

# Ensure API key and model name are configured
api_key = os.environ.get('GEMINI_API_KEY')
model_name = os.environ.get('GEMINI_MODEL_NAME', 'gemini-flash-latest')

if api_key:
    genai.configure(api_key=api_key)

# ─── Prompt: Trích xuất câu hỏi đa dạng từ tài liệu ────────────────────────
EXTRACTION_PROMPT = """
Bạn là hệ thống trích xuất dữ liệu bài tập (Data Extractor) cho nền tảng giáo dục.
Nhiệm vụ: đọc nội dung tài liệu (dạng chuỗi content_blocks) và bóc tách ra toàn bộ CÂU HỎI, phân loại theo 3 dạng format đề thi THPT 2025:

DẠNG 1 — multiple_choice (Trắc nghiệm chọn 1/4):
  - Mỗi câu có 4 phương án A, B, C, D. Thí sinh chọn 1 đáp án đúng duy nhất.

DẠNG 2 — true_false (Đúng/Sai):
  - Có 1 ngữ cảnh chung (hình vẽ, sơ đồ, thí nghiệm, bài toán...).
  - Kèm 4 phát biểu (a, b, c, d). Mỗi phát biểu là Đúng hoặc Sai riêng biệt.

DẠNG 3 — short_answer (Trả lời ngắn):
  - Thí sinh tính toán và điền kết quả. Không có phương án gợi ý.

QUY TẮC ẢNH (RẤT QUAN TRỌNG):
    - KHÔNG lấy hoặc KHÔNG giữ các ảnh KHÔNG LIÊN QUAN tới nội dung câu hỏi: các hình trang trí, watermark, khung/ô vuông để ghi đáp án, checkbox, hoặc các shape chỉ phục vụ bố cục.
    - Chỉ giữ ảnh khi ảnh đó trực tiếp minh hoạ (đồ thị, sơ đồ, hình vẽ, ảnh thí nghiệm, mô tả hình học...).
    - Nếu một ảnh chỉ biểu thị ô trống/ô đáp án hay là hình đánh dấu (ví dụ ô vuông để thí sinh gạch), hãy bỏ ảnh đó khỏi `content_json`.
    - Nếu không chắc, ưu tiên loại bỏ ảnh trang trí hơn là giữ ảnh không liên quan.

QUY TẮC BẮT BUỘC:
1. Bạn sẽ nhận được MÃ NGUỒN CỦA TÀI LIỆU DƯỚI DẠNG MẢNG CÁC KHỐI (Blocks). Mỗi khối text có:
     {"type": "text", "value": "...", "fmt": {"bold": true, "underline": true, "highlight": true, "highlight_color": "yellow", "color": "FF0000"}}
   Mỗi khối ảnh có:
     {"type": "image", "sha256": "..."}
   Trường `fmt` chỉ xuất hiện khi có định dạng đặc biệt. Khi không có `fmt` nghĩa là text bình thường.

2. NHẬN DIỆN ĐÁP ÁN ĐÚNG theo thứ tự ưu tiên sau:
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   [MỨC 1] Bảng đáp án cuối đề (Ưu tiên cao nhất):
     - Nếu có block text dạng "[BẢNG ĐÁP ÁN]", đây là nguồn chính xác nhất.
     - Ví dụ: | 1 | 2 | 3 | 4 | → | A | C | B | D |
     - Phải dùng bảng này để gán đáp án đúng cho tất cả câu hỏi.

   [MỨC 2] Định dạng trực quan của từng phương án:
     - "underline": true → phương án đó CÓ THỂ là đáp án đúng (gạch chân).
     - "highlight": true (bất kỳ màu gì) → phương án đó CÓ THỂ là đáp án đúng.
     - "color" khác đen (ví dụ "FF0000" đỏ, "0070C0" xanh lam) → phương án đó CÓ THỂ là đáp án đúng.
     - "bold": true ĐỨNG ĐỘC LẬP (không phải tiêu đề) → phương án đó CÓ THỂ là đáp án đúng.
     - Nếu nhiều phương án cùng lúc có định dạng giống nhau (ví dụ: tất cả A,B,C,D đều bold), KHÔNG dùng làm tiêu chí.

   [MỨC 3] Không xác định được:
     - Nếu không có bảng đáp án, không có định dạng đặc biệt → đặt is_correct: false cho tất cả.

3. Khi trả về JSON câu hỏi và phương án, sử dụng định dạng `content_json` (mảng blocks) y như đầu vào.
   Ghép đúng các block image vào đúng vị trí của đoạn text mà nó kèm theo.
   TRONG `content_json` OUTPUT, BỎ QUA trường `fmt` — chỉ giữ `type`, `value`, `sha256`.

4. Trường `image` của question truyền thống bị huỷ bỏ, đẩy tất cả ảnh vào `content_json`.

OUTPUT FORMAT BẮT BUỘC (Trả về duy nhất JSON array, không kèm text/giải thích):
[
  {
    "question_type": "multiple_choice",
    "difficulty": "medium",
    "content_json": [
       {"type": "text", "value": "Nội dung câu "},
       {"type": "image", "sha256": "a3f9c...", "width_pt": 78, "height_pt": 18.5},
       {"type": "text", "value": " là gì?"}
    ],
    "options": [
      {
        "content_json": [ {"type": "text", "value": "Phương án A"} ], 
        "is_correct": true
      },
      {
        "content_json": [
           {"type": "text", "value": "Phương án B kèm ảnh: "},
           {"type": "image", "sha256": "b1b2...", "width_pt": 50, "height_pt": 10}
        ], 
        "is_correct": false
      }
    ]
  },
  {
    "question_type": "true_false",
    "difficulty": "hard",
    "context": "Ngữ cảnh, mô tả...",
    "content_json": [ {"type": "text", "value": "Xét các phát biểu:"} ],
    "options": [
      {"content_json": [ {"type": "text", "value": "Phát biểu a: ..."} ], "is_correct": true}
    ]
  },
  {
    "question_type": "short_answer",
    "difficulty": "hard",
    "content_json": [ {"type": "text", "value": "Tính giá trị... "} ],
    "correct_answer_text": "42"
  }
]
"""

# BỔ SUNG QUY TẮC ẢNH: KHÔNG lấy các ảnh trang trí/ô vuông/khung dành cho ghi đáp án.
# Chỉ giữ ảnh có ý nghĩa thông tin (đồ thị, hình vẽ, sơ đồ). Nếu ảnh chỉ là ô để ghi đáp án hoặc ký hiệu layout, bỏ qua.



EXTRACTION_PROMPT_GENERIC = """
Bạn là hệ thống trích xuất câu hỏi từ tài liệu học tập.

Nhiệm vụ:
- Đọc tài liệu đầu vào (PDF hoặc ảnh).
- Trích xuất các câu hỏi theo 3 dạng: multiple_choice, true_false, short_answer.
- Nếu không chắc đáp án đúng, để is_correct=false hoặc để trống correct_answer_text.

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
Bạn là hệ thống tạo câu hỏi tự động cho nền tảng giáo dục NVH Learning.
Nhiệm vụ: dựa vào TÀI LIỆU TRÍCH XUẤT được cung cấp, tạo ra {count} câu hỏi chất lượng cao.

YÊU CẦU:
- Chủ đề / phạm vi: {topic}
- Số lượng câu hỏi: {count}
- Độ khó: {difficulty}
- Dạng câu hỏi cần tạo: {question_types}

QUY TẮC:
1. CHỈ dựa trên nội dung trong TÀI LIỆU TRÍCH XUẤT. KHÔNG tự bịa thông tin ngoài.
2. Câu hỏi phải phù hợp với format đề thi THPT 2025.
3. Mỗi câu hỏi phải rõ ràng, không mập mờ.
4. Đáp án đúng phải chính xác, có thể kiểm chứng từ tài liệu.

TÀI LIỆU TRÍCH XUẤT:
{context}

OUTPUT FORMAT BẮT BUỘC (Trả về duy nhất JSON array, không kèm text nào khác):
[
  {{
    "question_type": "multiple_choice",
    "text": "Nội dung câu hỏi?",
    "difficulty": "{difficulty}",
    "options": [
      {{"text": "Phương án A", "is_correct": true}},
      {{"text": "Phương án B", "is_correct": false}},
      {{"text": "Phương án C", "is_correct": false}},
      {{"text": "Phương án D", "is_correct": false}}
    ]
  }},
  {{
    "question_type": "true_false",
    "text": "Xét các phát biểu sau:",
    "context": "Ngữ cảnh...",
    "difficulty": "{difficulty}",
    "options": [
      {{"text": "Phát biểu a", "is_correct": true}},
      {{"text": "Phát biểu b", "is_correct": false}},
      {{"text": "Phát biểu c", "is_correct": true}},
      {{"text": "Phát biểu d", "is_correct": false}}
    ]
  }},
  {{
    "question_type": "short_answer",
    "text": "Tính giá trị...",
    "difficulty": "{difficulty}",
    "correct_answer_text": "42"
  }}
]
"""


class AIGeneratorService:
    """Service tạo/trích xuất câu hỏi bằng AI — dùng chung cho cả File extraction và RAG."""

    @staticmethod
    def _parse_gemini_json(text: str) -> List[Dict[str, Any]]:
        """Làm sạch response của Gemini và parse thành JSON."""
        clean_text = text.strip()

        # 1) Parse trực tiếp nếu response đã là JSON thuần.
        try:
            parsed = json.loads(clean_text)
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            pass

        # 2) Tìm fenced code blocks kiểu ```json ... ```.
        code_blocks = re.findall(r'```(?:json)?\s*(.*?)```', clean_text, flags=re.DOTALL | re.IGNORECASE)
        for block in code_blocks:
            try:
                parsed = json.loads(block.strip())
                if isinstance(parsed, list):
                    return parsed
            except json.JSONDecodeError:
                continue

        # 3) Tìm JSON array đầu tiên bằng bracket matching (tránh regex greedy).
        candidate = AIGeneratorService._extract_first_json_array(clean_text)
        if candidate:
            try:
                parsed = json.loads(candidate)
                if isinstance(parsed, list):
                    return parsed
            except json.JSONDecodeError:
                pass

        print("--- FAILED TO PARSE GEMINI JSON ---")
        print(f"Raw Text: {text[:1200]}...")
        print("------------------------------------")
        return []

    @staticmethod
    def _extract_first_json_array(text: str) -> str:
        """Trích xuất JSON array đầu tiên trong chuỗi bằng bracket matching."""
        start = text.find('[')
        while start != -1:
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

            start = text.find('[', start + 1)

        return ''

    @staticmethod
    def _blocks_to_text(blocks: Any) -> str:
        if not isinstance(blocks, list):
            return ''
        parts = []
        for b in blocks:
            if isinstance(b, dict) and b.get('type') == 'text' and isinstance(b.get('value'), str):
                parts.append(b.get('value'))
        return ' '.join(parts).strip()

    @staticmethod
    def _has_image_block(blocks: Any) -> bool:
        if not isinstance(blocks, list):
            return False
        return any(isinstance(b, dict) and b.get('type') == 'image' for b in blocks)

    @staticmethod
    def _compact_blocks_for_prompt(blocks: List[Dict[str, Any]], max_blocks: int = 1200) -> List[Dict[str, Any]]:
        """
        Giảm token đầu vào bằng cách chỉ giữ field cần thiết cho model.
        V2: Giữ lại `fmt` (bold, underline, highlight, color) để AI nhận diện đáp án đúng.
        """
        compact = []
        for b in blocks[:max_blocks]:
            if not isinstance(b, dict):
                continue
            b_type = b.get('type')
            if b_type == 'text':
                val = (b.get('value') or '').strip()
                if not val:
                    continue
                item = {'type': 'text', 'value': val}
                # Giữ lại fmt nếu có — đây là tín hiệu đáp án đúng quan trọng
                fmt = b.get('fmt')
                if fmt:
                    item['fmt'] = fmt
                compact.append(item)
            elif b_type == 'image':
                item = {'type': 'image', 'sha256': b.get('sha256')}
                if b.get('width_pt') is not None:
                    item['width_pt'] = b.get('width_pt')
                if b.get('height_pt') is not None:
                    item['height_pt'] = b.get('height_pt')
                compact.append(item)
        return compact

    @staticmethod
    def _normalize_questions(raw_questions: List[Dict]) -> List[Dict]:
        """
        Chuẩn hoá output — đảm bảo mỗi câu hỏi tuân thủ format thống nhất
        để frontend và bulk-save logic xử lý được.
        """
        normalized = []
        for q in raw_questions:
            if not isinstance(q, dict):
                continue

            q_type = q.get('question_type', 'multiple_choice')
            if q_type not in ('multiple_choice', 'true_false', 'short_answer'):
                q_type = 'multiple_choice'

            content_json = q.get('content_json', [])
            if not isinstance(content_json, list):
                content_json = []

            q_text = (q.get('text') or '').strip()
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
                'correct_answer_text': q.get('correct_answer_text', ''),
                'options': [],
            }

            if q_type in ('multiple_choice', 'true_false'):
                for opt in q.get('options', []):
                    if not isinstance(opt, dict):
                        continue
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
                    })

            # Bỏ qua câu không có stem text và cũng không có ảnh trong stem.
            if not item['text'] and not AIGeneratorService._has_image_block(item['content_json']):
                continue

            normalized.append(item)
        return normalized

    # ─── 1. Trích xuất từ file (PDF, Docx, Ảnh) ──────────────────────────

    @classmethod
    def extract_from_file(cls, file_path: str, mime_type: str = None) -> List[Dict[str, Any]]:
        """
        Trích xuất câu hỏi từ file — hỗ trợ 3 dạng THPT 2025.
        """
        if not api_key:
            raise ValueError("GEMINI_API_KEY is not configured.")

        print(f"--- STARTING AI EXTRACTION FROM FILE: {file_path} ---")
        model = genai.GenerativeModel(model_name)
        ext = os.path.splitext(file_path)[1].lower()

        try:
            if ext == '.docx':
                response = cls._extract_docx(file_path, model)
            else:
                response = cls._extract_generic(file_path, model)

            print(f"Gemini response received. Parsing...")
            questions = cls._parse_gemini_json(response.text)
            if not questions:
                raise ValueError(
                    "AI trả về dữ liệu không đúng JSON array câu hỏi. "
                    "Vui lòng thử lại với tài liệu nhỏ hơn hoặc kiểm tra prompt/model."
                )
            normalized = cls._normalize_questions(questions)
            if not normalized:
                raise ValueError(
                    "AI đã phản hồi nhưng không trích xuất được câu hỏi hợp lệ "
                    "(có thể thiếu nội dung stem hoặc format không đúng)."
                )
            print(f"Extracted {len(normalized)} questions successfully.")
            return normalized
        except Exception as e:
            print(f"ERROR matching extraction: {str(e)}")
            raise e

    @classmethod
    def _extract_docx(cls, file_path: str, model):
        """Sử dụng DocxNativeParser quét text/hình ảnh inline -> json array blocks đưa LLM."""
        from .docx_parser import DocxNativeParser
        
        print(f"Extracting Blocks from DOCX: {file_path}")
        try:
            content_blocks = DocxNativeParser.parse_docx(file_path)
            print(f"Parsed {len(content_blocks)} content blocks from DOCX.")
            
            # Gửi nội dung dạng chuỗi JSON thô (bao gồm SHA-256 placeholder) để LLM đọc và sắp xếp
            compact_blocks = cls._compact_blocks_for_prompt(content_blocks)
            blocks_json_str = json.dumps(compact_blocks, ensure_ascii=False)
            
            content_parts = [EXTRACTION_PROMPT]
            
            # Giải thích cho Prompt
            content_parts.append(
                f"MÃ NGUỒN DOCX DƯỚI DẠNG CONTENT BLOCKS (Hãy phân bổ chính xác các block có type='image' với id SHA-256 vào câu hỏi mà nó kèm theo!):\n{blocks_json_str}"
            )
            
            return model.generate_content(content_parts)
            
        except Exception as e:
            print(f"DOCX Native parser failed, error: {e}")
            raise ValueError(f"Lỗi xử lý file DOCX: {e}")

    @classmethod
    def _extract_generic(cls, file_path: str, model):
        """Xử lý PDF bằng PyMuPDF (Render thành ảnh), hoặc ảnh thông thường."""
        ext = os.path.splitext(file_path)[1].lower()
        uploaded_images = []
        
        try:
            if ext == '.pdf':
                import fitz  # PyMuPDF
                print(f"Rendering PDF {file_path} to images...")
                doc = fitz.open(file_path)
                image_tmp_paths = []
                
                # Render các trang thành ảnh (zoom 2x để nét hơn)
                for page_num in range(len(doc)):
                    page = doc.load_page(page_num)
                    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
                    
                    file_name = f"pdf_page_{uuid.uuid4().hex}_{page_num+1}.jpg"
                    save_dir = os.path.join(settings.MEDIA_ROOT, 'questions', 'images')
                    os.makedirs(save_dir, exist_ok=True)
                    save_path = os.path.join(save_dir, file_name)
                    
                    pix.save(save_path)
                    
                    # Chúng ta không cần lưu rel_url cho ảnh của PDF trừ khi định trả về cho FE hiển thị
                    # PDF thường mang tính đọc một chiều, nhưng nếu có cắt được ảnh minh hoạ nổi bật AI sẽ tự trích.
                    image_tmp_paths.append(save_path)
                    
                doc.close()
                
                for path in image_tmp_paths:
                    uploaded = genai.upload_file(path=path)
                    uploaded_images.append(uploaded)
                    
                content_parts = [EXTRACTION_PROMPT_GENERIC]
                content_parts.append(f"\nTÀI LIỆU PDF {len(uploaded_images)} TRANG ĐÃ ĐƯỢC CHUYỂN THÀNH ẢNH SAU ĐÂY. "
                                     f"VUI LÒNG ĐỌC VÀ BÓC TÁCH CÂU HỎI:")
                content_parts.extend(uploaded_images)
                
                return model.generate_content(content_parts)

            else:
                # Ảnh đơn (.png, .jpg...)
                print(f"Uploading generic image {file_path} to Gemini File API...")
                uploaded_file = genai.upload_file(path=file_path)
                uploaded_images.append(uploaded_file)
                return model.generate_content([uploaded_file, EXTRACTION_PROMPT_GENERIC])
                
        finally:
            for uploaded_obj in uploaded_images:
                try:
                    genai.delete_file(uploaded_obj.name)
                    print(f"Deleted file {uploaded_obj.name} from Gemini.")
                except Exception as e:
                    pass

    # ─── 2. Sinh câu hỏi từ Tri thức Nội bộ (RAG) ───────────────────────

    @classmethod
    def generate_from_rag(
        cls,
        topic: str,
        count: int,
        difficulty: str,
        class_id: str,
        question_types: str = 'multiple_choice',
    ) -> List[Dict[str, Any]]:
        """
        Sinh câu hỏi dựa trên tri thức nội bộ (DocumentChunk embeddings).
        1. Tìm top-K chunks liên quan tới topic bằng vector similarity.
        2. Ghép context vào prompt, yêu cầu Gemini tạo câu hỏi.
        """
        if not api_key:
            raise ValueError("GEMINI_API_KEY is not configured.")

        from ai_core.models import DocumentChunk
        from pgvector.django import L2Distance

        # Bước 1: Embedding câu topic
        embed_result = genai.embed_content(
            model="models/gemini-embedding-001",
            content=topic,
            task_type="retrieval_query",
            output_dimensionality=768,
        )
        query_embedding = embed_result['embedding']

        # Bước 2: Tìm 10 chunks gần nhất thuộc lớp này
        closest_chunks = (
            DocumentChunk.objects
            .filter(document__classroom_id=class_id)
            .annotate(distance=L2Distance('embedding', query_embedding))
            .order_by('distance')[:10]
        )

        contexts = []
        for chunk in closest_chunks:
            contexts.append(f"[{chunk.document.title}]: {chunk.content}")

        context_text = "\n\n---\n\n".join(contexts)

        if not context_text.strip():
            raise ValueError(
                "Lớp học chưa có tài liệu nội bộ nào. "
                "Vui lòng upload tài liệu trước khi dùng tính năng này."
            )

        # Bước 3: Build prompt và gọi Gemini
        prompt = RAG_GENERATION_PROMPT_TEMPLATE.format(
            count=count,
            topic=topic,
            difficulty=difficulty,
            question_types=question_types,
            context=context_text,
        )

        model = genai.GenerativeModel(model_name)
        response = model.generate_content(prompt)

        questions = cls._parse_gemini_json(response.text)
        return cls._normalize_questions(questions)
