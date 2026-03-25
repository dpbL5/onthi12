let quizData = null;
let selectedQuestions = [];
let questionBank = [];
let qbEasyMDE = null;
let currentDrafts = { file: [], rag: [] };
function normalizeListResponse(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.results)) return data.results;
    return [];
}

function authHeaders(isMultipart = false) {
    const headers = {
        'Authorization': 'Bearer ' + localStorage.getItem('access')
    };
    if (!isMultipart) {
        headers['Content-Type'] = 'application/json';
    }
    return headers;
}

// ─── Helpers: Question type display ─────────────────────────────────────────

const Q_TYPE_CONFIG = {
    multiple_choice: { label: 'Trắc nghiệm', badge: 'bg-primary', icon: 'bi-ui-radios-grid' },
    true_false: { label: 'Đúng/Sai', badge: 'bg-info text-dark', icon: 'bi-toggle-on' },
    short_answer: { label: 'Trả lời ngắn', badge: 'bg-warning text-dark', icon: 'bi-pencil-square' },
};

const DIFF_CONFIG = {
    easy: { label: 'Nhận biết', badge: 'bg-success' },
    medium: { label: 'Thông hiểu', badge: 'bg-warning text-dark' },
    hard: { label: 'Vận dụng', badge: 'bg-danger' },
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

function getQuestionDisplayText(q) {
    if (q?.text && String(q.text).trim()) return q.text;
    return QuestionRenderer.extractTextFromBlocks(q?.content_json || []);
}

function getOptionDisplayText(o) {
    if (o?.text && String(o.text).trim()) return o.text;
    return QuestionRenderer.extractTextFromBlocks(o?.content_json || []);
}
async function loadRagDocuments(classId) {
    const wrap = document.getElementById('ragDocumentWrap');
    const sel = document.getElementById('ragDocument');
    const status = document.getElementById('ragDocumentStatus');
    if (!wrap || !sel || !classId) return;

    // Reset
    sel.innerHTML = '<option value="">Toàn bộ tài liệu trong lớp</option>';
    status.textContent = 'Đang tải danh sách tài liệu...';
    wrap.style.display = 'block';

    try {
        const res = await fetch(`/api/ai/classes/${classId}/documents/`, { headers: authHeaders() });
        if (!res.ok) { status.textContent = 'Không thể tải tài liệu.'; return; }
        const docs = await res.json();
        if (Array.isArray(docs) && docs.length > 0) {
            docs.forEach(d => sel.add(new Option(d.title || d.file_path, d.id)));
            status.textContent = `Đã tải ${docs.length} tài liệu.`;
        } else {
            status.textContent = 'Lớp học này chưa có tài liệu nào.';
        }
    } catch (e) {
        status.textContent = 'Lỗi kết nối.';
    }
}

function renderQuestionStem(q, extraClass = '') {
    return QuestionRenderer.renderStem(q, { containerClass: extraClass });
}

function getQuestionDisplayText(q) {
    if (q?.text && String(q.text).trim()) return q.text;
    return QuestionRenderer.extractTextFromBlocks(q?.content_json || []);
}

function getOptionDisplayText(o) {
    if (o?.text && String(o.text).trim()) return o.text;
    return QuestionRenderer.extractTextFromBlocks(o?.content_json || []);
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

    if (type === 'multiple_choice') {
        html = (q.options || []).map((o, i) => {
            const l = String.fromCharCode(65 + i);
            const cls = o.is_correct ? 'fw-bold text-success' : '';
            const contentHtml = QuestionRenderer.renderOption(o, q.question_images);
            return `<div class="${cls}">${l}. ${contentHtml}</div>`;
        }).join('');

    } else if (type === 'true_false') {
        if (q.context) {
            // Use QuestionRenderer's markdown helper if we want consistency, 
            // but since it's private (_renderMarkdownInline), we'll do a simple marked call here 
            // or just use QuestionRenderer.renderStem for the context if it was treated as a stem.
            // For now, let's just use window.marked directly as it's available.
            const safeContext = q.context.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            html += `<div class="bg-light border rounded p-2 mb-2 small fst-italic q-markdown-text markdown-inline">${marked.parseInline(safeContext)}</div>`;
        }
        html += (q.options || []).map((o, i) => {
            const l = String.fromCharCode(97 + i); // a, b, c, d
            const icon = o.is_correct
                ? '<i class="bi bi-check-circle-fill text-success me-1"></i><span class="text-success fw-bold">Đúng</span>'
                : '<i class="bi bi-x-circle-fill text-danger me-1"></i><span class="text-danger fw-bold">Sai</span>';
            const contentHtml = QuestionRenderer.renderOption(o, q.question_images);
            return `<div class="mb-1">${l}) ${contentHtml} → ${icon}</div>`;
        }).join('');

    } else if (type === 'short_answer') {
        const ans = q.correct_answer_text || '(chưa có)';
        html = `<div><i class="bi bi-pencil me-1 text-muted"></i>Đáp án: <strong class="text-primary">${escapeHtml(ans)}</strong></div>`;
    }

    return html;
}

// ─── Init ────────────────────────────────────────────────────────────────────

async function init() {
    const me = await window.getCurrentUser();
    if (!me) { window.location.href = '/login/'; return; }

    try {
        if (me.role?.name !== 'teacher' && me.role?.name !== 'admin') {
            alert('Bạn không có quyền truy cập trang này.');
            window.location.href = '/dashboard/';
            return;
        }

        await loadQuizData();
        await loadSelectedQuestions();
        await loadQuestionBank();

        // Hide subject selection in AI Modal for Quiz Builder
        const aiExtractSubWrap = document.getElementById('aiExtractSubjectWrap');
        if (aiExtractSubWrap) aiExtractSubWrap.style.display = 'none';

        // FIX Bug 1: Remove 'required' from hidden select and populate with quizData.subject_id
        // Nếu không làm điều này, HTML5 validation sẽ block form submit vì select required đang trống
        const aiExtractSub = document.getElementById('aiExtractSubject');
        if (aiExtractSub) {
            aiExtractSub.removeAttribute('required');
            if (quizData?.subject_id) {
                aiExtractSub.innerHTML = `<option value="${quizData.subject_id}" selected>${quizData.subject_name || ''}</option>`;
            }
        }

        // RAG: Tải danh mục tài liệu của lớp học này
        if (quizData && quizData.classroom) {
            const ragClassSelect = document.getElementById('ragClass');
            if (ragClassSelect) {
                // Trong Quiz Builder, mặc định chọn sẵn lớp của Quiz và ẩn selector lớp (hoặc disabled)
                ragClassSelect.innerHTML = `<option value="${quizData.classroom}" selected>${quizData.classroom_name}</option>`;
                ragClassSelect.disabled = true;
                await loadRagDocuments(quizData.classroom);
            }
        }

        // FIX Bug 2: bindAiGeneratorEvents() is called via DOMContentLoaded (see bottom of file)
        // to ensure events are always bound regardless of init() success/failure.
        // The aiExtractSubject fix below is done here (after quizData loads) to populate subject correctly.

        document.getElementById('loadingQuiz').style.display = 'none';
        document.getElementById('quizContent').style.display = 'block';

        // Initialize AI Generator shared logic
        AIGenerator.init({
            context: 'quiz',
            quizId: quizId,
            subjectId: quizData?.subject_id,
            onSaveSuccess: async () => {
                await loadQuizData();
                await loadSelectedQuestions();
                await loadQuestionBank();
            }
        });

        // Initialize Shared Question Editor
        const subjectsRes = await fetch('/api/classes/subjects/', { headers: authHeaders() });
        const subjectsData = await subjectsRes.json();
        
        QuestionEditor.init({
            context: 'quiz',
            subjects: subjectsData,
            subjectId: quizData?.subject_id,
            currentQuizId: quizId,
            onSave: async () => {
                await loadQuizData();
                await loadSelectedQuestions();
                await loadQuestionBank();
            }
        });
    } catch (e) {
        console.error(e);
        showInitError(e?.message || 'Lỗi khởi tạo màn hình. Vui lòng đăng nhập lại.');
    }
}

async function loadQuizData() {
    const res = await fetch(`/api/exams/${quizId}/`, { headers: authHeaders() });
    if (res.status === 401) {
        window.location.href = '/login/';
        return;
    }
    if (!res.ok) {
        throw new Error('Không tìm thấy đề thi hoặc bạn không có quyền truy cập.');
    }
    quizData = await res.json();

    const setElText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    setElText('quizTitle', quizData.title);
    setElText('breadcrumbQuizTitle', quizData.title);
    setElText('breadcrumbClassLink', quizData.classroom_name);
    
    const classLink = document.getElementById('breadcrumbClassLink');
    if (classLink && quizData.classroom) {
        classLink.href = `/classes/${quizData.classroom}/`;
    }

    setElText('quizDesc', quizData.description || 'Không có mô tả.');
    setElText('quizDuration', quizData.duration_minutes);
    setElText('quizQuestionCount', quizData.question_count);

    const schedInfo = [];
    if (quizData.publish_at) {
        try {
            schedInfo.push(`Hẹn ngày: ${new Date(quizData.publish_at).toLocaleString('vi-VN')}`);
        } catch(e) {}
    }
    if (quizData.due_date) {
        try {
            schedInfo.push(`Hạn nộp: ${new Date(quizData.due_date).toLocaleString('vi-VN')}`);
        } catch(e) {}
    }
    setElText('quizScheduleInfo', schedInfo.join(' | '));

    const statusEl = document.getElementById('quizStatus');
    if (statusEl) {
        if (quizData.is_published) {
            statusEl.textContent = 'Công khai';
            statusEl.className = 'badge bg-success';
            const pBtn = document.getElementById('publishBtn');
            const uBtn = document.getElementById('unpublishBtn');
            if (pBtn) pBtn.style.display = 'none';
            if (uBtn) uBtn.style.display = 'inline-block';
        } else {
            statusEl.textContent = 'Nháp';
            statusEl.className = 'badge bg-secondary';
            const pBtn = document.getElementById('publishBtn');
            const uBtn = document.getElementById('unpublishBtn');
            if (pBtn) pBtn.style.display = 'inline-block';
            if (uBtn) uBtn.style.display = 'none';
        }
    }
}

async function loadSelectedQuestions() {
    const res = await fetch(`/api/exams/${quizId}/questions/`, { headers: authHeaders() });
    if (res.status === 401) {
        window.location.href = '/login/';
        return;
    }
    if (!res.ok) {
        throw new Error('Không tải được danh sách câu hỏi của đề thi.');
    }
    const data = await res.json();
    selectedQuestions = normalizeListResponse(data);
    await syncQuizPointsToTenScale();
    renderSelectedQuestions();
}

async function syncQuizPointsToTenScale() {
    if (!Array.isArray(selectedQuestions) || selectedQuestions.length === 0) return;

    const pointsPerQuestion = parseFloat((10 / selectedQuestions.length).toFixed(2));
    const updates = [];

    selectedQuestions.forEach((qq) => {
        const currentPoints = parseFloat(qq.points || 0);
        if (Number.isNaN(currentPoints) || Math.abs(currentPoints - pointsPerQuestion) > 0.001) {
            updates.push(
                fetch(`/api/exams/${quizId}/questions/${qq.id}/`, {
                    method: 'PATCH',
                    headers: authHeaders(),
                    body: JSON.stringify({ points: pointsPerQuestion })
                })
            );
            qq.points = pointsPerQuestion.toFixed(2);
        }
    });

    if (updates.length > 0) {
        await Promise.allSettled(updates);
    }
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
    
    const perQuestionPoint = selectedQuestions.length > 0 ? (10 / selectedQuestions.length) : 0;
    selectedQuestions.sort((a,b) => a.order - b.order).forEach((qq, idx) => {
        qq.points = perQuestionPoint.toFixed(2);
        const q = qq.question;
        const item = document.createElement('li');
        item.className = `qb-question-item animate-in`;
        item.style.animationDelay = `${idx * 0.05}s`;
        item.innerHTML = `
            <div class="qb-q-header">
                <div class="d-flex align-items-center gap-2 flex-wrap">
                    <span class="qb-q-number">Câu ${idx + 1}</span>
                    ${typeBadge(q.question_type)}
                    ${diffBadge(q.difficulty)}
                    <span class="badge bg-light text-primary border ms-1" style="font-size:0.75rem">
                        <i class="bi bi-star-fill me-1 text-warning"></i>${qq.points} điểm
                    </span>
                </div>
                <div class="d-flex align-items-center gap-2">
                    <button class="btn btn-sm btn-light text-primary px-2 border" onclick="editQuestion(${q.id})" title="Sửa nội dung">
                        <i class="bi bi-pencil-square"></i>
                    </button>
                    <button class="btn btn-sm btn-light text-danger px-2 border" onclick="promptRemoveQQ(${qq.id})" title="Rút câu hỏi này">
                        <i class="bi bi-trash-fill"></i>
                    </button>
                </div>
            </div>
            <div class="mb-3" style="line-height:1.6; color: var(--color-text);">${renderQuestionStem(q)}</div>
            <div class="small bg-light p-3 rounded-3" style="border-left: 3px solid var(--color-border);">${renderQuestionContent(q)}</div>
        `;
        list.appendChild(item);
    });
    document.getElementById('totalPoints').textContent = selectedQuestions.length > 0 ? 10 : 0;
}

async function loadQuestionBank() {
    const res = await fetch('/api/exams/questions/', { headers: authHeaders() });
    if (res.status === 401) {
        window.location.href = '/login/';
        return;
    }
    if (!res.ok) {
        throw new Error('Không tải được ngân hàng câu hỏi.');
    }
    const data = await res.json();
    questionBank = normalizeListResponse(data);
    renderQuestionBank(questionBank);
}



function renderQuestionBank(questions) {
    const list = document.getElementById('questionBankList');
    list.innerHTML = '';
    let addedQIDs = new Set(selectedQuestions.map(qq => qq.question.id));
    
    questions.forEach(q => {
        const item = document.createElement('li');
        item.className = 'qb-bank-item';
        const isAdded = addedQIDs.has(q.id);
        
        const actionBtn = isAdded 
            ? `<span class="badge bg-light text-muted border px-2 py-1"><i class="bi bi-check2 me-1"></i>Đã thêm</span>`
            : `<button class="btn btn-sm btn-outline-primary px-3 py-1 rounded-pill" onclick="addQuestionToQuiz(${q.id})" style="font-size:0.75rem; font-weight:700;">Thêm</button>`;
        
        item.innerHTML = `
            <div class="qb-bank-q-text">${escapeHtml(getQuestionDisplayText(q))}</div>
            <div class="d-flex justify-content-between align-items-center">
                <div class="d-flex gap-1">
                    ${typeBadge(q.question_type)}
                    <span class="text-muted" style="font-size:0.7rem; font-weight:500;">${q.subject_name}</span>
                </div>
                <div class="d-flex gap-1 align-items-center">
                    <button class="btn btn-sm btn-link text-muted p-1" onclick="editQuestion(${q.id})" title="Sửa"><i class="bi bi-pencil-square"></i></button>
                    ${actionBtn}
                </div>
            </div>
        `;
        list.appendChild(item);
    });
}

function filterBank() {
    const term = document.getElementById('bankSearch').value.toLowerCase();
    const filtered = questionBank.filter(q =>
        (getQuestionDisplayText(q).toLowerCase().includes(term) || (q.subject_name || '').toLowerCase().includes(term))
    );
    renderQuestionBank(filtered);
}

async function addQuestionToQuiz(qId) {
    let maxOrder = 0;
    if (selectedQuestions.length > 0) {
        maxOrder = Math.max(...selectedQuestions.map(qq => qq.order));
    }
    const nextQuestionCount = selectedQuestions.length + 1;
    const nextPointValue = parseFloat((10 / nextQuestionCount).toFixed(2));

    const res = await fetch(`/api/exams/${quizId}/questions/`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ question_id: qId, order: maxOrder + 1, points: nextPointValue })
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

document.getElementById('confirmDeleteBtn')?.addEventListener('click', async () => {
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



function openQuestionEditor() {
    QuestionEditor.open();
}

async function editQuestion(qId) {
    try {
        const res = await fetch(`/api/exams/questions/${qId}/`, { headers: authHeaders() });
        if (!res.ok) throw new Error("Lỗi tải thông tin câu hỏi.");
        const q = await res.json();
        QuestionEditor.open({ data: q });
    } catch (e) {
        if (window.showGlobalAlert) {
            window.showGlobalAlert(e.message, 'danger');
        } else {
            alert(e.message);
        }
    }
}



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





init();
