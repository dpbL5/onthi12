## II. Danh sách các chức năng (Features) của toàn Dự án

Dự án hiện có 4 App chính hoạt động (Accounts, Classes, Exams, AI_Core). Dưới đây là danh sách phân rã toàn bộ tính năng đang có sẵn:

### 1. Quản lý Tài khoản & Xác thực (Accounts)
- Đăng ký tài khoản (Register).
- Đăng nhập (JWT auth).
- Đăng xuất (Blacklist/Discard token JWT).
- Refresh Token.
- Xem thông tin cá nhân hiện tại (Me View).
- Xem thống kê tổng quan (Dashboard Stats).
- Quản lý người dùng: Xem danh sách và chi tiết User (Dành riêng cho Admin).

### 2. Quản lý Lớp học & Môn học (Classes)
- Quản lý Môn học (CRUD Subject).
- Quản lý Lớp học (CRUD Class - gán giáo viên chủ nhiệm).
- Học sinh chủ động tham gia lớp học bằng mã hoặc yêu cầu (Join Class).
- Theo dõi & quản lý danh sách học sinh thuộc lớp.

### 3. Hệ thống Thi & Ngân hàng câu hỏi (Exams)
- **Giáo viên/Admin:**
  - Quản lý ngân hàng câu hỏi thủ công (CRUD Question & Option).
  - Tích hợp upload ảnh từ trình soạn thảo.
  - Quản lý đề thi (CRUD Quiz).
  - Gán câu hỏi từ ngân hàng vào đề thi theo thứ tự và phân bổ điểm.
  - Xem phân tích/thống kê phổ điểm lớp học và các câu hay sai `ClassAnalyticsView`.
- **Học sinh:**
  - Xem danh sách đề thi khả dụng trong các lớp mình tham gia.
  - Bắt đầu tính giờ thi (`QuizStartView`).
  - Nộp bài, chấm điểm tự động tức thì theo đáp án hệ thống (`QuizSubmitView`).

### 4. Tính năng AI Tích hợp (AI Core & AI Generator)
- **Học tập với AI (Dành cho Học sinh):**
  - **Chatbot Gia sư RAG:** Cho phép học sinh trò chuyện và hỏi đáp kiến thức bài học. AI sẽ chỉ trả lời dựa trên file tài liệu mà giáo viên đã cung cấp cho lớp đó.
- **Trợ lý AI (Dành cho Giáo viên):**
  - **Tạo câu hỏi từ File:** Giáo viên ném 1 file PDF/Docx bất kỳ, AI sẽ trích xuất và biến nó thành các câu lệnh trắc nghiệm/đáp án.
  - **Tạo câu hỏi từ RAG:** Lệnh cho AI tự lấy tri thức đã giảng dạy của lớp ra để sinh thành bộ đề kiểm tra ngẫu nhiên.
  - **Lưu trữ tự động:** Lưu hàng trăm câu hỏi AI sinh ra vào DB chỉ qua 1 nút bấm (`AIBulkSaveQuestionsView`).
  - **AI Insight Lớp học:** Phân tích dữ liệu bảng điểm của học sinh và đưa ra lời khuyên sư phạm, phát hiện lỗ hổng kiến thức để giáo viên cải thiện giáo án.
  - **Quản lý Hệ tri thức RAG:** Giáo viên có thể upload các tài liệu giảng dạy lên `ai_core`, hệ thống sẽ bóc text mã hoá thành các vector (DocumentChunk) vào thư viện riêng của từng lớp.
