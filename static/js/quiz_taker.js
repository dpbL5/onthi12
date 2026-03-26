const token = localStorage.getItem('access');
let attemptId = null, quizQuestions = [], endTimeTime = null, timerInterval = null;
let currentAnswers = {};
if (!token) window.location.href = '/login/';

function authHeaders() { return {'Content-Type':'application/json','Authorization':'Bearer '+token}; }
function escapeHtml(s) { return (s||'').toString().replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
// Rendering helpers removed. Using QuestionRenderer.

async function init() {
    try {
        // 1. Fetch quiz info
        const res = await fetch('/api/exams/' + quizId + '/', {headers: authHeaders()});
        if (!res.ok) throw new Error();
        const quizInfo = await res.json();
        
        if (!quizInfo) { showGlobalAlert('Bạn không có quyền hoặc đề thi chưa mở.', 'danger'); setTimeout(function() { window.location.href='/dashboard/'; }, 2000); return; }
        document.getElementById('introTitle').textContent = quizInfo.title;
        document.getElementById('activeQuizTitle').textContent = quizInfo.title;
        document.getElementById('introDesc').textContent = quizInfo.description || 'Không có mô tả.';
        document.getElementById('introDuration').textContent = quizInfo.duration_minutes;
        document.getElementById('introCount').textContent = quizInfo.question_count;

        // 2. Check if already completed by calling start endpoint
        try {
            var startRes = await fetch('/api/exams/' + quizId + '/start/', {method:'POST', headers:authHeaders()});
            var startData = await startRes.json();
            if (startData.is_completed) {
                // Already completed — go directly to results
                document.getElementById('loadingState').style.display = 'none';
                document.getElementById('resultTitle').textContent = quizInfo.title;
                showResult(startData);
                return;
            }
        } catch(e) { /* ignore check error, show intro normally */ }

        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('introState').style.display = 'flex';
    } catch(e) { alert('Lỗi khởi tạo bài thi.'); window.location.href = '/dashboard/'; }
}

async function startQuiz() {
    document.getElementById('introState').style.display = 'none';
    document.getElementById('loadingState').style.display = 'block';
    try {
        const res = await fetch(`/api/exams/${quizId}/start/`, {method:'POST',headers:authHeaders()});
        const data = await res.json();
        if (data.is_completed) { document.getElementById('loadingState').style.display = 'none'; showResult(data); return; }
        if (!res.ok) { alert(data.detail || 'Không thể bắt đầu làm bài.'); window.location.href = '/dashboard/'; return; }
        attemptId = data.attempt_id;
        quizQuestions = data.questions;
        const startTime = new Date(data.start_time).getTime();
        endTimeTime = startTime + data.duration_minutes * 60 * 1000;
        renderQuestions();
        buildNavigator();
        startTimer();
        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('quizState').style.display = 'block';
        updateProgress();
    } catch(e) { alert('Lỗi kết nối.'); }
}

function renderQuestions() {
    const container = document.getElementById('questionsContainer');
    document.getElementById('totalQCount').textContent = quizQuestions.length;
    quizQuestions.sort((a,b) => a.order - b.order);
    container.innerHTML = quizQuestions.map((qq, idx) => {
        const q = qq.question;
        const qType = q.question_type || 'multiple_choice';
        const typeBadges = {multiple_choice:'<span class="badge" style="background:var(--color-primary-light);color:var(--color-primary);">Trắc nghiệm</span>',true_false:'<span class="badge" style="background:var(--color-info-light);color:var(--color-info);">Đúng / Sai</span>',short_answer:'<span class="badge" style="background:var(--color-warning-light);color:var(--color-warning);">Trả lời ngắn</span>'};
        
        let contentHtml = '';
        if (qType === 'multiple_choice') {
            const keys = ['A','B','C','D'];
            contentHtml = q.options.map((opt, oi) => {
                const optBlocksHtml = QuestionRenderer.renderOption(opt, q.question_images);
                return `<div class="quiz-option" id="opt_wrap_${opt.id}" onclick="selectMC(${qq.id}, ${opt.id})">
                    <div class="quiz-option-key">${keys[oi]||oi+1}</div>
                    <div class="small">${optBlocksHtml}</div>
                    <input type="radio" name="qq_${qq.id}" id="opt_${opt.id}" value="${opt.id}" class="d-none">
                </div>`;
            }).join('');
        } else if (qType === 'true_false') {
            contentHtml = (q.context ? `<div style="background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:1rem;margin-bottom:1rem;font-size:0.875rem;font-style:italic;">${escapeHtml(q.context)}</div>` : '')
                + q.options.map((opt, i) => {
                    const optBlocksHtml = QuestionRenderer.renderOption(opt, q.question_images);
                    return `<div style="border:1px solid var(--color-border);border-radius:var(--radius-md);padding:0.875rem 1rem;margin-bottom:0.5rem;display:flex;justify-content:space-between;align-items:center;gap:1rem;">
                        <div style="font-size:0.875rem;flex:1;">
                            <div>${String.fromCharCode(97+i)}) ${optBlocksHtml}</div>
                        </div>
                        <div style="display:flex;gap:0.5rem;flex-shrink:0;">
                            <label class="btn btn-sm btn-outline-success tf-btn" id="tf_${qq.id}_${opt.id}_t" onclick="selectTF(${qq.id},${opt.id},true)"><input type="radio" name="tf_${qq.id}_${opt.id}" value="true" class="d-none">Đúng</label>
                            <label class="btn btn-sm btn-outline-danger tf-btn" id="tf_${qq.id}_${opt.id}_f" onclick="selectTF(${qq.id},${opt.id},false)"><input type="radio" name="tf_${qq.id}_${opt.id}" value="false" class="d-none">Sai</label>
                        </div>
                    </div>`;
                }).join('');
        } else if (qType === 'short_answer') {
            contentHtml = `<input type="text" class="form-control" id="sa_${qq.id}" placeholder="Nhập đáp án..." oninput="selectSA(${qq.id})"><div class="form-text small">Nhập chính xác kết quả (số, công thức, text...)</div>`;
        }

        const questionHtml = QuestionRenderer.renderStem(q);

        return `<div class="animate-in" id="qBlock_${qq.id}" style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-lg);overflow:hidden;" style="animation-delay:${idx*0.04}s">
            <div style="height:4px;background:linear-gradient(90deg,var(--color-primary),var(--color-secondary));"></div>
            <div style="padding:1.5rem;">
                <div class="d-flex align-items-center gap-2 mb-3">
                    <span style="background:var(--color-primary);color:#fff;border-radius:var(--radius-sm);padding:0.3rem 0.75rem;font-weight:700;font-size:0.875rem;">Câu ${idx+1}</span>
                    ${typeBadges[qType]||''}
                    <span style="font-size:0.75rem;color:var(--color-muted);">${qq.points} điểm</span>
                </div>
                ${questionHtml}
                <div class="mt-4">${contentHtml}</div>
            </div>
        </div>`;
    }).join('');
}

function buildNavigator() {
    const nav = document.getElementById('questionNav');
    nav.innerHTML = quizQuestions.map((qq, i) => `<button class="quiz-nav-btn" id="nav_${qq.id}" onclick="document.getElementById('qBlock_${qq.id}').scrollIntoView({behavior:'smooth',block:'center'})">${i+1}</button>`).join('');
}

function selectMC(qqId, optId) {
    const block = document.getElementById(`qBlock_${qqId}`);
    block.querySelectorAll('.quiz-option').forEach(el => el.classList.remove('selected'));
    document.getElementById(`opt_wrap_${optId}`)?.classList.add('selected');
    const radio = document.getElementById(`opt_${optId}`);
    if (radio) radio.checked = true;
    currentAnswers[qqId] = {selected_option_id: optId};
    updateProgress();
    document.getElementById(`nav_${qqId}`)?.classList.add('answered');
}

function selectTF(qqId, optId, value) {
    if (!currentAnswers[qqId]) currentAnswers[qqId] = {true_false_answers:{}};
    if (!currentAnswers[qqId].true_false_answers) currentAnswers[qqId].true_false_answers = {};
    currentAnswers[qqId].true_false_answers[optId] = value;
    ['t','f'].forEach(k => {
        const btn = document.getElementById(`tf_${qqId}_${optId}_${k}`);
        if (btn) { btn.classList.remove('active','btn-success','btn-danger'); btn.classList.add(k==='t'?'btn-outline-success':'btn-outline-danger'); }
    });
    const activeBtn = document.getElementById(`tf_${qqId}_${optId}_${value?'t':'f'}`);
    if (activeBtn) { activeBtn.classList.remove('btn-outline-success','btn-outline-danger'); activeBtn.classList.add(value?'btn-success':'btn-danger','active'); }
    const allOptionsAnswered = true; // simplified
    updateProgress();
    if (Object.keys(currentAnswers[qqId]?.true_false_answers||{}).length > 0) document.getElementById(`nav_${qqId}`)?.classList.add('answered');
}

function selectSA(qqId) {
    const input = document.getElementById(`sa_${qqId}`);
    if (input?.value.trim()) { currentAnswers[qqId] = {answer_text: input.value.trim()}; document.getElementById(`nav_${qqId}`)?.classList.add('answered'); }
    else { delete currentAnswers[qqId]; document.getElementById(`nav_${qqId}`)?.classList.remove('answered'); }
    updateProgress();
}

function updateProgress() {
    const answered = Object.keys(currentAnswers).length, total = quizQuestions.length;
    document.getElementById('answeredCount').textContent = answered;
    document.getElementById('progressFill').style.width = (total > 0 ? answered/total*100 : 0) + '%';
}

function startTimer() {
    function update() {
        const diff = endTimeTime - Date.now();
        if (diff <= 0) { clearInterval(timerInterval); document.getElementById('timerDisplay').textContent = "00:00"; showGlobalAlert('Hết giờ! Tự động nộp bài.','warning'); submitExam(true); return; }
        const m = Math.floor(diff/60000), s = Math.floor((diff%60000)/1000);
        const display = document.getElementById('timerDisplay');
        display.textContent = `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
        if (m < 2) { display.style.color = 'var(--color-danger)'; display.parentElement.style.background = 'var(--color-danger-light)'; display.parentElement.style.animation = 'subtlePulse 1s infinite'; }
    }
    update(); timerInterval = setInterval(update, 1000);
}

function promptSubmit() {
    const answered = Object.keys(currentAnswers).length, total = quizQuestions.length;
    document.getElementById('submitWarnText').innerHTML = answered < total ?
        `Bạn mới trả lời <strong>${answered}/${total}</strong> câu. Các câu chưa làm sẽ bị 0 điểm. Vẫn nộp?` :
        `Bạn đã trả lời tất cả ${total} câu. Xác nhận nộp bài?`;
    new bootstrap.Modal(document.getElementById('submitConfirmModal')).show();
}

async function submitExam(isAuto=false) {
    const modal = bootstrap.Modal.getInstance(document.getElementById('submitConfirmModal'));
    if (modal) modal.hide();
    const sBtn = document.getElementById('submitExamBtn');
    if (sBtn) { sBtn.disabled = true; sBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Đang nộp...'; }
    if (timerInterval) clearInterval(timerInterval);
    const answersArr = [];
    for (const [qqIdStr, ansData] of Object.entries(currentAnswers)) {
        const qqId = parseInt(qqIdStr), qq = quizQuestions.find(q => q.id === qqId);
        if (!qq) continue;
        const qType = qq.question.question_type || 'multiple_choice';
        if (qType === 'multiple_choice') answersArr.push({quiz_question_id: qqId, selected_option_id: ansData.selected_option_id});
        else if (qType === 'true_false' && ansData.true_false_answers) {
            for (const [optIdStr] of Object.entries(ansData.true_false_answers)) answersArr.push({quiz_question_id: qqId, selected_option_id: parseInt(optIdStr)});
        } else if (qType === 'short_answer') answersArr.push({quiz_question_id: qqId, answer_text: ansData.answer_text});
    }
    try {
        const res = await fetch(`/api/exams/attempt/${attemptId}/submit/`, {method:'POST',headers:authHeaders(),body:JSON.stringify({answers:answersArr})});
        const data = await res.json();
        if (res.ok) showResult(data);
        else { alert(data.detail||'Lỗi nộp bài.'); if(sBtn){sBtn.disabled=false;sBtn.innerHTML='<i class="bi bi-send-check me-1"></i>Nộp bài';} }
    } catch(e) { alert('Lỗi mạng.'); if(sBtn){sBtn.disabled=false;sBtn.innerHTML='<i class="bi bi-send-check me-1"></i>Nộp bài';} }
}

function showResult(data) {
    ['introState','quizState','loadingState'].forEach(function(id) { document.getElementById(id).style.display='none'; });
    document.getElementById('resultState').style.display = 'block';
    document.getElementById('finalScore').textContent = parseFloat(data.score).toFixed(1);

    // Compute stats
    if (data.questions && data.answers) {
        var totalQ = data.questions.length;
        var correctCount = 0;
        var incorrectCount = 0;
        var unansweredCount = 0;

        data.questions.forEach(function(qq) {
            var studentAns = data.answers.filter(function(a) { return a.quiz_question === qq.id; });
            if (studentAns.length === 0) {
                unansweredCount++;
            } else {
                var qType = qq.question ? qq.question.question_type : '';
                if (qType === 'true_false') {
                    var allCorrect = studentAns.every(function(a) { return a.is_correct; });
                    if (allCorrect) correctCount++;
                    else incorrectCount++;
                } else {
                    var ans = studentAns[0];
                    if (ans && ans.is_correct) correctCount++;
                    else incorrectCount++;
                }
            }
        });

        var statCorrectEl = document.getElementById('statCorrect');
        var statIncorrectEl = document.getElementById('statIncorrect');
        var statUnansweredEl = document.getElementById('statUnanswered');
        if (statCorrectEl) statCorrectEl.textContent = correctCount;
        if (statIncorrectEl) statIncorrectEl.textContent = incorrectCount;
        if (statUnansweredEl) statUnansweredEl.textContent = unansweredCount;

        renderReview(data.questions, data.answers);
        document.getElementById('reviewWrapper').style.display = 'block';
    }
}

function renderReview(questions, answers) {
    var container = document.getElementById('reviewContainer');
    questions.sort(function(a,b) { return a.order - b.order; });
    
    container.innerHTML = questions.map(function(qq, idx) {
        var q = qq.question;
        var qType = q.question_type;
        var studentAns = answers.filter(function(a) { return a.quiz_question === qq.id; });
        
        var reviewHtml = '';
        if (qType === 'multiple_choice') {
            var keys = ['A','B','C','D'];
            var selectedOptId = studentAns[0] ? studentAns[0].selected_option : null;
            var isSkipped = !selectedOptId;

            reviewHtml = q.options.map(function(opt, oi) {
                var isStudent = opt.id === selectedOptId;
                var isCorrect = opt.is_correct;
                var statusClass = '';
                var badge = '';
                if (isCorrect) {
                    statusClass = 'correct';
                    badge = '<span class="review-badge correct">Đáp án đúng</span>';
                } else if (isStudent && !isCorrect) {
                    statusClass = 'incorrect';
                    badge = '<span class="review-badge incorrect">Bạn chọn sai</span>';
                }
                var selClass = isStudent ? 'student-selected' : '';
                var optContent = QuestionRenderer.renderOption(opt, q.question_images);
                return '<div class="review-opt ' + statusClass + ' ' + selClass + '">'
                    + '<div class="quiz-option-key" style="width:24px;height:24px;font-size:0.75rem;">' + (keys[oi] || oi+1) + '</div>'
                    + '<div style="flex:1;">' + optContent + '</div>'
                    + badge
                    + '</div>';
            }).join('');
            
            if (isSkipped) {
                reviewHtml = '<div class="mb-2"><span class="text-muted small">(Bỏ trống)</span></div>' + reviewHtml;
            }

        } else if (qType === 'true_false') {
            var ctxHtml = q.context ? '<div class="small text-muted mb-2 fst-italic">Ngữ cảnh: ' + escapeHtml(q.context) + '</div>' : '';
            reviewHtml = ctxHtml + q.options.map(function(opt, i) {
                var ans = studentAns.find(function(a) { return a.selected_option === opt.id; });
                var isCorrect = ans ? ans.is_correct : false;
                var statusClass = ans ? (isCorrect ? 'correct' : 'incorrect') : '';
                var badge = '';
                if (ans) {
                    badge = isCorrect
                        ? '<i class="bi bi-check-circle-fill text-success"></i>'
                        : '<i class="bi bi-x-circle-fill text-danger"></i>';
                } else {
                    badge = '<span class="text-muted small">(Bỏ trống)</span>';
                }
                var correctLabel = opt.is_correct ? 'Đúng' : 'Sai';
                var optContent = QuestionRenderer.renderOption(opt, q.question_images);
                return '<div class="review-opt ' + statusClass + '" style="justify-content:space-between;">'
                    + '<div style="flex:1;">' + String.fromCharCode(97+i) + ') ' + optContent + '</div>'
                    + '<div class="d-flex align-items-center gap-2">'
                    + '<span class="small fw-bold">' + correctLabel + '</span>'
                    + badge
                    + '</div></div>';
            }).join('');

        } else if (qType === 'short_answer') {
            var ans = studentAns[0];
            var isCorrect = ans ? ans.is_correct : false;
            var bgClass = isCorrect ? 'bg-success-light text-success' : 'bg-danger-light text-danger';
            var ansText = ans ? escapeHtml(ans.answer_text) : '<span class="text-muted small">(Bỏ trống)</span>';
            var icon = isCorrect ? '<i class="bi bi-check-circle-fill"></i>' : '<i class="bi bi-x-circle-fill"></i>';
            var correctAns = escapeHtml(q.correct_answer_text || '');
            reviewHtml = '<div class="p-2 rounded ' + bgClass + '" style="border:1px solid;font-size:0.875rem;">'
                + '<div><strong>Bạn trả lời:</strong> ' + ansText + ' ' + icon + '</div>'
                + '<div class="mt-1"><strong>Đáp án đúng:</strong> ' + correctAns + '</div>'
                + '</div>';
        }

        var stemHtml = QuestionRenderer.renderStem(q);
        var explanationHtml = '';
        if (q.explanation) {
            explanationHtml = '<div class="mt-2 p-2 bg-light rounded small text-muted"><strong>Giải thích:</strong> ' + q.explanation + '</div>';
        }

        return '<div class="review-q-item">'
            + '<div class="d-flex align-items-center gap-2 mb-2">'
            + '<span class="badge bg-primary">Câu ' + (idx+1) + '</span>'
            + '<span class="small text-muted">' + qq.points + ' điểm</span>'
            + '</div>'
            + '<div class="mb-3" style="font-size:0.9rem;">' + stemHtml + '</div>'
            + '<div>' + reviewHtml + '</div>'
            + explanationHtml
            + '</div>';
    }).join('');
}

init();
