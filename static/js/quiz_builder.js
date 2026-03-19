let quizData = null;
let selectedQuestions = []; 
let questionBank = [];
let topicsList = [];
let editingQuestionId = null; 
let qbEasyMDE = null;

function safeEscapeHtmlForMarkdown(text) {
    if (!text) return '';
    const parts = (text + '').split(/(`+[\s\S]*?`+)/g);
    for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 0) {
            parts[i] = parts[i].replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
    }
    return parts.join('');
}

function authHeaders() {
    return { 
        'Content-Type': 'application/json', 
        'Authorization': 'Bearer ' + localStorage.getItem('access') 
    };
}

// ─── Helpers: Question type display ─────────────────────────────────────────

const Q_TYPE_CONFIG = {
    multiple_choice: { label: 'Trắc nghiệm', badge: 'bg-primary', icon: 'bi-ui-radios-grid' },
    true_false: { label: 'Đúng/Sai', badge: 'bg-info text-dark', icon: 'bi-toggle-on' },
    short_answer: { label: 'Trả lời ngắn', badge: 'bg-warning text-dark', icon: 'bi-pencil-square' },
};

const DIFF_CONFIG = {
    easy: { label: 'Dễ', badge: 'bg-success' },
    medium: { label: 'Vừa', badge: 'bg-warning text-dark' },
    hard: { label: 'Khó', badge: 'bg-danger' },
};

function typeBadge(type) {
    const c = Q_TYPE_CONFIG[type] || Q_TYPE_CONFIG.multiple_choice;
    return `<span class="badge ${c.badge} rounded-pill px-2" style="font-size:0.65rem"><i class="bi ${c.icon} me-1"></i>${c.label}</span>`;
}

function diffBadge(diff) {
    const c = DIFF_CONFIG[diff] || DIFF_CONFIG.medium;
    return `<span class="badge ${c.badge} rounded-pill px-2" style="font-size:0.65rem">${c.label}</span>`;
}

