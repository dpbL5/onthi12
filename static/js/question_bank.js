let questions = [];
let subjects = [];
let mde = null;
let currentEditId = null;
let currentQuestionImages = [];

function authHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('access')
    };
}

function authOnlyHeaders() {
    return {
        'Authorization': 'Bearer ' + localStorage.getItem('access')
    };
}

// Custom image upload method for EasyMDE
function uploadImage(file, onSuccess, onError) {
    const formData = new FormData();
    formData.append('image', file);
    formData.append('source_type', 'user_upload');
    
    fetch('/api/exams/questions/images/upload/', {
        method: 'POST',
        headers: authOnlyHeaders(),
        body: formData
    })
    .then(res => res.json())
    .then(data => {
        if (data.url) onSuccess(data.url);
        else onError(data.error || 'Upload failed');
    })
    .catch(e => onError('Network error'));
}

async function init() {
    try {
        const subRes = await fetch('/api/classes/subjects/', { headers: authHeaders() });
        subjects = await subRes.json();
        
        const filterSub = document.getElementById('filterSubject');
        const qSub = document.getElementById('qSubject');
        subjects.forEach(s => {
            filterSub.add(new Option(s.name, s.id));
            qSub.add(new Option(s.name, s.id));
        });

        mde = new EasyMDE({
            element: document.getElementById('qText'),
            spellChecker: false,
            uploadImage: true,
            imageAccept: 'image/png, image/jpeg, image/webp',
            imageUploadFunction: uploadImage,
            hideIcons: ['guide'],
            status: false,
            minHeight: "200px"
        });

        loadQuestions();
    } catch (e) {
        showGlobalAlert('Lỗi khởi tạo màn hình Ngân hàng.', 'danger');
    }
}

let searchTimer;
function debounceSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        loadQuestions();
    }, 500);
}

async function loadQuestions() {
    const loading = document.getElementById('loading');
    const questionList = document.getElementById('questionList');
    loading.style.display = 'block';
    questionList.style.display = 'none';

    // Clear selection
    selectedIds = [];
    updateBulkToolbar();

    try {
        const sub = document.getElementById('filterSubject').value;
        const diff = document.getElementById('filterDiff').value;
        const type = document.getElementById('filterType').value;
        const search = document.getElementById('filterSearch').value;
        
        let url = `/api/exams/questions/?subject=${sub}&difficulty=${diff}&question_type=${type}&search=${encodeURIComponent(search)}`;
        
        const res = await fetch(url, { headers: authHeaders() });
        questions = await res.json();
        
        // Sorting: Needs review items first (client-side sort is fine for metadata)
        questions.sort((a,b) => {
            const aNeeds = isNeedsReview(a);
            const bNeeds = isNeedsReview(b);
            if(aNeeds && !bNeeds) return -1;
            if(!aNeeds && bNeeds) return 1;
            return 0; // Backend already sorted by created_at
        });

        renderQuestions();
    } catch(e) {
        console.error(e);
        showGlobalAlert('Lỗi tải danh sách câu hỏi', 'danger');
    } finally {
        loading.style.display = 'none';
        questionList.style.display = 'flex';
    }
}

let selectedIds = [];

function toggleSelectAll(checked) {
    const checkboxes = document.querySelectorAll('.q-checkbox');
    selectedIds = [];
    checkboxes.forEach(cb => {
        cb.checked = checked;
        if (checked) {
            selectedIds.push(parseInt(cb.dataset.id));
        }
    });
    updateBulkToolbar();
}

function toggleSelectQuestion(id, checked) {
    if (checked) {
        if (!selectedIds.includes(id)) selectedIds.push(id);
    } else {
        selectedIds = selectedIds.filter(x => x !== id);
    }
    document.getElementById('selectAllQuestions').checked = (selectedIds.length === questions.length && questions.length > 0);
    updateBulkToolbar();
}

function updateBulkToolbar() {
    const toolbar = document.getElementById('bulkActionsToolbar');
    const countSpan = document.getElementById('selectedCount');
    
    if (selectedIds.length > 0) {
        toolbar.style.setProperty('display', 'flex', 'important');
        countSpan.innerText = `${selectedIds.length} đã chọn`;
    } else {
        toolbar.style.setProperty('display', 'none', 'important');
    }
}

