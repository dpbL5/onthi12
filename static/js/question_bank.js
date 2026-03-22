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
        const aiExtractSub = document.getElementById('aiExtractSubject');
        
        if (filterSub) filterSub.innerHTML = '<option value="">Tất cả môn học</option>';
        if (qSub) qSub.innerHTML = '';
        if (aiExtractSub) aiExtractSub.innerHTML = '';
        
        subjects.forEach(s => {
            filterSub.add(new Option(s.name, s.id));
            qSub.add(new Option(s.name, s.id));
            if (aiExtractSub) aiExtractSub.add(new Option(s.name, s.id));
        });

        const classRes = await fetch('/api/classes/', { headers: authHeaders() });
        if (classRes.ok) {
            const classData = await classRes.json();
            const ragClassSelect = document.getElementById('ragClass');
            if (ragClassSelect && Array.isArray(classData)) {
                classData.forEach(c => {
                    ragClassSelect.add(new Option(c.name, c.id));
                });
            }
        }

        // Bắt sự kiện thay đổi Lớp học ⇒ tải danh sách Tài liệu
        const ragClassEl = document.getElementById('ragClass');
        if (ragClassEl) {
            ragClassEl.addEventListener('change', async () => {
                await loadRagDocuments(ragClassEl.value);
            });
        }

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
    easy: '<span class="badge bg-success">Nhận biết</span>',
    medium: '<span class="badge bg-warning text-dark">Thông hiểu</span>',
    hard: '<span class="badge bg-danger">Vận dụng</span>'
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
    document.getElementById('questionModalTitle').innerText = 'Tạo câu hỏi thủ công';
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
        let res;
        if (!currentEditId) {
            // Create Question (Single-Shot)
            res = await fetch('/api/exams/questions/', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify(payload)
            });
        } else {
            // Update Question
            res = await fetch(`/api/exams/questions/${currentEditId}/update-full/`, {
                method: 'PUT',
                headers: authHeaders(),
                body: JSON.stringify(payload)
            });
        }

        if(res.ok) {
            showGlobalAlert(currentEditId ? 'Cập nhật thành công!' : 'Tạo mới thành công!', 'success');
            bootstrap.Modal.getInstance(document.getElementById('questionModal')).hide();
            loadQuestions();
        } else {
            const errData = await res.json();
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

// ─── AI Question Generator Logic ───────────────────────────────────────────

let currentDrafts = { file: [], rag: [] };

// Guard chống thoát trang khi AI đang xử lý
let aiParsingInProgress = false;
window.addEventListener('beforeunload', function(e) {
    if (aiParsingInProgress) {
        e.preventDefault();
        e.returnValue = 'AI đang phân tích tài liệu. Nếu thoát, dữ liệu sẽ bị mất. Bạn có chắc muốn rời trang?';
        return e.returnValue;
    }
});

function getQuestionDisplayText(q) {
    if (q?.text && String(q.text).trim()) return q.text;
    return blocksToText(q?.content_json || []);
}

function getOptionDisplayText(o) {
    if (o?.text && String(o.text).trim()) return o.text;
    return blocksToText(o?.content_json || []);
}

// ─── RAG: Tải danh sách Tài liệu khi chọn Lớp học ───
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

function hasConfiguredAnswer(q) {
    const type = q?.question_type || 'multiple_choice';
    if (type === 'short_answer') return !!(q?.correct_answer_text && String(q.correct_answer_text).trim());
    const options = Array.isArray(q?.options) ? q.options : [];
    return options.length > 0 && options.some((o) => !!o.is_correct);
}

function renderQuestionStem(q, extraClass = '') {
    const imageMap = buildQuestionImageMap(q?.question_images || []);
    const blocksHtml = Array.isArray(q?.content_json) ? renderContentBlocks(q.content_json, imageMap) : '';
    const textFallback = getQuestionDisplayText(q);
    const stemHtml = blocksHtml && blocksHtml.trim()
        ? `<div class="${extraClass}">${blocksHtml}</div>`
        : `<div class="${extraClass} q-markdown-text">${marked.parse(safeEscapeHtmlForMarkdown(textFallback || ''))}</div>`;
    return stemHtml;
}

function renderQuestionContent(q) {
    return renderAnswerSnippet(q);
}

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
                        ${TYPE_LBL[qType] || TYPE_LBL.multiple_choice}
                        ${DIFF_LBL[q.difficulty] || DIFF_LBL.medium}
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
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Đang lưu...';

    try {
        const res = await fetch('/api/ai/generate/save-bulk/', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
                questions: selectedDrafts,
                subject_id: source === 'file' ? document.getElementById('aiExtractSubject').value : (document.getElementById('filterSubject').value || subjects[0]?.id),
            })
        });

        if (res.ok) {
            showGlobalAlert(`Đã nhập ${selectedDrafts.length} câu hỏi thành công!`, 'success');
            bootstrap.Modal.getInstance(document.getElementById('aiGeneratorModal')).hide();
            loadQuestions();
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
    saveBtn.style.display = 'none';

    // Hiện loader kèm thông báo thời gian xử lý
    loader.innerHTML = `
        <div class="d-flex align-items-center gap-2 text-primary">
            <span class="spinner-border spinner-border-sm" role="status"></span>
            <span><strong>AI đang phân tích tài liệu...</strong><br>
            <small class="text-muted">Quá trình này có thể mất 1–3 phút tuỳ dung lượng file. Vui lòng <strong>không đóng hoặc chuyển trang</strong> trong thời gian chờ.</small></span>
        </div>`;
    loader.style.display = 'block';

    // Bật guard chống thoát trang
    aiParsingInProgress = true;

    try {
        // Bắt đầu Upload sang Cloudinary trực tiếp
        const cloudName = 'dvwkjiz2i';
        const uploadPreset = 'nvh_upload';
        
        const filesData = [];
        const filesCount = fileInput.files.length;
        
        for (let i = 0; i < filesCount; i++) {
            const f = fileInput.files[i];
            errBox.innerHTML = `<span class="text-info">Đang tải tài liệu lên Cloud Storage trung gian (${i+1}/${filesCount})...</span>`;
            
            const cloudFormData = new FormData();
            cloudFormData.append('file', f);
            cloudFormData.append('upload_preset', uploadPreset);
            
            const cloudRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, {
                method: 'POST',
                body: cloudFormData
            });
            
            if (!cloudRes.ok) {
                const cloudErr = await cloudRes.json();
                throw new Error(cloudErr.error?.message || 'Có lỗi khi upload file.');
            }
            
            const cloudData = await cloudRes.json();
            filesData.push({ file_url: cloudData.secure_url, file_name: f.name });
        }
        
        errBox.innerHTML = '<span class="text-success">Tải xong. Trình phân tích đang xử lý trích xuất câu hỏi...</span>';

        // Lấy thông tin Môn học nếu có
        let subject_id = null;
        const aiExtractSub = document.getElementById('aiExtractSubject');
        if (aiExtractSub && aiExtractSub.value) {
            subject_id = aiExtractSub.value;
        }

        // Gửi mảng tài liệu lên Backend
        const payload = { 
            files: filesData,
            subject_id: subject_id
        };

        const res = await fetch('/api/ai/generate/extract-file/', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (res.ok) {
            errBox.innerHTML = '';
            currentDrafts.file = data.questions;
            window.extractedImagesMap = (data.images && typeof data.images === 'object') ? data.images : {};
            renderDraftBoard('file');
            if (currentDrafts.file.length > 0) saveBtn.style.display = 'inline-block';
        } else {
            errBox.textContent = data.error || 'Lỗi trích xuất từ server.';
        }
    } catch (err) {
        errBox.textContent = err.message || 'Lỗi kết nối tới AI Service.';
    } finally {
        aiParsingInProgress = false;
        btn.disabled = false;
        loader.style.display = 'none';
        loader.innerHTML = '';
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
    const classId = document.getElementById('ragClass').value;

    if (!topic || !classId) return;

    const btn = document.getElementById('btnGenerateRAG');
    const loader = document.getElementById('ragLoading');
    const errBox = document.getElementById('ragError');
    const saveBtn = document.getElementById('btnSaveDraftsRag');

    errBox.textContent = '';
    btn.disabled = true;
    saveBtn.style.display = 'none';

    // Hiện loader kèm thông báo thời gian xử lý
    loader.innerHTML = `
        <div class="d-flex align-items-center gap-2 text-primary">
            <span class="spinner-border spinner-border-sm" role="status"></span>
            <span><strong>AI đang tạo câu hỏi từ tài liệu nội bộ...</strong><br>
            <small class="text-muted">Quá trình này có thể mất 30 giây – 2 phút. Vui lòng <strong>không đóng hoặc chuyển trang</strong> trong thời gian chờ.</small></span>
        </div>`;
    loader.style.display = 'block';

    // Bật guard chống thoát trang
    aiParsingInProgress = true;

    try {
        const res = await fetch('/api/ai/generate/from-rag/', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
                class_id: classId,
                topic: topic,
                count: parseInt(count),
                difficulty: difficulty,
                question_types: questionTypes,
                document_id: document.getElementById('ragDocument')?.value || null,
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
        aiParsingInProgress = false;
        btn.disabled = false;
        loader.style.display = 'none';
        loader.innerHTML = '';
    }
});

init();