function escapeHtml(unsafe) {
    return (unsafe || '').toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function extractTextFromBlocks(blocks) {
    if (!Array.isArray(blocks)) return '';
    return blocks
        .filter((b) => b && b.type === 'text' && typeof b.value === 'string')
        .map((b) => b.value)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildQuestionImageMap(questionImages) {
    const map = {};
    if (!Array.isArray(questionImages)) return map;
    questionImages.forEach((qi) => {
        const sha = qi?.image?.sha256;
        const url = qi?.image?.image_url;
        if (sha && url) map[sha] = url;
    });
    return map;
}

function renderContentBlocks(blocks, imageMap = {}) {
    if (!Array.isArray(blocks) || blocks.length === 0) return '';

    return blocks.map((b) => {
        if (!b || !b.type) return '';
        if (b.type === 'text') {
            return `<span>${escapeHtml(b.value || '')}</span>`;
        }
        if (b.type === 'image') {
            const url = b.url || (b.sha256 ? imageMap[b.sha256] : null);
            if (url) {
                return `<img src="${url}" class="img-fluid rounded border my-2 d-block" style="max-height: 180px;" alt="image-block">`;
            }
            if (b.sha256) {
                return `<span class="badge bg-light text-dark border my-1">image:${escapeHtml(String(b.sha256).slice(0, 12))}...</span>`;
            }
        }
        return '';
    }).join(' ');
}

function renderQuestionStem(q, extraClass = '') {
    const imageMap = buildQuestionImageMap(q?.question_images || []);
    const blocksHtml = Array.isArray(q?.content_json) ? renderContentBlocks(q.content_json, imageMap) : '';
    const textFallback = getQuestionDisplayText(q);
    const imgHtml = q?.image
        ? `<div class="mb-2"><img src="${q.image}" class="img-fluid rounded border" style="max-height: 200px;" alt="Hình ảnh câu hỏi"></div>`
        : '';
    const stemHtml = blocksHtml && blocksHtml.trim()
        ? `<div class="${extraClass}">${blocksHtml}</div>`
        : `<div class="${extraClass} q-markdown-text">${marked.parse(safeEscapeHtmlForMarkdown(textFallback || ''))}</div>`;
    return `${imgHtml}${stemHtml}`;
}

function getQuestionDisplayText(q) {
    if (q?.text && String(q.text).trim()) return q.text;
    return extractTextFromBlocks(q?.content_json || []);
}

function getOptionDisplayText(o) {
    if (o?.text && String(o.text).trim()) return o.text;
    return extractTextFromBlocks(o?.content_json || []);
}

function hasConfiguredAnswer(q) {
    const type = q?.question_type || 'multiple_choice';
    if (type === 'short_answer') return !!(q?.correct_answer_text && String(q.correct_answer_text).trim());
    const options = Array.isArray(q?.options) ? q.options : [];
    return options.length > 0 && options.some((o) => !!o.is_correct);
}

// ─── Render functions for question content ─────────────────────────────────

function renderQuestionContent(q) {
    const type = q.question_type || 'multiple_choice';
    let html = '';
    const imageMap = buildQuestionImageMap(q.question_images || []);

    if (type === 'multiple_choice') {
        html = (q.options || []).map((o, i) => {
            const l = String.fromCharCode(65 + i);
            const cls = o.is_correct ? 'fw-bold text-success' : '';
            const val = getOptionDisplayText(o);
            const blocks = Array.isArray(o.content_json) ? renderContentBlocks(o.content_json, imageMap) : '';
            return blocks && blocks.trim()
                ? `<div class="${cls}">${l}. <span class="small">${blocks}</span></div>`
                : `<div class="${cls}">${l}. <span class="q-markdown-text markdown-inline">${marked.parseInline(safeEscapeHtmlForMarkdown(val || ''))}</span></div>`;
        }).join('');

    } else if (type === 'true_false') {
        if (q.context) {
            html += `<div class="bg-light border rounded p-2 mb-2 small fst-italic q-markdown-text markdown-inline">${marked.parseInline(safeEscapeHtmlForMarkdown(q.context || ''))}</div>`;
        }
        html += (q.options || []).map((o, i) => {
            const l = String.fromCharCode(97 + i); // a, b, c, d
            const icon = o.is_correct 
                ? '<i class="bi bi-check-circle-fill text-success me-1"></i><span class="text-success fw-bold">Đúng</span>' 
                : '<i class="bi bi-x-circle-fill text-danger me-1"></i><span class="text-danger fw-bold">Sai</span>';
            const val = getOptionDisplayText(o);
            const blocks = Array.isArray(o.content_json) ? renderContentBlocks(o.content_json, imageMap) : '';
            return blocks && blocks.trim()
                ? `<div class="mb-1">${l}) <span class="small">${blocks}</span> → ${icon}</div>`
                : `<div class="mb-1">${l}) <span class="q-markdown-text markdown-inline">${marked.parseInline(safeEscapeHtmlForMarkdown(val || ''))}</span> → ${icon}</div>`;
        }).join('');

    } else if (type === 'short_answer') {
        const ans = q.correct_answer_text || '(chưa có)';
        html = `<div><i class="bi bi-pencil me-1 text-muted"></i>Đáp án: <strong class="text-primary">${escapeHtml(ans)}</strong></div>`;
    }

    return html;
}

// ─── Init ────────────────────────────────────────────────────────────────────

async function init() {
    const token = localStorage.getItem('access');
    if (!token) { window.location.href = '/login/'; return; }

    try {
        const meRes = await fetch('/api/accounts/me/', { headers: authHeaders() });
        if (meRes.status === 401) { window.location.href = '/login/'; return; }
        
        const me = await meRes.json();
        if (me.role?.name !== 'teacher' && me.role?.name !== 'admin') {
            alert('Bạn không có quyền truy cập trang này.');
            window.location.href = '/dashboard/';
            return;
        }

        await loadQuizData();
        await loadTopics();
        await loadSelectedQuestions();
        await loadQuestionBank();
        
        document.getElementById('loadingQuiz').style.display = 'none';
        document.getElementById('quizContent').style.display = 'block';
    } catch (e) {
        console.error(e);
        alert('Lỗi khởi tạo màn hình. Vui lòng đăng nhập lại.');
    }
}

async function loadQuizData() {
    const res = await fetch(`/api/exams/${quizId}/`, { headers: authHeaders() });
    if (!res.ok) { showGlobalAlert('Không tìm thấy đề thi.', 'danger'); return; }
    quizData = await res.json();
    
    document.getElementById('quizTitle').textContent = quizData.title;
    document.getElementById('breadcrumbQuizTitle').textContent = quizData.title;
    document.getElementById('breadcrumbClassLink').textContent = quizData.classroom_name;
    document.getElementById('breadcrumbClassLink').href = `/classes/${quizData.classroom}/`;
    
    document.getElementById('quizDesc').textContent = quizData.description || 'Không có mô tả.';
    document.getElementById('quizDuration').textContent = quizData.duration_minutes;
    document.getElementById('quizQuestionCount').textContent = quizData.question_count;
    
    const schedInfo = [];
    if (quizData.publish_at) schedInfo.push(`Hẹn ngày: ${new Date(quizData.publish_at).toLocaleString('vi-VN')}`);
    if (quizData.due_date) schedInfo.push(`Hạn nộp: ${new Date(quizData.due_date).toLocaleString('vi-VN')}`);
    document.getElementById('quizScheduleInfo').textContent = schedInfo.join(' | ');
    
    const statusEl = document.getElementById('quizStatus');
    if (quizData.is_published) {
        statusEl.textContent = 'Công khai';
        statusEl.className = 'badge bg-success';
        document.getElementById('publishBtn').style.display = 'none';
        document.getElementById('unpublishBtn').style.display = 'inline-block';
    } else {
        statusEl.textContent = 'Nháp';
        statusEl.className = 'badge bg-secondary';
        document.getElementById('publishBtn').style.display = 'inline-block';
        document.getElementById('unpublishBtn').style.display = 'none';
    }
}

async function loadSelectedQuestions() {
    const res = await fetch(`/api/exams/${quizId}/questions/`, { headers: authHeaders() });
    selectedQuestions = await res.json();
    renderSelectedQuestions();
}

function renderSelectedQuestions() {
    const list = document.getElementById('selectedQuestionsList');
    const msg = document.getElementById('noQuestionsMsg');
    list.innerHTML = '';
    
    if (selectedQuestions.length === 0) {
        msg.style.display = 'block';
        document.getElementById('quizQuestionCount').textContent = 0;
        document.getElementById('totalPoints').textContent = 0;
        return;
    }
    
    msg.style.display = 'none';
    document.getElementById('quizQuestionCount').textContent = selectedQuestions.length;
    
    let tPoints = 0;
    selectedQuestions.sort((a,b) => a.order - b.order).forEach((qq, idx) => {
        tPoints += parseFloat(qq.points);
        const q = qq.question;
        const item = document.createElement('li');
        item.className = 'list-group-item p-3 border-0 border-bottom';
        
        item.innerHTML = `
            <div class="d-flex justify-content-between align-items-start mb-2">
                <div class="d-flex align-items-center gap-1 flex-wrap">
                    <span class="badge bg-primary rounded-pill">Câu ${idx + 1}</span>
                    ${typeBadge(q.question_type)}
                    ${diffBadge(q.difficulty)}
                    <strong class="ms-1">${qq.points} điểm</strong>
                </div>
                <div class="d-flex align-items-center gap-1">
                    <button class="btn btn-sm btn-light text-primary px-2" onclick="editQuestion(${q.id})" title="Sửa nội dung"><i class="bi bi-pencil"></i></button>
                    <button class="btn btn-sm btn-light text-danger px-2" onclick="promptRemoveQQ(${qq.id})" title="Rút câu hỏi này"><i class="bi bi-x-lg"></i></button>
                </div>
            </div>
            <div class="mb-2 ms-4" style="line-height:1.5;">${renderQuestionStem(q)}</div>
            <div class="ms-4 small text-muted">${renderQuestionContent(q)}</div>
        `;
        list.appendChild(item);
    });
    document.getElementById('totalPoints').textContent = tPoints;
}

async function loadQuestionBank() {
    const res = await fetch('/api/exams/questions/', { headers: authHeaders() });
    questionBank = await res.json();
    renderQuestionBank(questionBank);
}

async function loadTopics() {
    try {
        const res = await fetch('/api/exams/topics/', { headers: authHeaders() });
        if (res.ok) {
            topicsList = await res.json();
            renderTopics();
        }
    } catch (e) {
        console.error("Lỗi khi tải chủ đề:", e);
    }
}

function renderTopics() {
    const filterSelect = document.getElementById('bankTopicFilter');
    const modalSelect = document.getElementById('newQuestionTopic');
    const listDisplay = document.getElementById('topicListDisplay');
    
    if (filterSelect) {
        const currentFilter = filterSelect.value;
        filterSelect.innerHTML = '<option value="">Tất cả chủ đề</option>';
        topicsList.forEach(t => {
            const opt = new Option(t.name, t.id);
            if (t.id == currentFilter) opt.selected = true;
            filterSelect.add(opt);
        });
    }
    
    if (modalSelect) {
        const currentVal = modalSelect.value;
        modalSelect.innerHTML = '<option value="">-- Không có --</option>';
        topicsList.forEach(t => {
            const opt = new Option(t.name, t.id);
            if (t.id == currentVal) opt.selected = true;
            modalSelect.add(opt);
        });
    }

    const qbTopicSelect = document.getElementById('qbTopic');
    if (qbTopicSelect) {
        const currentVal = qbTopicSelect.value;
        qbTopicSelect.innerHTML = '<option value="" disabled selected>Chọn chủ đề...</option>';
        topicsList.forEach(t => {
            const opt = new Option(t.name, t.id);
            if (t.id == currentVal) opt.selected = true;
            qbTopicSelect.add(opt);
        });
    }
    
    if (listDisplay) {
        listDisplay.innerHTML = topicsList.map(t => `
            <li class="list-group-item d-flex justify-content-between align-items-center">
                <span>${escapeHtml(t.name)}</span>
                <button class="btn btn-sm btn-outline-danger border-0" onclick="deleteTopic(${t.id})">
                    <i class="bi bi-trash"></i>
                </button>
            </li>
        `).join('');
    }
}

function openTopicModal() {
    new bootstrap.Modal(document.getElementById('manageTopicModal')).show();
}

async function addTopic(event) {
    if (event) event.preventDefault();
    const input = document.getElementById('newTopicName');
    const name = input.value.trim();
    if (!name) return;
    
    try {
        const res = await fetch('/api/exams/topics/', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ name: name })
        });
        if (res.ok) {
            input.value = '';
            showGlobalAlert('Thêm chủ đề mới thành công.', 'success');
            await loadTopics();
        } else {
            showGlobalAlert('Lỗi không thể thêm chủ đề.', 'danger');
        }
    } catch (e) {
        showGlobalAlert('Lỗi kết nối.', 'danger');
    }
}