function isNeedsReview(q) {
    if (q.question_type === 'multiple_choice' || q.question_type === 'true_false') {
        return !q.options || q.options.length === 0 || !q.options.some(o => o.is_correct);
    }
    if (q.question_type === 'short_answer') {
        return !q.correct_answer_text || q.correct_answer_text.trim() === '';
    }
    return false;
}

const TYPE_LBL = {
    multiple_choice: '<span class="badge bg-primary-subtle text-primary"><i class="bi bi-ui-radios-grid me-1"></i>Trắc nghiệm</span>',
    true_false: '<span class="badge bg-info-subtle text-info"><i class="bi bi-toggle-on me-1"></i>Đúng/Sai</span>',
    short_answer: '<span class="badge bg-warning-subtle text-dark"><i class="bi bi-pencil-square me-1"></i>Trả lời ngắn</span>'
};

const DIFF_LBL = {
    easy: '<span class="badge bg-success">Dễ</span>',
    medium: '<span class="badge bg-warning text-dark">Vừa</span>',
    hard: '<span class="badge bg-danger">Khó</span>'
};

function renderQuestions() {
    const list = document.getElementById('questionList');
    list.innerHTML = '';
    
    if(questions.length === 0) {
        list.innerHTML = '<div class="col-12 py-5 text-center text-muted"><i class="bi bi-inbox fs-1 d-block mb-3"></i>Không tìm thấy câu hỏi nào.</div>';
        return;
    }

    questions.forEach((q, idx) => {
        const needsReview = isNeedsReview(q);
        const reviewBadge = needsReview 
            ? `<span class="badge bg-danger ms-2 cursor-pointer" onclick="openQuickReview(${q.id})" title="Nhấp để cập nhật đáp án ngay"><i class="bi bi-exclamation-triangle-fill me-1"></i>Cần Cập nhật Đáp án</span>` 
            : '';

        let subName = q.subject_name || subjects.find(s => s.id === q.subject)?.name || 'N/A';
        const isSelected = selectedIds.includes(q.id);
        const questionImages = Array.isArray(q.question_images) ? q.question_images : [];
        const imageMap = buildQuestionImageMap(questionImages);
        const questionText = (q.text || '').trim() || blocksToText(q.content_json || []);
        const blocksHtml = renderContentBlocks(q.content_json || [], imageMap);
        const imagesPreview = questionImages.slice(0, 6).map((qi) => {
            const url = qi?.image?.image_url;
            if (!url) return '';
            return `<img src="${url}" class="rounded border" style="height:44px;width:44px;object-fit:cover;" title="${escapeHtml(qi.placement || 'stem')} • ${escapeHtml(qi.source_type || '')}">`;
        }).join('');

        list.innerHTML += `
            <div class="col-12">
                <div class="card border-0 border-start border-4 ${needsReview ? 'border-danger' : 'border-primary'} shadow-sm h-100">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <div class="d-flex align-items-start gap-3">
                                <div class="form-check mt-1">
                                    <input class="form-check-input q-checkbox" type="checkbox" data-id="${q.id}" ${isSelected ? 'checked' : ''} onchange="toggleSelectQuestion(${q.id}, this.checked)">
                                </div>
                                <div>
                                    ${TYPE_LBL[q.question_type || 'multiple_choice']}
                                    ${DIFF_LBL[q.difficulty || 'medium']}
                                    <span class="badge bg-light text-muted border border-secondary border-opacity-25 ms-1">${subName}</span>
                                    ${reviewBadge}
                                </div>
                            </div>
                            <div class="d-flex gap-2">
                                <button class="btn btn-sm btn-outline-primary" onclick="openEditModal(${q.id})" title="Chỉnh sửa">
                                    <i class="bi bi-pencil"></i>
                                </button>
                                
                                <button class="btn btn-sm btn-outline-danger" onclick="deleteQuestion(${q.id})" title="Xoá">
                                    <i class="bi bi-trash"></i>
                                </button>
                            </div>
                        </div>
                        ${blocksHtml && blocksHtml.trim() ? `<div class="mb-2" style="margin-left: 2rem;">${blocksHtml}</div>` : `<div class="q-markdown-text mb-2 text-dark" style="font-size: 1.05rem; margin-left: 2rem;">${marked.parse(safeEscapeHtmlForMarkdown(questionText || ''))}</div>`}
                        ${q.image ? `<div class="mb-2" style="margin-left: 2rem;"><img src="${q.image}" class="img-thumbnail" style="max-height: 80px;"></div>` : ''}
                        ${questionImages.length ? `<div class="mb-2 d-flex flex-wrap gap-1 align-items-center" style="margin-left: 2rem;"><span class="badge bg-light text-dark border">${questionImages.length} ảnh</span>${imagesPreview}</div>` : ''}
                        
                        <div class="p-3 bg-light rounded mt-3 small" style="margin-left: 2rem;">
                            ${renderAnswerSnippet(q)}
                        </div>
                    </div>
                </div>
            </div>
        `;
    });
}

