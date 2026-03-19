const token = localStorage.getItem('access');
let _allUsers = [];
let _currentUserId = null;
let _currentSubjectId = null;
let _currentClassId = null;
let _subjects = [];

if (!token) { window.location.href = '/login/'; }

function ah() { return {'Content-Type':'application/json', 'Authorization':'Bearer ' + token}; }
function formatDate(dt) { return new Date(dt).toLocaleDateString('vi-VN'); }

const ROLE_BADGE = {
  admin: '<span class="badge rounded-pill bg-danger-subtle text-danger border border-danger border-opacity-25 px-3">Quản trị</span>',
  teacher: '<span class="badge rounded-pill bg-warning-subtle text-warning border border-warning border-opacity-25 px-3 text-dark">Giáo viên</span>',
  student: '<span class="badge rounded-pill bg-primary-subtle text-primary border border-primary border-opacity-25 px-3">Học sinh</span>',
};

// ── Tab switching ────────────────────────────────────────────
function showTab(name) {
  ['users','classes','subjects'].forEach(t => {
    const el = document.getElementById('tab-'+t);
    if (el) el.style.display = t===name ? 'block' : 'none';
  });
  // Support both old nav-link and new admin-tab-btn
  const tabs = document.querySelectorAll('#adminTabs .admin-tab-btn, #adminTabs .nav-link');
  const names = ['users','classes','subjects'];
  tabs.forEach((el, i) => {
    const isActive = names[i] === name;
    if (el.classList.contains('nav-link')) {
      el.classList.toggle('active', isActive);
    } else {
      el.style.background = isActive ? 'var(--color-primary)' : 'transparent';
      el.style.color = isActive ? '#fff' : 'var(--color-muted)';
    }
  });
  if (name === 'classes') loadAllClasses();
  if (name === 'subjects') loadSubjects();
}

// ── Init ─────────────────────────────────────────────────────
async function init() {
  const meRes = await fetch('/api/accounts/me/', {headers: ah()});
  if (!meRes.ok) { window.location.href = '/login/'; return; }
  const me = await meRes.json();
  if (me.role?.name !== 'admin') {
    showGlobalAlert('Bạn không có quyền truy cập trang quản trị.', 'danger');
    setTimeout(() => window.location.href = '/dashboard/', 2000);
    return;
  }
  await loadUsers();
  await loadSubjectsListOnly();
}

async function loadSubjectsListOnly() {
    const res = await fetch('/api/classes/subjects/', {headers: ah()});
    if (res.ok) _subjects = await res.json();
}

// ── Users tab ────────────────────────────────────────────────
async function loadUsers() {
  const tbody = document.getElementById('usersBody');
  const res = await fetch('/api/accounts/users/', {headers: ah()});
  if (!res.ok) return;
  _allUsers = await res.json();
  renderUsers(_allUsers);

  // Update stat cards with animation
  animateCount('statUsers', _allUsers.length);
  animateCount('statStudents', _allUsers.filter(u => u.role?.name === 'student').length);
  animateCount('statTeachers', _allUsers.filter(u => u.role?.name === 'teacher').length);
}

function animateCount(id, target) {
    let current = 0;
    const el = document.getElementById(id);
    const step = Math.ceil(target / 20) || 1;
    const timer = setInterval(() => {
        current += step;
        if (current >= target) {
            el.textContent = target;
            clearInterval(timer);
        } else {
            el.textContent = current;
        }
    }, 30);
}