async function deleteTopic(id) {
    if (!confirm('Bạn có chắc muốn xoá chủ đề này?')) return;
    try {
        const res = await fetch(`/api/exams/topics/${id}/`, {
            method: 'DELETE',
            headers: authHeaders()
        });
        if (res.ok) {
            showGlobalAlert('Đã xoá chủ đề.', 'warning');
            await loadTopics();
        } else {
            showGlobalAlert('Lỗi không thể xoá chủ đề.', 'danger');
        }
    } catch (e) {
        showGlobalAlert('Lỗi kết nối.', 'danger');
    }
}

function renderQuestionBank(questions) {
    const list = document.getElementById('questionBankList');
    list.innerHTML = '';
    let addedQIDs = new Set(selectedQuestions.map(qq => qq.question.id));
    
    questions.forEach(q => {
        const item = document.createElement('li');
        item.className = 'list-group-item small p-3';
        const isAdded = addedQIDs.has(q.id);
        const btnGroup = `
            <div class="d-flex gap-1">
                <button class="btn btn-sm btn-outline-secondary" onclick="editQuestion(${q.id})" title="Sửa"><i class="bi bi-pencil"></i></button>
                ${isAdded 
                    ? `<span class="badge bg-light text-muted border d-flex align-items-center px-2">Đã thêm</span>`
                    : `<button class="btn btn-sm btn-outline-primary" onclick="addQuestionToQuiz(${q.id})">Thêm</button>`
                }
            </div>
        `;
        
        item.innerHTML = `
            <div class="mb-1">
                ${typeBadge(q.question_type)} 
                <span class="ms-1">${escapeHtml(getQuestionDisplayText(q))}</span>
            </div>
            <div class="d-flex justify-content-between align-items-center">
                <span class="text-muted" style="font-size:0.7rem">${q.subject_name}</span>
                ${btnGroup}
            </div>
        `;
        list.appendChild(item);
    });
}