function escapeHtml(unsafe) {
    return (unsafe || '').toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

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

function blocksToText(blocks) {
    if (!Array.isArray(blocks)) return '';
    return blocks
        .filter((b) => b && b.type === 'text' && typeof b.value === 'string')
        .map((b) => b.value)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function renderContentBlocks(blocks, imageMap = {}) {
    if (!Array.isArray(blocks) || blocks.length === 0) return '';
    return blocks.map((b) => {
        if (!b || !b.type) return '';
        if (b.type === 'text') return `<span>${escapeHtml(b.value || '')}</span>`;
        if (b.type === 'image') {
            const url = b.url || (b.sha256 ? imageMap[b.sha256] : null);
            if (url) {
                return `<img src="${url}" class="img-fluid rounded border my-1 d-block" style="max-height:90px;" alt="Hình câu hỏi">`;
            }
        }
        return '';
    }).join(' ');
}

function renderAnswerSnippet(q) {
    const type = q.question_type || 'multiple_choice';
    if(type === 'short_answer') {
        return `<strong>Đáp án:</strong> <span class="${!q.correct_answer_text ? 'text-danger fst-italic' : 'text-success fw-bold'}">${escapeHtml(q.correct_answer_text || '(Chưa điền đáp án)')}</span>`;
    }
    
    if(!q.options || q.options.length === 0) return '<span class="text-danger fst-italic">Chưa có tuỳ chọn đáp án nào.</span>';
    
    if(type === 'multiple_choice') {
        return q.options.map((o, i) => {
            const l = String.fromCharCode(65 + i);
            const optText = (o.text || '').trim();
            const optBlocksHtml = renderContentBlocks(o.content_json || [], buildQuestionImageMap(q.question_images || []));
            const contentHtml = optBlocksHtml && optBlocksHtml.trim() ? `<span class='small'>${optBlocksHtml}</span>` : `<span class="q-markdown-text markdown-inline">${marked.parseInline(safeEscapeHtmlForMarkdown(optText || ''))}</span>`;
            return `<span class="${o.is_correct ? 'text-success fw-bold' : 'text-muted'} me-3">${l}. ${contentHtml}</span>`;
        }).join('');
    }
    // True/False
    return q.options.map((o, i) => {
        const l = String.fromCharCode(97 + i);
        const icon = o.is_correct ? '<span class="text-success fw-bold">[Đ]</span>' : '<span class="text-danger fw-bold">[S]</span>';
        const optText = (o.text || '').trim();
        const optBlocksHtml = renderContentBlocks(o.content_json || [], buildQuestionImageMap(q.question_images || []));
        const contentHtml = optBlocksHtml && optBlocksHtml.trim() ? `<span class='small'>${optBlocksHtml}</span>` : `<span class="q-markdown-text markdown-inline">${marked.parseInline(safeEscapeHtmlForMarkdown(optText || ''))}</span>`;
        return `<div class="mb-1">${l}) ${contentHtml} ${icon}</div>`;
    }).join('');
}


// ─── Modal Functions ─────────────────────────────────────────────────────────

function toggleOptionFields() {
    const type = document.getElementById('qType').value;
    const c = document.getElementById('optionsContainer');
    const ctxWrap = document.getElementById('qContextWrapper');
    
    ctxWrap.style.display = (type === 'true_false') ? 'block' : 'none';

    let html = '';
    
    if (type === 'multiple_choice') {
        html = `
            <p class="text-muted small">Nhập 4 phương án và chọn 1 phương án đúng:</p>
            ${[0,1,2,3].map(i => `
                <div class="d-flex mb-2 align-items-center gap-2">
                    <div class="form-check m-0">
                        <input class="form-check-input" type="radio" name="optCorrect" value="${i}" ${i===0 ? 'checked':''}>
                    </div>
                    <span class="fw-bold">${String.fromCharCode(65+i)}.</span>
                    <input type="text" class="form-control form-control-sm optText" placeholder="Nội dung phương án ${String.fromCharCode(65+i)}..." required>
                </div>
            `).join('')}
        `;
    } else if (type === 'true_false') {
        html = `
            <p class="text-muted small">Nhập 4 phát biểu và xét tính Đúng/Sai cho từng cái:</p>
            ${[0,1,2,3].map(i => `
                <div class="d-flex mb-2 align-items-center gap-2">
                    <span class="fw-bold">${String.fromCharCode(97+i)}.</span>
                    <input type="text" class="form-control form-control-sm optText" placeholder="Phát biểu ${String.fromCharCode(97+i)}..." required>
                    <div class="btn-group btn-group-sm ms-2" role="group">
                        <input type="radio" class="btn-check tfOpt_${i}" name="tfOpt_${i}" id="tfOpt_${i}_t" value="true">
                        <label class="btn btn-outline-success" for="tfOpt_${i}_t">Đ</label>
                        <input type="radio" class="btn-check tfOpt_${i}" name="tfOpt_${i}" id="tfOpt_${i}_f" value="false" checked>
                        <label class="btn btn-outline-danger" for="tfOpt_${i}_f">S</label>
                    </div>
                </div>
            `).join('')}
        `;
    } else if (type === 'short_answer') {
        html = `
            <p class="text-muted small mb-2">Nhập chính xác đáp án (khoảng trắng sẽ được tự loại bỏ khi chấm):</p>
            <input type="text" id="saCorrectValue" class="form-control form-control-lg text-primary fw-bold" placeholder="Vd: 5.5, HCl..." required>
        `;
    }
    
    c.innerHTML = html;
}

function openCreateModal() {
    currentEditId = null;
    currentQuestionImages = [];
    document.getElementById('questionForm').reset();
    document.getElementById('questionModalTitle').innerText = 'Thêm Câu hỏi mới';
    mde.value('');
    document.getElementById('qType').value = 'multiple_choice';
    document.getElementById('questionImageStatus').innerHTML = '<span class="text-muted">Lưu câu hỏi trước, sau đó gắn ảnh.</span>';
    renderQuestionImageList([]);
    toggleOptionFields();
    
    new bootstrap.Modal(document.getElementById('questionModal')).show();
}

function openEditModal(id) {
    currentEditId = id;
    const q = questions.find(x => x.id === id);
    if(!q) return;
    
    document.getElementById('questionModalTitle').innerText = 'Chỉnh sửa Câu hỏi';
    document.getElementById('qSubject').value = q.subject;
    document.getElementById('qDiff').value = q.difficulty;
    document.getElementById('qType').value = q.question_type || 'multiple_choice';
    document.getElementById('qContext').value = q.context || '';
    mde.value(q.text || '');
    currentQuestionImages = Array.isArray(q.question_images) ? q.question_images : [];
    document.getElementById('questionImageStatus').innerHTML = '';
    renderQuestionImageList(currentQuestionImages);
    
    toggleOptionFields();
    
    // Fill data
    const type = q.question_type || 'multiple_choice';
    if(type === 'short_answer') {
        document.getElementById('saCorrectValue').value = q.correct_answer_text || '';
    } else {
        const texts = document.querySelectorAll('.optText');
        for(let i=0; i<4; i++) {
            if(q.options && q.options[i]) {
                if(texts[i]) texts[i].value = q.options[i].text;
                if(type === 'multiple_choice') {
                    if(q.options[i].is_correct) {
                        document.querySelector(`input[name="optCorrect"][value="${i}"]`).checked = true;
                    }
                } else if(type === 'true_false') {
                    if(q.options[i].is_correct) {
                        document.getElementById(`tfOpt_${i}_t`).checked = true;
                    } else {
                        document.getElementById(`tfOpt_${i}_f`).checked = true;
                    }
                }
            }
        }
    }
    
    new bootstrap.Modal(document.getElementById('questionModal')).show();
}

async function saveQuestion() {
    const text = mde.value().trim();
    if(!text) { alert('Vui lòng nhập nội dung câu hỏi.'); return; }
    
    const subj = document.getElementById('qSubject').value;
    const diff = document.getElementById('qDiff').value;
    const type = document.getElementById('qType').value;
    const ctx = document.getElementById('qContext').value.trim();
    
    let options = [];
    let correctText = '';
    
    if (type === 'short_answer') {
        correctText = document.getElementById('saCorrectValue').value.trim();
        if(!correctText) { alert('Vui lòng nhập đáp án đúng.'); return; }
    } else {
        const textInputs = document.querySelectorAll('.optText');
        for(let i=0; i<4; i++) {
            if(!textInputs[i] || !textInputs[i].value.trim()) { alert('Vui lòng điền đầy đủ các phương án.'); return; }
        }
        
        if (type === 'multiple_choice') {
            const sel = document.querySelector('input[name="optCorrect"]:checked');
            const correctIdx = sel ? parseInt(sel.value) : 0;
            for(let i=0; i<4; i++) {
                options.push({ text: textInputs[i].value.trim(), is_correct: i === correctIdx });
            }
        } else if (type === 'true_false') {
            for(let i=0; i<4; i++) {
                const isCorrect = document.querySelector(`input[name="tfOpt_${i}"]:checked`).value === 'true';
                options.push({ text: textInputs[i].value.trim(), is_correct: isCorrect });
            }
        }
    }
    
    const payload = {
        subject: subj, // For QuestionListCreateView
        difficulty: diff,
        question_type: type,
        text: text,
        context: ctx,
        correct_answer_text: correctText,
        options: options // For UpdateQuestionFullView
    };
    
    const btn = document.getElementById('btnSaveQuestion');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Đang lưu...';
    
    try {
        let qId = currentEditId;
        
        if (!qId) {
            // Step 1: Create Question
            const res = await fetch('/api/exams/questions/', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify(payload)
            });
            if(!res.ok) throw new Error('Không thể tạo câu hỏi');
            const newQ = await res.json();
            qId = newQ.id;
        }

        // Step 2: Update options and other details via update-full
        // We use PUT /api/exams/questions/<id>/update-full/ which handles nested options
        const resFull = await fetch(`/api/exams/questions/${qId}/update-full/`, {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({
                text: text,
                difficulty: diff,
                question_type: type,
                context: ctx,
                correct_answer_text: correctText,
                options: options
            })
        });

        if(resFull.ok) {
            showGlobalAlert(currentEditId ? 'Cập nhật thành công!' : 'Tạo mới thành công!', 'success');
            bootstrap.Modal.getInstance(document.getElementById('questionModal')).hide();
            loadQuestions();
        } else {
            const errData = await resFull.json();
            alert('Lỗi lưu chi tiết: ' + (errData.error || 'Unknown error'));
        }
        
    } catch(e) {
        console.error(e);
        alert('Lỗi kết nối: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Lưu câu hỏi';
    }
}

let reviewQId = null;

function openQuickReview(qId) {
    reviewQId = qId;
    const q = questions.find(x => x.id === qId);
    if(!q) return;

    const c = document.getElementById('quickReviewContent');
    let html = '';
    const type = q.question_type || 'multiple_choice';
    const imageMap = buildQuestionImageMap(q.question_images || []);
    const questionText = (q.text || '').trim() || blocksToText(q.content_json || []);
    const blocksHtml = renderContentBlocks(q.content_json || [], imageMap);

    html += blocksHtml && blocksHtml.trim()
        ? `<div class="p-3 bg-light border rounded mb-3">${blocksHtml}</div>`
        : `<div class="p-3 bg-light border rounded mb-3 q-markdown-text">${marked.parse(safeEscapeHtmlForMarkdown(questionText || ''))}</div>`;

    if (type === 'short_answer') {
        html += `
            <label class="fw-bold mb-1">Đáp án đúng:</label>
            <input type="text" id="qrText" class="form-control" placeholder="Nhập số hoặc văn bản ngắn..." value="${q.correct_answer_text||''}">
        `;
    } else if (type === 'multiple_choice') {
        html += `<label class="fw-bold mb-2">Chọn đáp án đúng (A/B/C/D):</label>`;
        if(q.options && q.options.length) {
            q.options.forEach((o, i) => {
                html += `
                <div class="form-check mb-2">
                    <input class="form-check-input" type="radio" name="qrOpt" value="${i}" id="qrOpt${i}" ${o.is_correct?'checked':''}>
                    <label class="form-check-label" for="qrOpt${i}">${String.fromCharCode(65+i)}. ${escapeHtml(o.text)}</label>
                </div>`;
            });
        }
    } else if (type === 'true_false') {
        html += `<label class="fw-bold mb-2">Chọn Đúng/Sai:</label>`;
        if(q.options && q.options.length) {
            q.options.forEach((o, i) => {
                html += `
                <div class="d-flex align-items-center mb-2 justify-content-between p-2 border rounded">
                    <span>${String.fromCharCode(97+i)}) ${escapeHtml(o.text)}</span>
                    <div class="btn-group btn-group-sm">
                        <input type="radio" class="btn-check" name="qrTf_${i}" id="qrTf_${i}_t" value="true" ${o.is_correct?'checked':''}>
                        <label class="btn btn-outline-success" for="qrTf_${i}_t">Đ</label>
                        <input type="radio" class="btn-check" name="qrTf_${i}" id="qrTf_${i}_f" value="false" ${!o.is_correct?'checked':''}>
                        <label class="btn btn-outline-danger" for="qrTf_${i}_f">S</label>
                    </div>
                </div>`;
            });
        }
    }

    c.innerHTML = html;
    new bootstrap.Modal(document.getElementById('quickReviewModal')).show();
}

async function saveQuickReview() {
    const q = questions.find(x => x.id === reviewQId);
    if(!q) return;
    
    const type = q.question_type || 'multiple_choice';
    let options = JSON.parse(JSON.stringify(q.options || []));
    let cat = q.correct_answer_text;

    if (type === 'short_answer') {
        cat = document.getElementById('qrText').value.trim();
        if(!cat) { alert('Vui lòng nhập.'); return; }
    } else if (type === 'multiple_choice') {
        const sel = document.querySelector('input[name="qrOpt"]:checked');
        if(!sel) { alert('Vui lòng chọn 1 ý.'); return; }
        const idx = parseInt(sel.value);
        options.forEach((o, i) => o.is_correct = (i === idx));
    } else if (type === 'true_false') {
        options.forEach((o, i) => {
            const val = document.querySelector(`input[name="qrTf_${i}"]:checked`)?.value;
            o.is_correct = (val === 'true');
        });
    }

    try {
        const res = await fetch(`/api/exams/questions/${reviewQId}/update-full/`, {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({
                text: q.text,
                difficulty: q.difficulty,
                question_type: type,
                context: q.context,
                correct_answer_text: cat,
                options: options
            })
        });
        
        if(res.ok) {
            bootstrap.Modal.getInstance(document.getElementById('quickReviewModal')).hide();
            showGlobalAlert('Cập nhật đáp án thành công!', 'success');
            loadQuestions();
        } else {
            alert('Lỗi cập nhật');
        }
    } catch(e) {
        alert('Lỗi mạng');
    }
}

async function bulkDeleteQuestions() {
    if(!selectedIds.length) return;
    if(!confirm(`Bạn có chắc muốn xoá ${selectedIds.length} câu hỏi đã chọn?`)) return;

    try {
        const res = await fetch('/api/exams/questions/bulk-delete/', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ ids: selectedIds })
        });
        if(res.ok) {
            showGlobalAlert(`Đã xoá ${selectedIds.length} câu hỏi.`, 'warning');
            selectedIds = [];
            loadQuestions();
        } else {
            alert('Lỗi khi xoá hàng loạt');
        }
    } catch(e) {
        console.error(e);
        alert('Lỗi mạng');
    }
}

