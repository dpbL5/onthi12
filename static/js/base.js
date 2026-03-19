// Navbar scroll effect
window.addEventListener('scroll', () => {
    document.getElementById('mainNavbar').classList.toggle('scrolled', window.scrollY > 10);
});

// Global alert helper
function showGlobalAlert(msg, type='success') {
    const container = document.getElementById('globalAlert');
    if (!container) return;
    const id = 'notif_' + Math.random().toString(36).substr(2, 9);
    const icon = type === 'success' ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill';
    const bg = type === 'success' ? '#10b981' : '#ef4444'; // Emerald 500 / Red 500
    
    const html = `
    <div id="${id}" class="alert animate-slide-in-right d-flex align-items-center gap-3 mb-0 shadow-lg border-0 text-white" 
         style="background:${bg}; border-radius:12px; padding:0.875rem 1.25rem; pointer-events:auto; backdrop-filter:blur(8px); min-height:60px;">
        <div style="background:rgba(255,255,255,0.2); width:32px; height:32px; border-radius:10px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
            <i class="bi ${icon} fs-5"></i>
        </div>
        <div style="font-weight:600; font-size:0.875rem; line-height:1.4;">${msg}</div>
        <button type="button" class="btn-close btn-close-white ms-auto opacity-50" style="font-size:0.65rem;" onclick="this.parentElement.remove()"></button>
    </div>`;
    
    container.insertAdjacentHTML('beforeend', html);
    
    // Auto-remove after 5s
    setTimeout(() => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add('animate-slide-out');
            el.addEventListener('animationend', () => el.remove());
        }
    }, 5000);
}

// Flash from sessionStorage
document.addEventListener('DOMContentLoaded', () => {
    const _alert = sessionStorage.getItem('globalAlert');
    if (_alert) {
        const {msg, type} = JSON.parse(_alert);
        showGlobalAlert(msg, type);
        sessionStorage.removeItem('globalAlert');
    }

    // Update navbar if logged in
    const _token = localStorage.getItem('access');
    if (_token) {
        // Fetch user info for avatar
        fetch('/api/accounts/me/', { headers: { 'Authorization': 'Bearer ' + _token } })
        .then(r => r.ok ? r.json() : null)
        .then(user => {
            if (!user) return;
            const initials = ((user.last_name || '')[0] || '') + ((user.first_name || '')[0] || user.username[0] || '');
            const roleIcons = { admin: 'bi-shield-check', teacher: 'bi-person-workspace', student: 'bi-mortarboard' };
            const navLinks = [
                { href: '/dashboard/', icon: 'bi-speedometer2', label: 'Dashboard' },
            ];
            if (user.role?.name !== 'student') {
                navLinks.push({ href: '/exams/question-bank/', icon: 'bi-bank2', label: 'Ngân hàng' });
            }
            document.getElementById('navAuthLinks').innerHTML = `
                ${navLinks.map(l => `<a href="${l.href}" class="nav-btn nav-btn-solid"><i class="bi ${l.icon}"></i> ${l.label}</a>`).join('')}
                <div class="nav-divider"></div>
                <div class="d-flex align-items-center gap-2 px-2">
                    <div style="width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;color:#fff;">
                        ${initials.toUpperCase()}
                    </div>
                    <span style="font-size:0.82rem;color:rgba(255,255,255,0.85);font-weight:500;">${user.first_name || user.username}</span>
                </div>
                <div class="nav-divider"></div>
                <button class="nav-btn nav-btn-logout" onclick="doLogout()"><i class="bi bi-box-arrow-right"></i> Thoát</button>
            `;
        }).catch(() => {});
    }
});

async function doLogout() {
    const refresh = localStorage.getItem('refresh');
    if (refresh) {
        try {
            await fetch('/api/accounts/logout/', {
                method: 'POST',
                headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('access')},
                body: JSON.stringify({refresh})
            });
        } catch (e) {}
    }
    localStorage.removeItem('access');
    localStorage.removeItem('refresh');
    window.location.href = '/login/';
}