function filterBank() {
    const term = document.getElementById('bankSearch').value.toLowerCase();
    const topicId = document.getElementById('bankTopicFilter')?.value || '';
    const filtered = questionBank.filter(q => 
        (getQuestionDisplayText(q).toLowerCase().includes(term) || (q.subject_name || '').toLowerCase().includes(term))
        && (!topicId || String(q.topic) === String(topicId))
    );
    renderQuestionBank(filtered);
}

async function addQuestionToQuiz(qId) {
    let maxOrder = 0;
    if (selectedQuestions.length > 0) {
        maxOrder = Math.max(...selectedQuestions.map(qq => qq.order));
    }
    
    const res = await fetch(`/api/exams/${quizId}/questions/`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ question_id: qId, order: maxOrder + 1, points: 5.0 })
    });
    
    if (res.status === 401) { window.location.href = '/login/'; return; }

    if (res.ok) {
        showGlobalAlert('Thêm câu hỏi vào đề thành công.', 'success');
        await loadSelectedQuestions();
        renderQuestionBank(questionBank); 
    } else {
        showGlobalAlert('Lỗi không thể thêm câu hỏi.', 'danger');
    }
}

let deleteQQId = null;
function promptRemoveQQ(qqId) {
    deleteQQId = qqId;
    new bootstrap.Modal(document.getElementById('deleteConfirmModal')).show();
}

document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
    if (!deleteQQId) return;
    const res = await fetch(`/api/exams/${quizId}/questions/${deleteQQId}/`, {
        method: 'DELETE',
        headers: authHeaders()
    });
    if (res.ok) {
        bootstrap.Modal.getInstance(document.getElementById('deleteConfirmModal')).hide();
        showGlobalAlert('Đã rút câu hỏi khỏi đề.', 'success');
        await loadSelectedQuestions();
        renderQuestionBank(questionBank);
    }
});

async function togglePublish() {
    const isPub = quizData.is_published;
    const res = await fetch(`/api/exams/${quizId}/`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ is_published: !isPub })
    });
    
    if (res.ok) {
        showGlobalAlert(`Đã ${!isPub ? 'công khai' : 'ẩn'} đề thi.`, 'success');
        await loadQuizData();
    }
}

function editQuizSettings() {
    document.getElementById('editQuizTitle').value = quizData.title;
    document.getElementById('editQuizDesc').value = quizData.description || '';
    document.getElementById('editQuizDuration').value = quizData.duration_minutes;
    document.getElementById('editQuizPublishAt').value = quizData.publish_at ? quizData.publish_at.slice(0, 16) : '';
    document.getElementById('editQuizDueDate').value = quizData.due_date ? quizData.due_date.slice(0, 16) : '';
    new bootstrap.Modal(document.getElementById('editQuizModal')).show();
}

async function submitEditQuiz() {
    const payload = {
        title: document.getElementById('editQuizTitle').value,
        description: document.getElementById('editQuizDesc').value,
        duration_minutes: document.getElementById('editQuizDuration').value,
        publish_at: document.getElementById('editQuizPublishAt').value || null,
        due_date: document.getElementById('editQuizDueDate').value || null
    };
    
    const res = await fetch(`/api/exams/${quizId}/`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(payload)
    });
    
    if (res.ok) {
        bootstrap.Modal.getInstance(document.getElementById('editQuizModal')).hide();
        showGlobalAlert('Cập nhật Đề thi thành công.', 'success');
        await loadQuizData();
    }
}

// ─── Create Question Form Toggle ────────────────────────────────────────────

function toggleQbOptions() {
    const type = document.getElementById('qbType').value;
    const container = document.getElementById('optionsSection');
    const ctxWrap = document.getElementById('qbContextWrapper');

    if (ctxWrap) ctxWrap.style.display = (type === 'true_false') ? 'block' : 'none';

    let html = '';
    if (type === 'multiple_choice') {
        html = `
            <p class="text-muted small mb-2">Nhập 4 phương án và chọn 1 phương án đúng:</p>
            ${[0, 1, 2, 3].map(i => `
                <div class="d-flex mb-2 align-items-center gap-2">
                    <div class="form-check m-0">
                        <input class="form-check-input" type="radio" name="qbOptCorrect" value="${i}" ${i === 0 ? 'checked' : ''}>
                    </div>
                    <span class="fw-bold">${String.fromCharCode(65 + i)}.</span>
                    <input type="text" class="form-control form-control-sm qbOptText" placeholder="Nội dung phương án ${String.fromCharCode(65 + i)}..." required>
                </div>
            `).join('')}
        `;
    } else if (type === 'true_false') {
        html = `
            <p class="text-muted small mb-2">Nhập 4 phát biểu và xét tính Đúng/Sai:</p>
            ${[0, 1, 2, 3].map(i => `
                <div class="d-flex mb-2 align-items-center gap-2">
                    <span class="fw-bold">${String.fromCharCode(97 + i)}.</span>
                    <input type="text" class="form-control form-control-sm qbOptText" placeholder="Phát biểu ${String.fromCharCode(97 + i)}..." required>
                    <div class="btn-group btn-group-sm ms-2" role="group">
                        <input type="radio" class="btn-check qbTfOpt_${i}" name="qbTfOpt_${i}" id="qbTfOpt_${i}_t" value="true">
                        <label class="btn btn-outline-success" for="qbTfOpt_${i}_t">Đ</label>
                        <input type="radio" class="btn-check qbTfOpt_${i}" name="qbTfOpt_${i}" id="qbTfOpt_${i}_f" value="false" checked>
                        <label class="btn btn-outline-danger" for="qbTfOpt_${i}_f">S</label>
                    </div>
                </div>
            `).join('')}
        `;
    } else if (type === 'short_answer') {
        html = `
            <p class="text-muted small mb-2">Nhập chính xác đáp án (hệ thống tự loại bỏ khoảng trắng khi chấm):</p>
            <input type="text" id="qbSaCorrect" class="form-control form-control-lg text-primary fw-bold" placeholder="Vd: 5.5, HCl..." required>
        `;
    }
    container.innerHTML = html;
}