async function deleteQuestion(id) {
    if(!confirm('Bạn có chắc xoá câu hỏi này khỏi ngân hàng?')) return;
    try {
        const res = await fetch(`/api/exams/questions/${id}/`, {
            method: 'DELETE',
            headers: authHeaders()
        });
        if(res.ok) {
            showGlobalAlert('Đã xoá.', 'warning');
            loadQuestions();
        }
    } catch(e) { console.error(e); }
}

document.addEventListener("DOMContentLoaded", init);

function getImageMetaPayload() {
    const placement = document.getElementById('qImagePlacementSelect').value;
    const sourceType = document.getElementById('qImageSourceType').value || 'user_upload';
    const note = document.getElementById('qImageNote').value.trim();
    
    // Auto increment position based on existing images at the same placement
    const existing = currentQuestionImages.filter(img => img.placement === placement);
    const position = existing.length > 0 ? Math.max(...existing.map(img => img.position)) + 1 : 0;

    return { placement, source_type: sourceType, note, position };
}

function setQuestionImageStatus(msg, level = 'muted') {
    const statusEl = document.getElementById('questionImageStatus');
    if (!statusEl) return;
    statusEl.innerHTML = `<span class="text-${level}">${msg}</span>`;
}

function renderQuestionImageList(questionImages) {
    const listEl = document.getElementById('questionImageList');
    if (!listEl) return;

    if (!questionImages || !questionImages.length) {
        listEl.innerHTML = '<div class="text-muted small">Chưa có ảnh nào được gắn vào câu hỏi.</div>';
        return;
    }

    listEl.innerHTML = questionImages.map((qImg) => {
        const imageUrl = qImg?.image?.image_url || '';
        const sha = qImg?.image?.sha256 || '';
        return `
            <div class="d-flex gap-2 border rounded bg-white p-2 mb-2 align-items-center">
                <img src="${imageUrl}" alt="question-image" class="rounded border" style="width:48px;height:48px;object-fit:cover;">
                <div class="flex-grow-1">
                    <div class="small fw-bold">${sha ? sha.slice(0, 16) + '...' : 'Không có SHA'}</div>
                    <button type="button" class="btn btn-sm btn-light border py-0 px-2 mt-1" style="font-size:0.75rem;" onclick="copyMarkdownImage('${imageUrl}')">
                        <i class="bi bi-clipboard"></i> Copy mã chèn
                    </button>
                </div>
                <button type="button" class="btn btn-sm btn-outline-danger" onclick="unlinkQuestionImage(${currentEditId}, ${qImg.id})" title="Gỡ và xoá ảnh">
                    <i class="bi bi-trash"></i>
                </button>
            </div>
        `;
    }).join('');
}

