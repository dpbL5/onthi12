# Tổng hợp chức năng hệ thống (mức độ người dùng)

Dưới đây là tóm tắt các chức năng chính của hệ thống, mô tả ở góc nhìn người dùng (Học sinh, Giáo viên, Quản trị viên, và các tiện ích AI).

## 1) Xác thực & Tài khoản
- Đăng ký tài khoản mới (email/username).
- Đăng nhập/đăng xuất.

## 2) Học sinh (Student)
- Xem dashboard cá nhân.
- Duyệt danh sách lớp và tham gia lớp bằng liên kết/ mã.
- Xem chi tiết lớp, danh sách bạn học.
- Xem danh sách quiz dành cho mình (`My Quizzes`).
- Bắt đầu quiz, trả lời câu hỏi và nộp bài.
- Xem kết quả, điểm và phân tích cá nhân (nếu có).

## 3) Giáo viên (Teacher)
- Tạo / chỉnh sửa / xóa lớp và môn học.
- Quản lý học sinh trong lớp (danh sách, thêm/bỏ).
- Truy cập và quản lý Ngân hàng câu hỏi: tạo, sửa, xóa câu hỏi và phương án.
- Upload, liên kết và gỡ liên kết ảnh cho câu hỏi.
- Tạo quiz (tùy chỉnh câu hỏi, thời gian, điểm), tạo câu hỏi ngẫu nhiên cho quiz.
- Xem analytics theo lớp (hiệu suất học sinh, phân bố điểm).
- Xuất báo cáo / dữ liệu phục vụ giảng dạy.

## 4) Quản trị viên (Admin)
- Quản lý người dùng (danh sách, xem chi tiết, thay đổi vai trò).
- Xem báo cáo tổng quan hệ thống và xuất dữ liệu (export).

## 5) AI & Tài liệu thông minh
- Upload tài liệu lớp (docx/pdf) cho từng lớp.
- Trích xuất nội dung từ file (tự động phân tích nội dung để tạo câu hỏi).
- RAG Chatbot: hỏi đáp dựa trên tài liệu lớp / kiến thức đã tải lên.
- Sinh câu hỏi tự động từ RAG và lưu hàng loạt vào ngân hàng câu hỏi.
- Phân tích lớp (Class insight): tổng hợp điểm mạnh/yếu, đề xuất nội dung ôn tập.