async function submitCreateQuestion() {
    const errEl = document.getElementById('createQError');
    errEl.textContent = '';
    
    const text = qbEasyMDE ? qbEasyMDE.value().trim() : '';
    const difficulty = document.getElementById('newQuestionDiff').value;
    const qType = document.getElementById('qbType').value;
    const topicId = document.getElementById('qbTopic').value || null;
    const context = (document.getElementById('qbContext')?.value || '').trim();

    if (!text) { errEl.textContent = "Bạn chưa nhập nội dung câu hỏi."; return; }
    
    const isEditMode = (typeof editingQuestionId !== 'undefined' && editingQuestionId !== null);
    const addToQuizNow = !!document.getElementById('addManualToQuiz')?.checked;
    
    // Get class/subject info
    const classRes = await fetch(`/api/classes/${quizData.classroom}/`, { headers: authHeaders() });
    const classData = await classRes.json();
    const subjectId = classData.subject;

    let payload = {
        question_type: qType,
        text: text,
        difficulty: difficulty,
        topic_id: topicId,
        context: context
    };

    if (qType === 'short_answer') {
        const correctText = (document.getElementById('qbSaCorrect')?.value || '').trim();
        if (!correctText) { errEl.textContent = "Vui lòng nhập đáp án đúng."; return; }
        payload.correct_answer_text = correctText;
    } else {
        const optTexts = document.querySelectorAll('.qbOptText');
        let options = [];
        let hasEmpty = false;

        if (qType === 'multiple_choice') {
            const correctVal = document.querySelector('input[name="qbOptCorrect"]:checked');
            if (!correctVal) { errEl.textContent = "Vui lòng chọn 1 đáp án đúng."; return; }
            const correctIdx = parseInt(correctVal.value);

            optTexts.forEach((el, i) => {
                const val = el.value.trim();
                if (!val) hasEmpty = true;
                options.push({ text: val, is_correct: (i === correctIdx) });
            });
        } else if (qType === 'true_false') {
            optTexts.forEach((el, i) => {
                const val = el.value.trim();
                if (!val) hasEmpty = true;
                const isCorrect = document.getElementById(`qbTfOpt_${i}_t`).checked;
                options.push({ text: val, is_correct: isCorrect });
            });
        }

        if (hasEmpty) { errEl.textContent = "Vui lòng nhập đầy đủ nội dung các phương án."; return; }
        payload.options = options;
    }

    let res;
    if (isEditMode) {
        res = await fetch(`/api/exams/questions/${editingQuestionId}/update-full/`, {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify(payload)
        });
    } else {
        res = await fetch('/api/ai/generate/save-bulk/', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
                questions: [payload],
                quiz_id: addToQuizNow ? quizId : null,
                subject_id: subjectId,
            })
        });
    }

    if (res.ok) {
        const modalEl = document.getElementById('createQuestionModal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
        
        showGlobalAlert(isEditMode ? 'Cập nhật câu hỏi thành công!' : 'Thêm câu hỏi mới thành công!', 'success');
        if (isEditMode) editingQuestionId = null;
        
        await loadQuizData();
        await loadSelectedQuestions();
        await loadQuestionBank();
    } else {
        const data = await res.json();
        errEl.textContent = data.error || "Lỗi lưu câu hỏi.";
    }
}

// ─── Modal Events ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    const modalEl = document.getElementById('createQuestionModal');
    if (modalEl) {
        modalEl.addEventListener('show.bs.modal', () => {
            // Reset form if not in edit mode (will be handled by editQuestion if it is)
            if (!editingQuestionId) {
                document.getElementById('createQuestionForm').reset();
                document.getElementById('qbType').value = 'multiple_choice';
                document.getElementById('qbContext').value = '';
                toggleQbOptions();
            }
            
            // Initialize EasyMDE if not exists
            if (!qbEasyMDE) {
                qbEasyMDE = new EasyMDE({
                    element: document.getElementById('newQuestionText'),
                    spellChecker: false,
                    autosave: { enabled: false },
                    status: false,
                    placeholder: "Nhập nội dung câu hỏi (Markdown hỗ trợ)...",
                    minHeight: "150px"
                });
            }
        });

        modalEl.addEventListener('shown.bs.modal', () => {
            if (qbEasyMDE) qbEasyMDE.codemirror.refresh();
        });

        modalEl.addEventListener('hidden.bs.modal', () => {
            editingQuestionId = null;
            if (qbEasyMDE) qbEasyMDE.value('');
            document.getElementById('createQuestionForm').reset();
        });
    }
});

