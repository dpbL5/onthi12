document.addEventListener('DOMContentLoaded', () => {
    const dashboardContent = document.getElementById('dashboardContent');
    if (!dashboardContent) return;

    const token = localStorage.getItem('access');
    if (!token) window.location.href = '/login/';
    
    function authH() { return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }; }
    
    async function initDashboard() {
        try {
            const [meRes, statsRes] = await Promise.all([
                fetch('/api/accounts/me/', { headers: authH() }),
                fetch('/api/accounts/stats/', { headers: authH() })
            ]);
            if (!meRes.ok) throw new Error('Auth failed');
            const user = await meRes.json();
            const data = await statsRes.json();
            renderDashboard(user, data);
        } catch (e) {
            console.error(e);
            localStorage.clear();
            window.location.href = '/login/';
        }
    }
    
    function renderDashboard(user, data) {
        document.getElementById('loadingPlaceholder').style.display = 'none';
        dashboardContent.style.display = 'block';
    
        // Greeting
        const h = new Date().getHours();
        const greet = h < 12 ? 'Chào buổi sáng' : h < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
        const fullName = [user.last_name, user.first_name].filter(Boolean).join(' ') || user.username;
        document.getElementById('greetingText').textContent = `${greet}, ${fullName}!`;
        document.getElementById('currentDateText').textContent = new Date().toLocaleDateString('vi-VN', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    
        const roleLabels = { admin: 'Quản trị viên', teacher: 'Giáo viên', student: 'Học sinh' };
        document.getElementById('userRoleBadge').textContent = roleLabels[data.role] || data.role;
    
        const banner = document.getElementById('welcomeBanner');
        if (data.role === 'admin') banner.classList.add('bg-admin');
        else if (data.role === 'teacher') banner.classList.add('bg-teacher');
        else banner.classList.add('bg-student');
    
        renderKPIs(data.role, data.stats);
        renderActions(data.role);
        renderActivities(data.recent_activities);
    }
    
    function renderKPIs(role, stats) {
        const grid = document.getElementById('kpiGrid');
        grid.innerHTML = '';
    
        let configs = [];
        if (role === 'admin') {
            configs = [
                { label: 'Người dùng',  val: stats.total_users,    icon: 'bi-people',             color: 'primary' },
                { label: 'Giáo viên',   val: stats.total_teachers,  icon: 'bi-person-workspace',   color: 'info' },
                { label: 'Học sinh',    val: stats.total_students,  icon: 'bi-mortarboard',         color: 'success' },
                { label: 'Lớp học',     val: stats.total_classes,   icon: 'bi-door-open',           color: 'warning' },
            ];
        } else if (role === 'teacher') {
            configs = [
                { label: 'Lớp đang dạy',  val: stats.total_classes,  icon: 'bi-cast',          color: 'primary' },
                { label: 'Tổng học sinh', val: stats.total_students, icon: 'bi-mortarboard',    color: 'success' },
            ];
        } else {
            configs = [
                { label: 'Lớp tham gia', val: stats.joined_classes,     icon: 'bi-collection',  color: 'primary' },
                { label: 'Bài đã làm',   val: stats.completed_quizzes,  icon: 'bi-check2-all',  color: 'success' },
                { label: 'Điểm TB',      val: stats.avg_score,           icon: 'bi-star',        color: 'warning' },
            ];
        }
    
        const colClass = role === 'admin' ? 'col-12 col-sm-6 col-lg-3' : 'col-12 col-sm-6';
        configs.forEach((c, i) => {
            const col = document.createElement('div');
            col.className = colClass;
            col.innerHTML = `
                <div class="kpi-card ${c.color} animate-in" style="animation-delay:${i * 0.06}s">
                    <div class="kpi-icon ${c.color}"><i class="bi ${c.icon}"></i></div>
                    <div class="kpi-num">${c.val ?? '–'}</div>
                    <div class="kpi-label">${c.label}</div>
                </div>`;
            grid.appendChild(col);
        });
    }
    
    function renderActions(role) {
        const container = document.getElementById('quickActions');
        let items = [];
        if (role === 'admin') {
            items = [
                { label: 'Quản lý Người dùng', desc: 'Xem & phân quyền tài khoản',       icon: 'bi-people-fill',                href: '/admin-panel/', color: 'danger' },
                { label: 'Danh sách Lớp',       desc: 'Xem tất cả lớp trong hệ thống',   icon: 'bi-grid-fill',                  href: '/classes/',     color: 'primary' },
                { label: 'Báo cáo & Xuất Excel',desc: 'Xuất bảng điểm theo bộ lọc',      icon: 'bi-file-earmark-spreadsheet-fill', href: 'javascript:exportReport()', color: 'success' },
            ];
        } else if (role === 'teacher') {
            items = [
                { label: 'Lớp học của tôi',   desc: 'Quản lý và theo dõi lớp',      icon: 'bi-door-open-fill',   href: '/classes/',                color: 'primary' },
                { label: 'Báo cáo & Xuất Excel',desc: 'Xuất bảng điểm theo bộ lọc', icon: 'bi-file-earmark-spreadsheet-fill', href: 'javascript:exportReport()', color: 'success' },
                { label: 'Ngân hàng câu hỏi', desc: 'Quản lý kho đề thi',           icon: 'bi-bank2',            href: '/exams/question-bank/',    color: 'warning' },
            ];
        } else {
            items = [
                { label: 'Lớp của tôi',     desc: 'Xem bài thi & kết quả',    icon: 'bi-book-half',          href: '/classes/', color: 'primary' },
                { label: 'Tham gia lớp mới',desc: 'Nhập mã lớp để vào thi',   icon: 'bi-plus-circle-fill',   href: '/classes/', color: 'success' },
            ];
        }
    
        container.innerHTML = items.map((it, i) => `
            <div class="col-md-4">
                <a href="${it.href}" class="action-card animate-in" style="animation-delay:${0.25 + i*0.07}s;" onclick="${it.href.startsWith('javascript') ? 'event.preventDefault();' + it.href.replace('javascript:','') : ''}">
                    <div class="action-icon" style="background:var(--color-${it.color}-light,var(--color-primary-light));color:var(--color-${it.color},var(--color-primary));">
                        <i class="bi ${it.icon}"></i>
                    </div>
                    <div>
                        <div class="action-title">${it.label}</div>
                        <div class="action-desc">${it.desc}</div>
                    </div>
                </a>
            </div>`).join('');
    }
    
    function renderActivities(activities) {
        const feed = document.getElementById('activityFeed');
        if (!activities || !activities.length) {
            feed.innerHTML = '<div class="empty-state" style="padding:2rem;"><div class="empty-icon" style="font-size:2rem;">📭</div><div class="empty-title" style="font-size:0.875rem;">Chưa có hoạt động nào</div></div>';
            return;
        }
    
        const iconMap = { new_user: {icon:'bi-person-plus-fill', bg:'var(--color-info-light)', c:'var(--color-info)'}, quiz_submission:{icon:'bi-check-circle-fill', bg:'var(--color-success-light)', c:'var(--color-success)'}, quiz_result:{icon:'bi-award-fill', bg:'var(--color-warning-light)', c:'var(--color-warning)'} };
        feed.innerHTML = activities.map(act => {
            const im = iconMap[act.type] || {icon:'bi-circle-fill', bg:'var(--color-primary-light)', c:'var(--color-primary)'};
            const t = new Date(act.time);
            const timeStr = t.toLocaleTimeString('vi-VN', {hour:'2-digit',minute:'2-digit'}) + ' · ' + t.toLocaleDateString('vi-VN');
            return `<div class="activity-item">
                <div class="activity-avatar" style="background:${im.bg};color:${im.c};"><i class="bi ${im.icon}"></i></div>
                <div class="activity-content">
                    <div class="activity-title">${act.title}</div>
                    <div class="activity-sub">${act.detail}</div>
                    <div class="activity-time">${timeStr}</div>
                </div>
            </div>`;
        }).join('');
    }

    initDashboard();
});
