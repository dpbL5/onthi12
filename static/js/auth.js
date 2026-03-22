// Helper to toggle password visibility
function togglePwd(id, eyeId) {
    const inp = document.getElementById(id);
    const eye = document.getElementById(eyeId);
    if (!inp || !eye) return;
    if (inp.type === 'password') { inp.type = 'text'; eye.className = 'bi bi-eye-slash'; }
    else { inp.type = 'password'; eye.className = 'bi bi-eye'; }
}

// Check password strength for registration
function checkStrength(val) {
    const bar = document.getElementById('strengthBar');
    const fill = document.getElementById('strengthFill');
    const text = document.getElementById('strengthText');
    if (!bar || !fill || !text) return;

    bar.style.display = val.length ? 'block' : 'none';
    let score = 0;
    if (val.length >= 8) score++;
    if (/[A-Z]/.test(val)) score++;
    if (/[0-9]/.test(val)) score++;
    if (/[^A-Za-z0-9]/.test(val)) score++;
    const levels = [
        {w: '25%', c: '#EF4444', l: 'Quá yếu'},
        {w: '50%', c: '#F59E0B', l: 'Yếu'},
        {w: '75%', c: '#3B82F6', l: 'Trung bình'},
        {w: '100%', c: '#10B981', l: 'Mạnh'},
    ];
    const lv = levels[score - 1] || levels[0];
    fill.style.width = lv.w;
    fill.style.background = lv.c;
    text.textContent = lv.l;
    text.style.color = lv.c;
}

// Attach login form submission
document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.onsubmit = async function(e) {
            e.preventDefault();
            const errEl = document.getElementById('loginError');
            errEl.classList.add('d-none');
            document.getElementById('loginBtnText').classList.add('d-none');
            document.getElementById('loginBtnSpinner').classList.remove('d-none');
            document.getElementById('loginBtn').disabled = true;
        
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            try {
                const res = await fetch('/api/accounts/login/', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({username, password})
                });
                const data = await res.json();
                if (res.ok && data.access) {
                    localStorage.setItem('access', data.access);
                    localStorage.setItem('refresh', data.refresh);
                    sessionStorage.setItem('globalAlert', JSON.stringify({msg: '✅ Đã đăng nhập thành công!', type: 'success'}));
                    window.location.href = '/dashboard/';
                } else {
                    errEl.textContent = data.detail || 'Tên đăng nhập hoặc mật khẩu không đúng.';
                    errEl.classList.remove('d-none');
                }
            } catch (e) {
                errEl.textContent = 'Lỗi kết nối máy chủ. Vui lòng thử lại.';
                errEl.classList.remove('d-none');
            }
            document.getElementById('loginBtnText').classList.remove('d-none');
            document.getElementById('loginBtnSpinner').classList.add('d-none');
            document.getElementById('loginBtn').disabled = false;
        };
    }

    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.onsubmit = async function(e) {
            e.preventDefault();
            const errEl = document.getElementById('registerError');
            errEl.classList.add('d-none');
            document.getElementById('regBtnText').classList.add('d-none');
            document.getElementById('regBtnSpinner').classList.remove('d-none');
            document.getElementById('regBtn').disabled = true;
        
            const roleEl = document.querySelector('input[name="role"]:checked');
            const payload = {
                email: document.getElementById('reg_email').value,
                username: document.getElementById('reg_username').value,
                password: document.getElementById('reg_password').value,
                first_name: document.getElementById('first_name').value,
                last_name: document.getElementById('last_name').value,
                role_name: roleEl ? roleEl.value : 'student',
            };
            try {
                const res = await fetch('/api/accounts/register/', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    sessionStorage.setItem('globalAlert', JSON.stringify({msg: '🎉 Đăng ký thành công! Hãy đăng nhập để tiếp tục.', type: 'success'}));
                    window.location.href = '/login/';
                } else {
                    const data = await res.json();
                    const msgs = Object.values(data).flat().join(' • ');
                    errEl.textContent = msgs || 'Đăng ký thất bại. Vui lòng kiểm tra lại thông tin.';
                    errEl.classList.remove('d-none');
                }
            } catch (e) {
                errEl.textContent = 'Lỗi kết nối máy chủ.';
                errEl.classList.remove('d-none');
            }
            document.getElementById('regBtnText').classList.remove('d-none');
            document.getElementById('regBtnSpinner').classList.add('d-none');
            document.getElementById('regBtn').disabled = false;
        };
    }
});