function renderUsers(users) {
  const tbody = document.getElementById('usersBody');
  if (!users.length) { tbody.innerHTML = '<tr><td colspan="7" class="text-center py-5 text-muted"><i class="bi bi-info-circle me-1"></i>Không tìm thấy người dùng nào.</td></tr>'; return; }
  tbody.innerHTML = users.map((u, i) => `
    <tr class="fade-in-row">
      <td class="text-muted small">${i+1}</td>
      <td class="fw-bold"><code>@${u.username}</code></td>
      <td class="small fw-semibold text-secondary">${[u.last_name, u.first_name].filter(Boolean).join(' ') || '—'}</td>
      <td class="small text-muted">${u.email}</td>
      <td class="text-center">${ROLE_BADGE[u.role?.name] || u.role?.name || '—'}</td>
      <td class="small text-muted fw-bold">${u.created_at ? formatDate(u.created_at) : '—'}</td>
      <td class="text-center">
        <button class="btn btn-sm btn-light text-danger rounded-pill px-3 shadow-none border" onclick="openChangeRole('${u.id}','${u.username}','${u.role?.name}')">
          <i class="bi bi-pencil-square me-1"></i>Vai trò
        </button>
      </td>
    </tr>`).join('');
}

function filterUsers(q) {
  const filtered = _allUsers.filter(u =>
    u.username.toLowerCase().includes(q.toLowerCase()) ||
    u.email.toLowerCase().includes(q.toLowerCase())
  );
  renderUsers(filtered);
}

window.openChangeRole = function(uid, uname, currentRole) {
  _currentUserId = uid;
  document.getElementById('crUsername').textContent = uname;
  document.getElementById('crNewRole').value = currentRole || 'student';
  document.getElementById('crError').textContent = '';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('changeRoleModal')).show();
}

window.submitChangeRole = async function() {
  const role_name = document.getElementById('crNewRole').value;
  const res = await fetch(`/api/accounts/users/${_currentUserId}/`, {
    method: 'PATCH',
    headers: ah(),
    body: JSON.stringify({role_name})
  });
  const data = await res.json();
  if (res.ok) {
    bootstrap.Modal.getInstance(document.getElementById('changeRoleModal')).hide();
    showGlobalAlert('Cập nhật vai trò người dùng thành công!', 'success');
    await loadUsers();
  } else {
    document.getElementById('crError').textContent = data.detail || 'Không thể cập nhật.';
  }
}

// ── Classes tab ──────────────────────────────────────────────
window.loadAllClasses = async function() {
  const res = await fetch('/api/classes/', {headers: ah()});
  if (!res.ok) return;
  const classes = await res.json();
  document.getElementById('statClasses').textContent = classes.length;
  document.getElementById('classCountLabel').textContent = `${classes.length} lớp học`;
  const grid = document.getElementById('allClassesList');
  if (!classes.length) { grid.innerHTML = '<div class="col-12 py-5 text-center text-muted"><p>Chưa có lớp học nào được tạo.</p></div>'; return; }
  
  grid.innerHTML = classes.map(cls => `
    <div class="col-md-4 col-sm-6">
      <div class="card border-0 shadow-sm rounded-4 h-100 position-relative animate-fade-in group">
        <div class="card-body p-4">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <span class="badge bg-primary-subtle text-primary border border-primary border-opacity-25 rounded-pill px-3 py-1 small">${cls.subject_name}</span>
            <div class="op-button-group">
                <button class="btn btn-light btn-sm rounded-circle shadow-sm border text-primary" onclick="openEditClass('${cls.id}', '${cls.name.replace(/'/g, "\\'")}', '${cls.subject}', '${(cls.description || '').replace(/'/g, "\\'").replace(/\n/g, "\\n")}')"><i class="bi bi-pencil"></i></button>
                <button class="btn btn-light btn-sm rounded-circle shadow-sm border text-danger" onclick="confirmDelete('lớp', '${cls.name.replace(/'/g, "\\'")}', () => deleteClass('${cls.id}'))"><i class="bi bi-trash"></i></button>
            </div>
          </div>
          <h5 class="fw-bold mb-3 mt-2">${cls.name}</h5>
          <div class="d-flex align-items-center mb-2">
            <div class="bg-light rounded-circle me-2 p-1 px-2"><i class="bi bi-person text-secondary"></i></div>
            <div class="small fw-semibold text-muted">${[cls.teacher?.last_name, cls.teacher?.first_name].filter(Boolean).join(' ') || cls.teacher?.username}</div>
          </div>
          <div class="d-flex align-items-center mb-2">
            <div class="bg-light rounded-circle me-2 p-1 px-2"><i class="bi bi-people text-secondary"></i></div>
            <div class="small fw-semibold text-muted font-monospace">${cls.student_count} HỌC SINH</div>
          </div>
          <div class="d-flex align-items-center justify-content-between mb-3 small fw-semibold text-muted px-1">
             <span title="Bài thi"><i class="bi bi-file-earmark-text text-danger me-1"></i>${cls.total_quizzes ?? 0}</span>
             <span title="Lượt nộp"><i class="bi bi-send-check text-success me-1"></i>${cls.total_attempts ?? 0}</span>
             <span title="Điểm trung bình"><i class="bi bi-star-half text-warning me-1"></i>${cls.avg_score ?? 0}</span>
          </div>
          <div class="bg-light p-2 rounded-3 text-center border">
            <small class="text-muted me-2 border-end pe-2">MÃ MỜI</small>
            <strong class="text-dark font-monospace fw-bold fs-5">${cls.invite_code}</strong>
          </div>
        </div>
        <div class="card-footer bg-transparent border-top-0 px-4 pb-4 small text-muted d-flex justify-content-between">
           <span><i class="bi bi-calendar3 me-1"></i> ${formatDate(cls.created_at)}</span>
           <span class="fw-bold text-success-emphasis bg-success-subtle px-2 rounded-pill">Active</span>
        </div>
      </div>
    </div>`).join('');
}