async function editQuestion(qId) {
    editingQuestionId = qId;
    try {
        const res = await fetch(`/api/exams/questions/${qId}/`, { headers: authHeaders() });
        if (!res.ok) throw new Error("Lỗi tải thông tin câu hỏi.");
        const q = await res.json();

        const modalEl = document.getElementById('createQuestionModal');
        const modal = new bootstrap.Modal(modalEl);
        modal.show();

        // Populate fields
        document.getElementById('qbType').value = q.question_type;
        document.getElementById('qbTopic').value = q.topic || '';
        document.getElementById('newQuestionDiff').value = q.difficulty;
        document.getElementById('qbContext').value = q.context || '';
        
        if (qbEasyMDE) qbEasyMDE.value(q.text || '');
        
        toggleQbOptions();

        // Populate options
        if (q.question_type === 'short_answer') {
            const saInput = document.getElementById('qbSaCorrect');
            if (saInput) saInput.value = q.correct_answer_text || '';
        } else {
            const optTexts = document.querySelectorAll('.qbOptText');
            q.options.forEach((opt, i) => {
                if (optTexts[i]) optTexts[i].value = opt.text;
                if (q.question_type === 'multiple_choice') {
                    if (opt.is_correct) {
                        const radio = document.querySelector(`input[name="qbOptCorrect"][value="${i}"]`);
                        if (radio) radio.checked = true;
                    }
                } else if (q.question_type === 'true_false') {
                    const tRadio = document.getElementById(`qbTfOpt_${i}_t`);
                    const fRadio = document.getElementById(`qbTfOpt_${i}_f`);
                    if (opt.is_correct) {
                        if (tRadio) tRadio.checked = true;
                    } else {
                        if (fRadio) fRadio.checked = true;
                    }
                }
            });
        }
    } catch (e) {
        showGlobalAlert(e.message, 'danger');
    }
}

// ─── AI Draft Board (Shared logic for File + RAG) ───────────────────────────

let currentDrafts = { file: [], rag: [] };

function renderDraftBoard(source) {
    const drafts = currentDrafts[source];
    const board = document.getElementById(source === 'file' ? 'aiDraftBoardFile' : 'aiDraftBoardRag');
    
    if (drafts.length === 0) {
        board.innerHTML = '<div class="text-center text-muted mt-5">Không tìm thấy câu hỏi nào hợp lệ.</div>';
        return;
    }

    let html = '';
    drafts.forEach((q, index) => {
        const qType = q.question_type || 'multiple_choice';
        const unresolved = !hasConfiguredAnswer(q);
        html += `
            <div class="card mb-3 border-primary shadow-sm">
                <div class="card-header bg-white d-flex justify-content-between align-items-start p-3">
                    <div class="form-check">
                        <input class="form-check-input ai-draft-cb-${source} mt-2" type="checkbox" value="${index}" checked id="draft_${source}_${index}">
                        <label class="form-check-label fw-bold d-block mb-1" for="draft_${source}_${index}">Câu ${index + 1}:</label>
                        <div class="ps-4">${renderQuestionStem(q)}</div>
                        ${unresolved ? '<div class="ps-4 mt-1"><span class="badge bg-danger">Chưa cài đặt đáp án đúng</span></div>' : ''}
                    </div>
                    <div class="d-flex gap-1 align-items-center">
                        ${typeBadge(qType)}
                        ${diffBadge(q.difficulty)}
                        <button class="btn btn-sm btn-outline-secondary" onclick="toggleDraftEditor('${source}', ${index})" title="Sửa trực tiếp"><i class="bi bi-pencil-square"></i></button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteDraft('${source}', ${index})" title="Xóa bản nháp"><i class="bi bi-trash"></i></button>
                    </div>
                </div>
                <div class="card-body p-3">
                    ${renderQuestionContent(q)}
                    <div id="draft_editor_${source}_${index}" class="border rounded p-2 mt-2 bg-white" style="display:none;"></div>
                </div>
            </div>
        `;
    });
    board.innerHTML = html;
}

function deleteDraft(source, index) {
    if (!Array.isArray(currentDrafts[source])) return;
    currentDrafts[source].splice(index, 1);
    renderDraftBoard(source);
    const saveBtn = document.getElementById(source === 'file' ? 'btnSaveDraftsFile' : 'btnSaveDraftsRag');
    if (saveBtn) saveBtn.style.display = currentDrafts[source].length ? 'inline-block' : 'none';
}

function toggleDraftEditor(source, index) {
    const wrap = document.getElementById(`draft_editor_${source}_${index}`);
    if (!wrap) return;

    if (wrap.style.display === 'none') {
        wrap.style.display = 'block';
        const q = currentDrafts[source][index] || {};
        const qType = q.question_type || 'multiple_choice';
        const qText = getQuestionDisplayText(q);
        const options = Array.isArray(q.options) ? q.options : [];

        let optionsHtml = '';
        if (qType === 'short_answer') {
            optionsHtml = `
                <div class="mb-2">
                    <label class="form-label small fw-bold">Đáp án đúng</label>
                    <input type="text" class="form-control form-control-sm" id="draft_answer_${source}_${index}" value="${escapeHtml(q.correct_answer_text || '')}">
                </div>
            `;
        } else {
            optionsHtml = options.map((o, i) => `
                <div class="row g-1 mb-2 align-items-center">
                    <div class="col-8">
                        <input type="text" class="form-control form-control-sm" id="draft_opt_${source}_${index}_${i}" value="${escapeHtml(getOptionDisplayText(o))}">
                    </div>
                    <div class="col-4">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="draft_opt_correct_${source}_${index}_${i}" ${o.is_correct ? 'checked' : ''}>
                            <label class="form-check-label small">Đúng</label>
                        </div>
                    </div>
                </div>
            `).join('');
        }

        wrap.innerHTML = `
            <div class="mb-2">
                <label class="form-label small fw-bold">Nội dung câu hỏi</label>
                <textarea class="form-control form-control-sm" rows="3" id="draft_text_${source}_${index}">${escapeHtml(qText)}</textarea>
            </div>
            <div class="mb-2">
                <label class="form-label small fw-bold">Ngữ cảnh</label>
                <textarea class="form-control form-control-sm" rows="2" id="draft_context_${source}_${index}">${escapeHtml(q.context || '')}</textarea>
            </div>
            ${optionsHtml}
            <div class="d-flex justify-content-end gap-2">
                <button class="btn btn-sm btn-outline-secondary" onclick="toggleDraftEditor('${source}', ${index})">Đóng</button>
                <button class="btn btn-sm btn-primary" onclick="saveDraftEditor('${source}', ${index})">Lưu chỉnh sửa nháp</button>
            </div>
        `;
    } else {
        wrap.style.display = 'none';
        wrap.innerHTML = '';
    }
}