function copyMarkdownImage(url) {
    const md = `![Hình ảnh](${url})`;
    navigator.clipboard.writeText(md).then(() => {
        if(typeof showGlobalAlert === 'function') {
            showGlobalAlert('Đã copy mã chèn ảnh. Bạn có thể dán (Ctrl+V) vào ô nội dung.', 'info');
        } else {
            alert('Đã copy mã chèn ảnh: ' + md);
        }
    }).catch(err => {
        console.error('Lỗi khi copy: ', err);
    });
}

async function refreshCurrentQuestionImages() {
    if (!currentEditId) return;
    try {
        const res = await fetch(`/api/exams/questions/${currentEditId}/`, { headers: authHeaders() });
        if (!res.ok) return;
        const latest = await res.json();
        currentQuestionImages = Array.isArray(latest.question_images) ? latest.question_images : [];
        renderQuestionImageList(currentQuestionImages);

        const idx = questions.findIndex((q) => q.id === currentEditId);
        if (idx >= 0) questions[idx] = latest;
    } catch (_) {
        // Ignore silent refresh error.
    }
}

async function uploadQuestionImage() {
    if (!currentEditId) {
        setQuestionImageStatus('Bạn cần lưu câu hỏi trước khi upload ảnh.', 'warning');
        return;
    }

    const fileInput = document.getElementById('qImageFile');
    const file = fileInput?.files?.[0];
    if (!file) {
        setQuestionImageStatus('Vui lòng chọn file ảnh.', 'warning');
        return;
    }

    const meta = getImageMetaPayload();
    const formData = new FormData();
    formData.append('image', file);
    formData.append('question_id', String(currentEditId));
    formData.append('source_type', meta.source_type);
    formData.append('placement', meta.placement);
    formData.append('position', String(meta.position));
    formData.append('note', meta.note);

    setQuestionImageStatus('Đang upload ảnh...', 'primary');

    try {
        const res = await fetch('/api/exams/questions/images/upload/', {
            method: 'POST',
            headers: authOnlyHeaders(),
            body: formData,
        });

        const data = await res.json();
        if (!res.ok) {
            setQuestionImageStatus(data.error || 'Upload ảnh thất bại.', 'danger');
            return;
        }

        fileInput.value = '';
        setQuestionImageStatus(`Đã upload và gắn ảnh thành công. SHA: ${data.sha256?.slice(0, 16)}...`, 'success');
        await refreshCurrentQuestionImages();
        await loadQuestions();
    } catch (e) {
        setQuestionImageStatus('Lỗi mạng khi upload ảnh.', 'danger');
    }
}