window.openEditClass = function(id, name, subjectId, desc) {
    _currentClassId = id;
    document.getElementById('editClassName').value = name;
    document.getElementById('editClassDesc').value = (desc === 'null' || desc === 'None') ? '' : desc;
    const subSelect = document.getElementById('editClassSubject');
    subSelect.innerHTML = _subjects.map(s => `<option value="${s.id}" ${s.id == subjectId ? 'selected' : ''}>${s.name}</option>`).join('');
    document.getElementById('editClassError').textContent = '';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editClassModal')).show();
}

window.confirmEditClass = async function() {
    const name = document.getElementById('editClassName').value.trim();
    const subject = document.getElementById('editClassSubject').value;
    const description = document.getElementById('editClassDesc').value;
    if (!name) return;
    const res = await fetch(`/api/classes/${_currentClassId}/`, {
        method: 'PATCH',
        headers: ah(),
        body: JSON.stringify({ name, subject, description })
    });
    if (res.ok) {
        bootstrap.Modal.getInstance(document.getElementById('editClassModal')).hide();
        showGlobalAlert('Đã cập nhật thông tin lớp học!', 'success');
        loadAllClasses();
    } else {
        const data = await res.json();
        document.getElementById('editClassError').textContent = data.detail || 'Xảy ra lỗi khi cập nhật.';
    }
}

window.deleteClass = async function(id) {
    const res = await fetch(`/api/classes/${id}/`, { method: 'DELETE', headers: ah() });
    if (res.ok) {
        showGlobalAlert('Đã xoá lớp học vĩnh viễn.', 'success');
        loadAllClasses();
    } else {
        const data = await res.json();
        showGlobalAlert(data.detail || 'Lỗi: Không thể xoá lớp học này.', 'danger');
    }
}