function saveDraftEditor(source, index) {
    const q = currentDrafts[source][index];
    if (!q) return;

    const qType = q.question_type || 'multiple_choice';
    const textEl = document.getElementById(`draft_text_${source}_${index}`);
    const ctxEl = document.getElementById(`draft_context_${source}_${index}`);

    q.text = (textEl?.value || '').trim();
    q.context = (ctxEl?.value || '').trim();

    if (qType === 'short_answer') {
        const ansEl = document.getElementById(`draft_answer_${source}_${index}`);
        q.correct_answer_text = (ansEl?.value || '').trim();
    } else {
        const options = Array.isArray(q.options) ? q.options : [];
        options.forEach((o, i) => {
            const textInput = document.getElementById(`draft_opt_${source}_${index}_${i}`);
            const correctInput = document.getElementById(`draft_opt_correct_${source}_${index}_${i}`);
            o.text = (textInput?.value || '').trim();
            o.is_correct = !!correctInput?.checked;
        });

        if (qType === 'multiple_choice' && options.filter((o) => o.is_correct).length > 1) {
            let found = false;
            options.forEach((o) => {
                if (o.is_correct && !found) found = true;
                else if (o.is_correct && found) o.is_correct = false;
            });
        }
    }

    renderDraftBoard(source);
    showGlobalAlert('Đã cập nhật bản nháp.', 'success');
}

function selectAllDrafts(source) {
    const checkboxes = document.querySelectorAll(`.ai-draft-cb-${source}`);
    let allChecked = true;
    checkboxes.forEach(cb => { if (!cb.checked) allChecked = false; });
    checkboxes.forEach(cb => cb.checked = !allChecked);
}

async function saveSelectedDrafts(source) {
    const checkboxes = document.querySelectorAll(`.ai-draft-cb-${source}:checked`);
    if (checkboxes.length === 0) { alert('Vui lòng chọn ít nhất 1 câu hỏi.'); return; }

    const selectedDrafts = [];
    checkboxes.forEach(cb => { selectedDrafts.push(currentDrafts[source][parseInt(cb.value)]); });

    const btnId = source === 'file' ? 'btnSaveDraftsFile' : 'btnSaveDraftsRag';
    const btn = document.getElementById(btnId);
    const shouldAddToQuiz = !!document.getElementById(source === 'file' ? 'saveToQuizFile' : 'saveToQuizRag')?.checked;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Đang lưu...';

    try {
        const classRes = await fetch(`/api/classes/${quizData.classroom}/`, { headers: authHeaders() });
        const classData = await classRes.json();
        
        const res = await fetch('/api/ai/generate/save-bulk/', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
                questions: selectedDrafts,
                quiz_id: shouldAddToQuiz ? quizId : null,
                subject_id: classData.subject,
            })
        });

        if (res.ok) {
            showGlobalAlert(`Đã nhập ${selectedDrafts.length} câu hỏi thành công!`, 'success');
            bootstrap.Modal.getInstance(document.getElementById('aiGeneratorModal')).hide();
            await loadQuizData();
            await loadSelectedQuestions();
            await loadQuestionBank();
            currentDrafts[source] = [];
            document.getElementById(source === 'file' ? 'aiDraftBoardFile' : 'aiDraftBoardRag').innerHTML = '';
        } else {
            const err = await res.json();
            alert("Lỗi lưu: " + (err.error || "Unknown error"));
        }
    } catch (e) {
        alert('Lỗi kết nối.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-cloud-arrow-up me-1"></i>Lưu các câu đã chọn';
    }
}

// ─── Tab 1: File Extraction ─────────────────────────────────────────────────

document.getElementById('aiExtractForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const fileInput = document.getElementById('aiFileInput');
    const file = fileInput.files[0];
    if (!file) return;

    const btn = document.getElementById('btnExtractAI');
    const loader = document.getElementById('aiExtractLoading');
    const errBox = document.getElementById('aiExtractError');
    const saveBtn = document.getElementById('btnSaveDraftsFile');

    errBox.textContent = '';
    btn.disabled = true;
    loader.style.display = 'block';
    saveBtn.style.display = 'none';

    try {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/api/ai/generate/extract-file/', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + localStorage.getItem('access') },
            body: formData
        });

        const data = await res.json();
        if (res.ok) {
            currentDrafts.file = data.questions;
            renderDraftBoard('file');
            if (currentDrafts.file.length > 0) saveBtn.style.display = 'inline-block';
        } else {
            errBox.textContent = data.error || 'Lỗi trích xuất từ server.';
        }
    } catch (err) {
        errBox.textContent = 'Lỗi kết nối tới AI Service.';
    } finally {
        btn.disabled = false;
        loader.style.display = 'none';
        fileInput.value = '';
    }
});