async function linkImageBySha() {
    if (!currentEditId) {
        setQuestionImageStatus('Bạn cần lưu câu hỏi trước khi link ảnh.', 'warning');
        return;
    }

    const shaInput = document.getElementById('qImageSha256');
    const sha256 = (shaInput?.value || '').trim();
    if (!sha256) {
        setQuestionImageStatus('Vui lòng nhập SHA-256.', 'warning');
        return;
    }

    const meta = getImageMetaPayload();
    setQuestionImageStatus('Đang gắn ảnh theo SHA...', 'primary');

    try {
        const res = await fetch(`/api/exams/questions/${currentEditId}/images/link/`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
                sha256,
                source_type: meta.source_type,
                placement: meta.placement,
                position: meta.position,
                note: meta.note,
            })
        });
        const data = await res.json();
        if (!res.ok) {
            setQuestionImageStatus(data.error || 'Link ảnh thất bại.', 'danger');
            return;
        }

        shaInput.value = '';
        setQuestionImageStatus('Đã gắn ảnh theo SHA thành công.', 'success');
        await refreshCurrentQuestionImages();
        await loadQuestions();
    } catch (e) {
        setQuestionImageStatus('Lỗi mạng khi link ảnh.', 'danger');
    }
}

async function unlinkQuestionImage(questionId, qImgId) {
    if (!questionId || !qImgId) return;
    if (!confirm('Gỡ liên kết ảnh khỏi câu hỏi này?')) return;

    try {
        const res = await fetch(`/api/exams/questions/${questionId}/images/${qImgId}/`, {
            method: 'DELETE',
            headers: authOnlyHeaders(),
        });

        if (!res.ok) {
            setQuestionImageStatus('Không thể gỡ ảnh khỏi câu hỏi.', 'danger');
            return;
        }

        setQuestionImageStatus('Đã gỡ liên kết ảnh.', 'success');
        await refreshCurrentQuestionImages();
        await loadQuestions();
    } catch (e) {
        setQuestionImageStatus('Lỗi mạng khi gỡ ảnh.', 'danger');
    }
}