// ── Subjects tab ─────────────────────────────────────────────
window.loadSubjects = async function() {
  const res = await fetch('/api/classes/subjects/', {headers: ah()});
  if (!res.ok) return;
  _subjects = await res.json();
  const container = document.getElementById('subjectsList');
  if (!_subjects.length) { container.innerHTML = '<p class="text-center text-muted">Chưa có môn học nào.</p>'; return; }
  
  container.innerHTML = _subjects.map(s => `
    <div class="col-md-3 col-sm-4 col-6 animate-fade-in">
      <div class="card border-0 shadow-sm rounded-4 text-center p-3 h-100 hover-lift bg-light-subtle">
        <div class="mb-2 text-primary fs-3"><i class="bi bi-book-fill"></i></div>
        <div class="fw-bold mb-3">${s.name}</div>
        <div class="d-flex justify-content-center gap-2">
            <button class="btn btn-sm btn-outline-primary rounded-pill px-3 shadow-none border bg-white" onclick="openEditSubject(${s.id}, '${s.name.replace(/'/g, "\\'")}')">
                <i class="bi bi-pencil-square"></i> Sửa
            </button>
            <button class="btn btn-sm btn-outline-danger rounded-pill px-3 shadow-none border bg-white" onclick="confirmDelete('môn học', '${s.name.replace(/'/g, "\\'")}', () => deleteSubject(${s.id}))">
                <i class="bi bi-trash"></i> Xoá
            </button>
        </div>
      </div>
    </div>`).join('');
}

window.submitAddSubject = async function() {
  const name = document.getElementById('newSubjectName').value.trim();
  const errEl = document.getElementById('subjectError');
  errEl.textContent = '';
  if (!name) { errEl.textContent = 'Tên môn học không được để trống.'; return; }
  const res = await fetch('/api/classes/subjects/', {
    method: 'POST',
    headers: ah(),
    body: JSON.stringify({name})
  });
  const data = await res.json();
  if (res.status === 201) {
    bootstrap.Modal.getInstance(document.getElementById('addSubjectModal')).hide();
    document.getElementById('newSubjectName').value = '';
    showGlobalAlert(`Đã thêm môn "${name}"!`, 'success');
    loadSubjects();
  } else {
    errEl.textContent = Object.values(data).flat().join(' ') || 'Không thể tạo môn học.';
  }
}

window.openEditSubject = function(id, name) {
    _currentSubjectId = id;
    document.getElementById('editSubjectName').value = name;
    document.getElementById('editSubjectError').textContent = '';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editSubjectModal')).show();
}

window.confirmEditSubject = async function() {
    const name = document.getElementById('editSubjectName').value.trim();
    if (!name) return;
    const res = await fetch(`/api/classes/subjects/${_currentSubjectId}/`, {
        method: 'PATCH',
        headers: ah(),
        body: JSON.stringify({name})
    });
    if (res.ok) {
        bootstrap.Modal.getInstance(document.getElementById('editSubjectModal')).hide();
        showGlobalAlert('Cập nhật môn học thành công!', 'success');
        loadSubjects();
    } else {
        const data = await res.json();
        document.getElementById('editSubjectError').textContent = data.detail || 'Lỗi cập nhật môn học.';
    }
}

window.deleteSubject = async function(id) {
    const res = await fetch(`/api/classes/subjects/${id}/`, { method: 'DELETE', headers: ah() });
    if (res.ok) {
        showGlobalAlert('Đã xoá môn học khỏi hệ thống.', 'success');
        loadSubjects();
    } else {
        const data = await res.json();
        showGlobalAlert(data.detail || 'Lỗi: Môn học có thể đang được các lớp học sử dụng.', 'danger');
    }
}

// ── Shared Utils ─────────────────────────────────────────────
let deleteAction = null;
window.confirmDelete = function(type, name, action) {
    deleteAction = action;
    document.getElementById('deleteConfirmMsg').innerHTML = `Bạn có chắc chắn muốn xoá ${type} <strong>"${name}"</strong> không? Thao tác này không thể hoàn tác!`;
    bootstrap.Modal.getOrCreateInstance(document.getElementById('deleteConfirmModal')).show();
}

document.addEventListener('DOMContentLoaded', () => {
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    if (confirmDeleteBtn) {
        confirmDeleteBtn.onclick = () => {
            if (deleteAction) {
                deleteAction();
                bootstrap.Modal.getInstance(document.getElementById('deleteConfirmModal')).hide();
            }
        };
    }
    const adminTabs = document.getElementById('adminTabs');
    if (adminTabs) {
        init();
    }
});