// ─── Tab 2: RAG Generation ──────────────────────────────────────────────────

document.getElementById('ragGenerateForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const topic = document.getElementById('ragTopic').value.trim();
    const count = document.getElementById('ragCount').value;
    const difficulty = document.getElementById('ragDifficulty').value;
    const questionTypes = document.getElementById('ragQuestionTypes').value;

    if (!topic) return;

    const btn = document.getElementById('btnGenerateRAG');
    const loader = document.getElementById('ragLoading');
    const errBox = document.getElementById('ragError');
    const saveBtn = document.getElementById('btnSaveDraftsRag');

    errBox.textContent = '';
    btn.disabled = true;
    loader.style.display = 'block';
    saveBtn.style.display = 'none';

    try {
        const res = await fetch('/api/ai/generate/from-rag/', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
                class_id: quizData.classroom,
                topic: topic,
                count: parseInt(count),
                difficulty: difficulty,
                question_types: questionTypes,
            })
        });

        const data = await res.json();
        if (res.ok) {
            currentDrafts.rag = data.questions;
            renderDraftBoard('rag');
            if (currentDrafts.rag.length > 0) saveBtn.style.display = 'inline-block';
        } else {
            errBox.textContent = data.error || 'Lỗi sinh câu hỏi từ tri thức nội bộ.';
        }
    } catch (err) {
        errBox.textContent = 'Lỗi kết nối tới AI Service.';
    } finally {
        btn.disabled = false;
        loader.style.display = 'none';
    }
});

// ─── Delete Quiz ────────────────────────────────────────────────────────────

function promptDeleteQuiz() {
    new bootstrap.Modal(document.getElementById('deleteQuizConfirmModal')).show();
}

document.getElementById('confirmDeleteQuizBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('confirmDeleteQuizBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Đang xoá...';
    try {
        const res = await fetch(`/api/exams/${quizId}/`, {
            method: 'DELETE',
            headers: authHeaders()
        });
        if (res.ok) {
            bootstrap.Modal.getInstance(document.getElementById('deleteQuizConfirmModal')).hide();
            showGlobalAlert('Đã xoá đề thi thành công.', 'success');
            setTimeout(() => {
                window.location.href = `/classes/${quizData.classroom}/`;
            }, 1000);
        } else {
            showGlobalAlert('Lỗi không thể xoá đề thi.', 'danger');
            btn.disabled = false;
            btn.innerHTML = 'Đồng ý Xoá';
        }
    } catch (e) {
        showGlobalAlert('Lỗi kết nối.', 'danger');
        btn.disabled = false;
        btn.innerHTML = 'Đồng ý Xoá';
    }
});
// ─── Quiz Builder Image Gallery ──────────────────────────────────────────────
async function uploadQuizBuilderImage() {
    const fileInput = document.getElementById('qbImageFile');
    const file = fileInput.files[0];
    const statusEl = document.getElementById('qbImageStatus');

    if (!file) {
        statusEl.innerHTML = '<span class="text-danger">Vui lòng chọn ảnh.</span>';
        return;
    }

    statusEl.innerHTML = '<span class="text-info">Đang tải...</span>';
    const fd = new FormData();
    fd.append('image', file);

    try {
        const res = await fetch('/api/exams/questions/images/upload/', {
            method: 'POST',
            headers: authHeaders(true),
            body: fd
        });
        const data = await res.json();
        if (res.ok) {
            statusEl.innerHTML = '<span class="text-success">Tải ảnh lên kho thành công!</span>';
            fileInput.value = '';
            appendImageToGallery(data.url, data.sha256);
        } else {
            statusEl.innerHTML = `<span class="text-danger">Lỗi: ${data.error || 'Kho ảnh từ chối tải.'}</span>`;
        }
    } catch (e) {
        statusEl.innerHTML = `<span class="text-danger">Lỗi kết nối.</span>`;
    }
}

function appendImageToGallery(url, sha) {
    const listEl = document.getElementById('qbImageList');
    if (listEl.innerHTML.includes('Chưa có ảnh nào')) {
        listEl.innerHTML = '';
    }
    const safeSha = sha ? sha.slice(0, 16) + '...' : 'Không có SHA';
    const item = document.createElement('div');
    item.className = 'd-flex gap-2 border rounded bg-white p-2 mb-2 align-items-center';
    item.innerHTML = `
        <img src="${url}" alt="q-img" class="rounded border" style="width:48px;height:48px;object-fit:cover;">
        <div class="flex-grow-1">
            <div class="small fw-bold">${safeSha}</div>
            <button type="button" class="btn btn-sm btn-light border py-0 px-2 mt-1" style="font-size:0.75rem;" onclick="copyMarkdownImage('${url}')">
                <i class="bi bi-clipboard"></i> Copy mã chèn
            </button>
        </div>
    `;
    listEl.insertBefore(item, listEl.firstChild);
}

function copyMarkdownImage(url) {
    const md = `![Hình ảnh](${url})`;
    navigator.clipboard.writeText(md).then(() => {
        if(typeof showGlobalAlert === 'function') {
            showGlobalAlert('Đã copy mã chèn ảnh. Bạn có thể chèn vào nội dung!', 'info');
        } else {
            alert('Đã copy mã chèn ảnh: ' + md);
        }
    }).catch(err => {
        console.error('Lỗi copy: ', err);
    });
}

init();
