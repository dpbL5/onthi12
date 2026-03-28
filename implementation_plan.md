# Thêm biểu đồ Tiến Độ Học Tập cho Giáo Viên và Admin

Mục tiêu: Thêm biểu đồ đường/cột thể hiện điểm số trung bình của các bài thi theo từng lớp dành riêng cho Giáo viên và Admin trên Dashboard.

## Proposed Changes

---

### Backend API (Django)

#### [MODIFY] exams/views.py
Thêm một API View mới `TeacherAdminProgressAPIView` để tính điểm trung bình của các bài thi. 
- API này sẽ lấy các bài thi (quizzes) thuộc quyền quản lý của giáo viên (hoặc tất cả với admin) mà đã có lượt làm bài hoàn thành.
- Tính điểm trung bình (`Avg('score')`) cho từng bài.
- Giới hạn số lượng (ví dụ: 15-20 bài mới nhất) để biểu đồ hiển thị đẹp mắt.
- Định dạng dữ liệu trả về tương tự như của học sinh (nhưng hiển thị điểm trung bình thay vì điểm cá nhân).

#### [MODIFY] exams/urls.py
Đăng ký URL cho API mới: `path('teacher-progress/', TeacherAdminProgressAPIView.as_view(), name='teacher-progress')`.

---

### Frontend UI

#### [MODIFY] templates/dashboard.html
- Thêm một khu vực `teacherAnalyticsSection` hiển thị cho Teacher và Admin (tương đương với khu vực của học sinh).
- Sử dụng thẻ `<canvas id="teacherProgressChart"></canvas>` để chuẩn bị cho biểu đồ Chart.js.
- Bố cục sẽ được thiết kế đẹp mắt, gọn gàng trong các thẻ Card theo phong cách hiện đại (Premium UI).

#### [MODIFY] static/js/dashboard.js
- Thêm logic để kiểm tra `role === 'teacher' || role === 'admin'` và gọi API `/api/exams/teacher-progress/`.
- Sử dụng Chart.js (đã có sẵn thư viện) để vẽ biểu đồ Cột (Bar chart) hoặc Đường (Line chart) thể hiện Điểm trung bình bài thi theo lớp.
- Thêm chú giải (tooltip) hiển thị rõ tên lớp, tên bài thi và số lượng học sinh đã nộp bài.

## Open Questions

> [!IMPORTANT]
> - Bạn muốn biểu đồ này là **Biểu đồ đường (Line chart)** hay **Biểu đồ cột (Bar chart)**? (Biểu đồ cột thường dễ nhìn hơn khi so sánh giữa các bài thi/lớp khác nhau).
> - Bạn có muốn thêm bộ lọc chọn "Lớp học định cụ thể" ngay trên Dashboard không, hay mặc định chỉ gom nhóm 10-15 bài thi gần nhất của tất cả các lớp vào biểu đồ?

## Verification Plan
### Manual Verification
- Đăng nhập bằng tài khoản Giáo viên và Admin.
- Tới trang Dashboard và kiểm tra xem biểu đồ có xuất hiện không.
- Rà chuột lên các điểm/cột để xem chi tiết thông tin (Tên bài, Lớp, Điểm TB).
- Đăng nhập bằng Học sinh để đảm bảo Dashboard của Học sinh không bị ảnh hưởng.
