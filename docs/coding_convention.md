# NVH Learning - Coding Convention

Để đảm bảo source code xuyên suốt các Phase sắp tới của dự án được nhất quán, trong sáng và dễ bảo trì, mọi lập trình viên làm việc trên `nvh_learning` cần tuân thủ bộ quy ước sau.

## 1. Ngôn ngữ & Framework
* Backend: Python 3+ với Django REST Framework (DRF).
* Frontend: HTML, Bootstrap 5 + Vanilla JavaScript.

## 2. Quy chuẩn Backend (Python/Django)
### 2.1. Đặt tên (Naming)
* **Variables & Functions:** `snake_case` (Ví dụ: `student_code`, `calculate_score()`).
* **Classes (Models, Views, Serializers):** `PascalCase` (Ví dụ: [StudentProfile](file:///d:/_projects/NguyenVanHuyenLearning/nvh_learning/accounts/models.py#76-90), [ClassListCreateView](file:///d:/_projects/NguyenVanHuyenLearning/nvh_learning/classes/views.py#8-15)).
* **Constants:** `UPPER_SNAKE_CASE` (Ví dụ: `MAX_UPLOAD_SIZE = 5242880`).

### 2.2. Tổ chức Code trong Django
* **Fat Models, Skinny Views:** Đưa tối đa các logic nghiệp vụ lõi (vd: tạo mã học sinh, format dữ liệu) vào trong Models hoặc Services. Views/API chỉ làm nhiệm vụ parse request, gọi model/serializer logic, và return response.
* **Serializers:** Ràng buộc dữ liệu ngầm định (vd: user hiện tại khi tạo bảng tin) phải thực hiện trong [perform_create()](file:///d:/_projects/NguyenVanHuyenLearning/nvh_learning/classes/views.py#13-15) của View hoặc tham chiếu tự động qua Serializer Context, không gửi gắm ở Frontend xuống nhằm bảo mật.
* **Querysets:** Hạn chế N+1 query. Mặc định phải dùng `select_related()` cho Foreign Keys (One-To-Many/One-To-One) và `prefetch_related()` cho Many-To-Many khi trả về list objects.

## 3. Quy chuẩn Frontend (HTML/JS)
* **DOM Selectors:** Sử dụng `document.getElementById` cho IDs (ưu tiên) hoặc `document.querySelector` nếu cần linh hoạt.
* **API Fetching:** Đồng bộ sử dụng `async/await` và [fetch](file:///d:/_projects/NguyenVanHuyenLearning/nvh_learning/templates/dashboard.html#18-36), tuyệt đối không dùng XMLHttpRequest cũ. Quản lý lỗi bằng `try/catch` hoặc check `res.ok`.

## 4. Tương tác Git/Task
* Bất cứ tính năng mới nào cũng phải được break ra thành các checklist cụ thể trong [task.md](file:///C:/Users/sivizstepp/.gemini/antigravity/brain/b2f91839-b33d-41ea-ba44-71dad3a9fe4e/task.md).
* Lỗi phát sinh cần thống kê chung, sửa gọn dứt điểm từng module.