// ── Report Export Helper (Shared) ────────────────────────────
window.exportReport = async function() {
    const token = localStorage.getItem('access');
    if (!token) return;

    // Create modal if not exists
    let modalEl = document.getElementById('exportReportModal');
    if (!modalEl) {
        const modalHtml = `
        <div class="modal fade" id="exportReportModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content shadow-lg border-0" style="border-radius:20px; overflow:hidden;">
                    <div class="modal-header border-bottom-0 pb-0 pt-4 px-4">
                        <h5 class="modal-title fw-800" style="font-size:1.4rem; color:var(--color-primary);">Xuất báo cáo Excel</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body py-4 px-4">
                        <p class="text-muted small mb-4">Vui lòng chọn lớp và khoảng thời gian bạn muốn truy xuất dữ liệu.</p>
                        <div class="mb-4">
                            <label class="form-label fw-700 small text-muted text-uppercase mb-2" style="letter-spacing:0.05em;">1. Chọn lớp học</label>
                            <select id="exportClassSelect" class="form-select shadow-sm border-0 bg-light" style="border-radius:12px; padding:0.85rem 1.25rem; font-weight:500;">
                                <option value="">Tất cả các lớp</option>
                            </select>
                        </div>
                        <div class="row g-3">
                            <div class="col-6">
                                <label class="form-label fw-700 small text-muted text-uppercase mb-2" style="letter-spacing:0.05em;">2. Từ ngày</label>
                                <input type="date" id="exportFromDate" class="form-control shadow-sm border-0 bg-light" style="border-radius:12px; padding:0.85rem 1.25rem;">
                            </div>
                            <div class="col-6">
                                <label class="form-label fw-700 small text-muted text-uppercase mb-2" style="letter-spacing:0.05em;">3. Đến ngày</label>
                                <input type="date" id="exportToDate" class="form-control shadow-sm border-0 bg-light" style="border-radius:12px; padding:0.85rem 1.25rem;">
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer border-top-0 pt-0 pb-4 px-4">
                        <button type="button" id="btnShowReport" class="btn btn-outline-primary border-0 fw-700 rounded-pill px-4">
                            <i class="bi bi-eye me-1"></i> Xem báo cáo
                        </button>
                        <button type="button" id="btnDoExport" class="btn btn-primary px-4 py-2" style="border-radius:12px; font-weight:700; background:var(--color-primary); box-shadow:0 4px 15px rgba(79,70,229,0.3);">
                            <i class="bi bi-cloud-arrow-down-fill me-2"></i> Xuất file ngay
                        </button>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        modalEl = document.getElementById('exportReportModal');
        
        document.getElementById('btnDoExport').onclick = async () => {
            const cid = document.getElementById('exportClassSelect').value;
            const from = document.getElementById('exportFromDate').value;
            const to = document.getElementById('exportToDate').value;
            
            let params = new URLSearchParams();
            if (cid) params.append('class_id', cid);
            if (from) params.append('from_date', from);
            if (to) params.append('to_date', to);
            
            let url = '/api/accounts/admin/export/?' + params.toString();
            
            const btn = document.getElementById('btnDoExport');
            const originalHtml = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Đang tạo file...';
            
            try {
                const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
                if (!res.ok) throw new Error();
                const blob = await res.blob();
                const a = document.createElement('a');
                a.href = window.URL.createObjectURL(blob);
                a.download = `bao_cao_bang_diem_${new Date().getTime()}.xlsx`;
                document.body.appendChild(a); a.click(); a.remove();
                bootstrap.Modal.getInstance(modalEl).hide();
                if (window.showGlobalAlert) showGlobalAlert('Xuất file thành công!');
            } catch (e) {
                alert('Lỗi khi xuất file. Vui lòng thử lại.');
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
        };

        document.getElementById('btnShowReport').onclick = () => {
            const cid = document.getElementById('exportClassSelect').value;
            const from = document.getElementById('exportFromDate').value;
            const to = document.getElementById('exportToDate').value;
            bootstrap.Modal.getInstance(modalEl).hide();
            window.openReportView(cid, from, to);
        };
    }

    // Load classes dynamically
    try {
        const res = await fetch('/api/classes/', { headers: { 'Authorization': 'Bearer ' + token } });
        const classes = await res.json();
        const select = document.getElementById('exportClassSelect');
        const savedVal = select.value;
        select.innerHTML = '<option value="">Tất cả các lớp</option>' + 
            classes.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        if (savedVal) select.value = savedVal;
    } catch (e) { console.error('Failed to load classes for export', e); }

    const modal = new bootstrap.Modal(modalEl);
    modal.show();
};

window.openReportView = function(classId, fromDate, toDate) {
    const section = document.getElementById('reportsSection');
    if (!section) {
        // If not on dashboard, we might want to redirect or show in a large modal
        // For now, assume dashboard integration as requested
        if (window.location.pathname.includes('/admin-panel/')) {
            alert('Vui lòng xem báo cáo tại Dashboard.');
            window.location.href = '/dashboard/';
            return;
        }
        return;
    }
    section.style.display = 'block';
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.loadReports(1, classId, fromDate, toDate);
};

window.loadReports = async function(page = 1, classId = '', fromDate = '', toDate = '') {
    const tbody = document.getElementById('reportsBody');
    if (!tbody) return;

    const token = localStorage.getItem('access');
    let url = `/api/accounts/admin/report/?page=${page}`;
    if (classId) url += `&class_id=${classId}`;
    if (fromDate) url += `&from_date=${fromDate}`;
    if (toDate) url += `&to_date=${toDate}`;
    
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-5"><div class="spinner-border spinner-border-sm text-primary"></div></td></tr>';
    
    const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
    if (res.ok) {
        const data = await res.json();
        renderReports(data.results || data);
        renderReportsPagination(data, classId, fromDate, toDate);
    } else {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-5 text-danger">Lỗi tải dữ liệu báo cáo.</td></tr>';
    }
}

function renderReports(reports) {
    const tbody = document.getElementById('reportsBody');
    if (!tbody) return;
    if (!reports || !reports.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-5 text-muted">Không có dữ liệu nộp bài nào.</td></tr>';
        return;
    }
    
    tbody.innerHTML = reports.map(r => `
        <tr class="fade-in-row">
            <td class="px-4">
                <div class="fw-bold text-dark">${r.student_name}</div>
                <div class="small text-muted font-monospace">${r.student_code}</div>
            </td>
            <td><span class="badge bg-light text-dark border rounded-pill px-2">${r.class_name}</span></td>
            <td><div class="small fw-semibold text-truncate" style="max-width:200px;">${r.quiz_title}</div></td>
            <td class="text-center">
                <span class="badge rounded-pill ${r.score >= 5 ? 'bg-success-subtle text-success' : 'bg-danger-subtle text-danger'} px-3 shadow-none border">
                    ${r.score}/10
                </span>
            </td>
            <td class="text-end text-muted small px-4">${new Date(r.completed_at).toLocaleString('vi-VN')}</td>
        </tr>
    `).join('');
}

function renderReportsPagination(data, classId, fromDate, toDate) {
    const container = document.getElementById('reportsPagination');
    if (!container) return;
    if (!data.count || data.count <= (data.results?.length || 0)) {
        container.innerHTML = `<small class="text-muted">Hiển thị tất cả ${data.count || 0} kết quả</small>`;
        return;
    }
    
    let html = `<nav aria-label="Page navigation"><ul class="pagination pagination-sm mb-0">`;
    const totalPages = Math.ceil(data.count / (data.page_size || 50));
    const currentPage = data.page || 1;
    
    for (let i = 1; i <= totalPages; i++) {
        html += `<li class="page-item ${i === currentPage ? 'active' : ''}">
            <a class="page-link" href="#" onclick="event.preventDefault(); window.loadReports(${i}, '${classId}', '${fromDate}', '${toDate}')">${i}</a>
        </li>`;
    }
    html += `</ul></nav>`;
    container.innerHTML = html;
}
