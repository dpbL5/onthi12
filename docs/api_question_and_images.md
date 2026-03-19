# Tong hop API Question + Images + AI

Tai lieu nay tong hop cac API lien quan den ngan hang cau hoi va quan ly nhieu hinh anh cho cau hoi.

## 1. Question Bank APIs

### GET /api/exams/questions/

- Muc dich: Lay danh sach cau hoi (co filter).
- Quyen: Teacher/Admin.
- Query params:
  - subject
  - difficulty
  - question_type
  - search
- Response moi co `question_images`.

### POST /api/exams/questions/

- Muc dich: Tao cau hoi moi.
- Quyen: Teacher/Admin.
- Body JSON (co ban):

```json
{
  "subject": 1,
  "difficulty": "medium",
  "question_type": "multiple_choice",
  "text": "Noi dung cau hoi",
  "context": "",
  "correct_answer_text": ""
}
```

### GET /api/exams/questions/{id}/

- Muc dich: Lay chi tiet cau hoi (gom options + question_images).
- Quyen: Teacher/Admin.

### PUT /api/exams/questions/{id}/update-full/

- Muc dich: Cap nhat day du cau hoi + options.
- Quyen: Teacher/Admin.

### DELETE /api/exams/questions/{id}/

- Muc dich: Xoa 1 cau hoi.
- Quyen: Teacher/Admin.

### POST /api/exams/questions/bulk-delete/

- Muc dich: Xoa nhieu cau hoi.
- Quyen: Teacher/Admin.
- Body JSON:

```json
{
  "ids": [11, 12, 13]
}
```

## 2. Question Image APIs (Moi)

### POST /api/exams/questions/images/upload/

- Muc dich: Upload anh vao ImageBank theo SHA-256 va co the link truc tiep vao question.
- Quyen: Teacher/Admin.
- Content-Type: multipart/form-data.
- Form fields:
  - image hoac file (bat buoc)
  - question_id (khong bat buoc, neu muon link ngay)
  - source_type: ai_scan | user_upload | system
  - placement: stem, choice_0, choice_1...
  - position: so thu tu
  - note: ghi chu
- Response:

```json
{
  "sha256": "...",
  "url": "http://.../media/questions/images/bank/...",
  "image_bank_created": true,
  "question_image_id": 99,
  "source_type": "user_upload"
}
```

### POST /api/exams/questions/{id}/images/link/

- Muc dich: Gan anh co san (theo SHA-256) vao cau hoi.
- Quyen: Teacher/Admin.
- Body JSON:

```json
{
  "sha256": "hex_sha256",
  "source_type": "ai_scan",
  "placement": "stem",
  "position": 0,
  "note": "anh tu AI"
}
```

### DELETE /api/exams/questions/{id}/images/{qimg_id}/

- Muc dich: Go lien ket anh khoi cau hoi.
- Quyen: Teacher/Admin.
- Luu y: Khong xoa anh goc trong ImageBank.

## 3. AI APIs lien quan anh + cau hoi

### POST /api/ai/generate/extract-file/

- Muc dich: Trich xuat cau hoi tu file bang AI.
- Quyen: Teacher/Admin.

### POST /api/ai/generate/from-rag/

- Muc dich: Sinh cau hoi tu RAG.
- Quyen: Teacher/Admin.

### POST /api/ai/generate/save-bulk/

- Muc dich: Luu nhieu cau hoi AI da duoc duyet vao DB.
- Quyen: Teacher/Admin.
- Ho tro quet `content_json` co block image va link sang `QuestionImage` voi `source_type=ai_scan`.

## 4. Dinh dang du lieu anh trong Question

Trong response Question:

```json
{
  "id": 1,
  "text": "...",
  "question_images": [
    {
      "id": 10,
      "image": {
        "sha256": "...",
        "image_url": "http://...",
        "original_filename": "hinh1.png",
        "mime_type": "image/png",
        "file_size": 12345,
        "width_pt": null,
        "height_pt": null,
        "created_at": "2026-03-19T..."
      },
      "position": 0,
      "placement": "stem",
      "source_type": "user_upload",
      "uploaded_by": 5,
      "uploaded_by_username": "teacher01",
      "note": "...",
      "created_at": "2026-03-19T..."
    }
  ]
}
```

## 5. Goi y frontend

- Neu nguoi dung dang tao cau hoi moi:
  - Buoc 1: POST /questions/ de tao cau hoi.
  - Buoc 2: Upload/link anh qua APIs moi.
- Neu edit cau hoi:
  - Lay GET /questions/{id}/ de hien thi danh sach anh da gan.
  - Cho phep unlink rieng tung anh bang DELETE /questions/{id}/images/{qimg_id}/.
- Metadata `placement` va `position` giup render dung vi tri anh trong giao dien.
