// Quizzes, NotebookLM style: choose material, difficulty, length, and a focus; questions arrive one by one as they are
// written; each has a hint, a short explanation once answered, and an Explain button that cites the notes; the end shows
// what you know and what to study next.
let quizTokenOff = null;
let lastQuizSetup = null;

async function renderQuizzesTab() {
    const panel = document.getElementById('study-tab-quizzes');
    const picker = await sourcePicker();
    let found = null;
    const segmented = (options, value, label) => {
        const box = h('div', { class: 'segmented quiz-choice', role: 'radiogroup', 'aria-label': label });
        box.value = value;
        for (const [id, text] of options) box.append(h('button', { type: 'button', class: `tab${id === value ? ' active' : ''}`, role: 'radio', 'aria-checked': String(id === value), dataset: { value: id }, text, onclick: () => { box.value = id; box.querySelectorAll('button').forEach(button => { const on = button.dataset.value === id; button.classList.toggle('active', on); button.setAttribute('aria-checked', String(on)); }); } }));
        return box;
    };
    const difficulty = segmented([['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']], 'medium', 'Difficulty');
    const size = segmented([['fewer', 'Fewer (5)'], ['standard', 'Standard (10)'], ['more', 'More (15)'], ['large', 'Large (25)'], ['huge', 'Big (40)']], 'standard', 'Number of questions');
    const speed = segmented([['best', 'Best questions'], ['fast', 'Fastest']], 'best', 'Speed');
    const diagrams = h('input', { type: 'checkbox', 'aria-label': 'Include diagrams' });
    const focus = h('input', { class: 'field', type: 'text', placeholder: 'What should the quiz focus on? Optional, such as: the differences between mitosis and meiosis', 'aria-label': 'Quiz focus', style: 'width:100%' });
    const topicBox = h('div', { class: 'topic-picker' });
    const topicStatus = h('div', { class: 'muted small status-line', role: 'status' });
    const findTopics = h('button', { type: 'button', class: 'mini-button', text: 'Pick topics from these files' });
    findTopics.addEventListener('click', busyButton(findTopics, 'Reading…', async () => {
        if (!picker.count()) throw new Error('Tick a document first.');
        found = await call('study:find-topics', picker.selection());
        topicStatus.textContent = `${found.topics.length} topics found. Tick the ones to be quizzed on.`;
        topicBox.replaceChildren(...found.topics.map(topic => h('label', { class: 'topic-row', title: topic.preview }, h('input', { type: 'checkbox', dataset: { topic: topic.id } }), h('span', { text: topic.title }))));
    }));
    // Listen: a spoken two-minute guide to the ticked topics, like an audio overview.
    const listenBox = h('div', { class: 'quiz-listen' });
    const listen = h('button', { type: 'button', class: 'mini-button', text: '🔊 Listen to a summary' });
    listen.addEventListener('click', busyButton(listen, 'Writing the summary…', async () => {
        const topicIds = found ? [...topicBox.querySelectorAll('input[data-topic]:checked')].map(input => input.dataset.topic) : [];
        if (!picker.count()) throw new Error('Tick a document first.');
        const result = await call('study:topic-audio', { selection: picker.selection(), ...(found && topicIds.length ? { topicToken: found.token, topicIds } : {}) });
        listenBox.replaceChildren(h('div', { class: 'row' }, h('b', { text: 'Playing your audio summary' }), h('button', { type: 'button', class: 'mini-button', text: '■ Stop', onclick: () => ipcRenderer.send('stop-speaking') }), h('button', { type: 'button', class: 'mini-button', text: '▶ Play again', onclick: () => ipcRenderer.send('speak-response', result.text) })), h('p', { class: 'muted small', text: result.text }));
    }));
    const make = h('button', { type: 'button', class: 'action-btn-primary', text: 'Make quiz' });
    make.addEventListener('click', () => {
        if (!picker.count()) { toast('Tick a document for the quiz first.', 'error'); return; }
        const topicIds = found ? [...topicBox.querySelectorAll('input[data-topic]:checked')].map(input => input.dataset.topic) : [];
        lastQuizSetup = { selection: picker.selection(), difficulty: difficulty.value, size: size.value, focus: focus.value.trim(), fast: speed.value === 'fast', diagrams: diagrams.checked, ...(found && topicIds.length ? { topicToken: found.token, topicIds } : {}) };
        startQuiz(lastQuizSetup);
    });
    const list = h('div', { class: 'doc-list' });
    const tests = (await ipcRenderer.invoke('study:tests')).filter(test => test.kind === 'quiz');
    list.replaceChildren(...(tests.length ? tests.map(test => h('div', { class: 'doc-row' }, h('div', { class: 'grow' }, h('button', { type: 'button', class: 'link-like doc-title', text: test.title, onclick: () => playQuiz(test, { done: true }) }), h('div', { class: 'doc-meta', text: [`${test.questions.length} questions`, test.difficulty, test.attempts?.[0] ? `last score ${test.attempts[0].score}/${test.attempts[0].total}` : 'not taken yet', formatWhen(test.createdAt)].filter(Boolean).join(' · ') })), h('button', { type: 'button', class: 'mini-button danger', text: 'Delete', onclick: async () => { await call('study:test-remove', test.id); renderQuizzesTab(); } }))) : [emptyState('No quizzes yet.')]));
    // Mock unit test: the whole unit, timed, with nothing revealed until it is handed in.
    const units = await ipcRenderer.invoke('study:units').catch(() => []);
    const mockUnit = h('select', { class: 'field', 'aria-label': 'Unit for the mock test' }, ...(units.length ? units.map(unit => h('option', { value: unit.name, text: `${unit.name.replace(/\.(pdf|docx?)$/i, '').replace(/^\d+--Print;\s*/i, '')} (${unit.topics} topics)` })) : [h('option', { value: '', text: 'Add a unit document in Documents first' })]));
    const mockCount = selectBox([['12', '12 questions'], ['24', '24 questions'], ['36', '36 questions']], '24', () => {});
    mockCount.setAttribute('aria-label', 'Number of questions');
    const mockMinutes = selectBox([['20', '20 minutes'], ['45', '45 minutes'], ['60', '60 minutes']], '45', () => {});
    mockMinutes.setAttribute('aria-label', 'Time limit');
    const mockStart = h('button', { type: 'button', class: 'action-btn-primary', text: 'Start mock test', disabled: !units.length });
    mockStart.addEventListener('click', () => startQuiz({ mock: true, unit: mockUnit.value, count: Number(mockCount.value), minutes: Number(mockMinutes.value), fast: speed.value === 'fast' }));
    panel.replaceChildren(
        h('section', { class: 'school-card quiz-setup' }, h('h3', { text: 'Mock unit test' }),
            h('p', { class: 'muted small', text: 'Like the real unit test: questions from every outcome, written to the curriculum, against the clock. You can change answers until you hand it in, then see your mark by outcome. Questions keep arriving while you start.' }),
            h('div', { class: 'row wrap' }, mockUnit, mockCount, mockMinutes, mockStart)),
        h('section', { class: 'school-card quiz-setup' }, h('h3', { text: 'Make a quiz' }),
            h('p', { class: 'muted small', text: 'Multiple choice from your own notes. Every answer is checked against a sentence in them, and the first questions show up while the rest are written.' }),
            picker.element,
            h('div', { class: 'row wrap' }, findTopics, listen), topicStatus, topicBox, listenBox,
            h('div', { class: 'quiz-settings' }, h('label', { class: 'muted small', text: 'Difficulty' }), difficulty, h('label', { class: 'muted small', text: 'Questions' }), size, h('label', { class: 'muted small', text: 'Speed' }), speed),
            h('label', { class: 'muted small hub-inline' }, diagrams, 'Include diagrams from the chosen topics (one PDF, with topics picked)'),
            h('p', { class: 'muted small', text: 'Fastest uses a smaller AI. It is about four times quicker, but its questions are plainer and now and then one is wrong.' }),
            focus, h('div', { class: 'row' }, make)),
        h('div', { id: 'quiz-player' }),
        h('h3', { class: 'section-title', text: 'Your quizzes' }), list);
}

// Starts writing a quiz and opens the player straight away; questions are added as they arrive.
async function startQuiz(setup) {
    const requestId = `quiz-${Date.now()}`;
    const quiz = { id: '', title: setup.mock ? 'Mock unit test' : 'New quiz', kind: setup.mock ? 'mock' : 'quiz', minutes: setup.minutes, questions: [], writing: true, total: setup.mock ? setup.count : ({ fewer: 5, standard: 10, more: 15, large: 25, huge: 40 }[setup.size] || 10), status: 'Writing the first question…' };
    const player = playQuiz(quiz, { requestId });
    quizTokenOff?.();
    const listener = (_event, data) => {
        if (data.requestId !== requestId) return;
        if (data.question) { quiz.questions.push(data.question); quiz.total = data.total; player.update(); }
        if (data.status) { quiz.status = data.status; player.update(); }
    };
    ipcRenderer.on('study:quiz-progress', listener);
    quizTokenOff = () => ipcRenderer.removeListener('study:quiz-progress', listener);
    try {
        const result = await call(setup.predict ? 'coach:predict-test' : setup.mock ? 'study:mock-make' : 'study:quiz-make', { requestId, ...setup });
        Object.assign(quiz, { id: result.quiz.id, title: result.quiz.title, questions: result.quiz.questions, total: result.quiz.questions.length, writing: false });
    } catch (error) {
        quiz.writing = false;
        quiz.total = quiz.questions.length;
        if (!quiz.questions.length) { player.fail(error.message); return; }
        toast(error.message, 'error');
    } finally { quizTokenOff?.(); quizTokenOff = null; player.update(); }
}

function playQuiz(quiz, { requestId = '', done = false, host: target = null } = {}) {
    const host = target || document.getElementById('quiz-player');
    const state = { index: 0, answers: [], hints: new Set(), finished: false, reveal: quiz.kind !== 'mock', startedAt: Date.now() };
    // A mock test is timed from when it opens, and hands itself in when time runs out.
    let clock = null;
    if (quiz.kind === 'mock' && quiz.minutes) {
        state.endsAt = Date.now() + quiz.minutes * 60000;
        clock = setInterval(() => {
            if (!card.isConnected) { clearInterval(clock); return; }
            const left = Math.max(0, state.endsAt - Date.now());
            const timer = card.querySelector('.quiz-timer');
            if (timer) timer.textContent = `⏱ ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
            if (!left && !state.reveal && !quiz.writing) { clearInterval(clock); toast('Time is up. Your test was handed in.', 'ok'); finish(); }
        }, 1000);
    }
    const card = h('section', { class: 'school-card quiz-player' });
    host.replaceChildren(card);
    card.scrollIntoView({ block: 'start', behavior: 'smooth' });

    function draw() {
        if (state.finished) return;
        const total = quiz.writing ? quiz.total : quiz.questions.length;
        const question = quiz.questions[state.index];
        const dots = h('div', { class: 'quiz-dots' }, ...Array.from({ length: total }, (_, index) => { const chosen = state.answers[index]; const ready = index < quiz.questions.length; return h('button', { type: 'button', class: `quiz-dot${index === state.index ? ' current' : ''}${chosen ? (!state.reveal ? ' answered' : chosen === quiz.questions[index].answer ? ' right' : ' wrong') : ''}${ready ? '' : ' waiting'}`, 'aria-label': `Question ${index + 1}`, disabled: !ready, onclick: () => { state.index = index; draw(); } }); }));
        const head = h('div', { class: 'row wrap quiz-head' }, h('h3', { text: quiz.title }), state.endsAt && !state.reveal ? h('b', { class: 'quiz-timer', text: '⏱' }) : null, quiz.writing ? h('span', { class: 'muted small', text: quiz.status }) : null, requestId && quiz.writing ? h('button', { type: 'button', class: 'mini-button', text: 'Stop writing', onclick: () => ipcRenderer.invoke('study:quiz-cancel', requestId) }) : null);
        if (!question) { card.replaceChildren(head, dots, h('div', { class: 'quiz-waiting muted', text: quiz.writing ? 'Writing the first question… it usually takes about 10 seconds.' : 'No questions.' })); return; }
        const picked = state.answers[state.index];
        // In exam mode an answer can be changed until the test is handed in, and nothing is marked before then.
        const chosen = state.reveal ? picked : '';
        const explanation = h('div', { class: 'quiz-explain' });
        const choices = h('div', { class: 'quiz-choices' }, ...Object.entries(question.choices).map(([letter, text]) => {
            const kind = !state.reveal ? (picked === letter ? ' picked' : '') : !chosen ? '' : letter === question.answer ? ' right' : letter === chosen ? ' wrong' : ' faded';
            return h('button', { type: 'button', class: `quiz-choice-button${kind}`, disabled: Boolean(chosen), onclick: () => { state.answers[state.index] = letter; if (!state.reveal && state.index + 1 < quiz.questions.length) state.index++; draw(); } }, h('b', { text: `${letter}` }), h('span', { text: text }));
        }));
        const hint = state.reveal && state.hints.has(state.index) && question.hint ? h('div', { class: 'quiz-hint', text: `Hint: ${question.hint}` }) : null;
        const feedback = chosen ? h('div', { class: `quiz-feedback ${chosen === question.answer ? 'right' : 'wrong'}` }, h('b', { text: chosen === question.answer ? 'Right!' : `Not quite. The answer is ${question.answer}.` }), h('p', { text: question.explanation }), question.quote ? h('div', { class: 'passage' }, h('div', { text: `“${question.quote}”` }), h('div', { class: 'muted small', text: `From ${[question.source, question.location].filter(Boolean).join(', ')}` })) : null) : null;
        const next = state.index + 1 < quiz.questions.length;
        const last = !quiz.writing && state.index === quiz.questions.length - 1;
        const answeredAll = !quiz.writing && quiz.questions.every((_, index) => state.answers[index]);
        const unanswered = quiz.questions.filter((_, index) => !state.answers[index]).length;
        card.replaceChildren(head, dots,
            h('div', { class: 'quiz-count muted small', text: `Question ${state.index + 1} of ${total}${question.topic ? ` · ${question.topic}` : ''}` }),
            question.image ? h('img', { class: 'quiz-diagram', src: `file:///${encodeURI(String(question.image).replace(/\\/g, '/'))}`, alt: 'Diagram for this question' }) : null,
            h('p', { class: 'quiz-question', text: question.question }), choices, hint, feedback, explanation,
            h('div', { class: 'row wrap quiz-nav' },
                h('button', { type: 'button', class: 'mini-button', text: '← Previous', disabled: state.index === 0, onclick: () => { state.index--; draw(); } }),
                state.reveal && !chosen && question.hint ? h('button', { type: 'button', class: 'mini-button', text: 'Hint', disabled: state.hints.has(state.index), onclick: () => { state.hints.add(state.index); draw(); } }) : null,
                chosen && quiz.id ? h('button', { type: 'button', class: 'mini-button', text: 'Explain', onclick: event => explainQuestion(event.currentTarget, explanation, quiz, state.index, chosen) }) : null,
                next ? h('button', { type: 'button', class: 'action-btn-primary', text: 'Next →', onclick: () => { state.index++; draw(); } }) : quiz.writing ? h('span', { class: 'muted small', text: 'Writing the next question…' }) : null,
                !state.reveal ? h('button', { type: 'button', class: 'action-btn-primary', text: quiz.writing ? 'Hand in (still writing questions…)' : unanswered ? `Hand in (${unanswered} unanswered)` : 'Hand in', disabled: quiz.writing, onclick: () => { if (!unanswered || confirm(`${unanswered} question${unanswered === 1 ? ' is' : 's are'} unanswered. Hand in anyway?`)) finish(); } })
                : last || answeredAll ? h('button', { type: 'button', class: 'action-btn-primary', text: 'See results', disabled: !answeredAll, title: answeredAll ? '' : 'Answer every question first', onclick: finish }) : null));
    }

    async function finish() {
        clearInterval(clock);
        state.finished = true;
        state.reveal = true;
        const result = await call('study:quiz-finish', { id: quiz.id, answers: quiz.questions.map((_, index) => state.answers[index] || ''), seconds: Math.min(4 * 3600, Math.round((Date.now() - state.startedAt) / 1000)) });
        card.replaceChildren(
            h('h3', { text: `${quiz.title}: ${result.score} of ${result.total}${quiz.kind === 'mock' ? ` (${Math.round((result.score / Math.max(1, result.total)) * 100)}%)` : ''}` }),
            quiz.kind === 'mock' && state.endsAt ? h('p', { class: 'muted small', text: `Handed in with ${Math.max(0, Math.round((state.endsAt - Date.now()) / 60000))} minutes left.` }) : null,
            h('div', { class: 'quiz-score-bar' }, h('div', { style: `width:${Math.round((result.score / Math.max(1, result.total)) * 100)}%` })),
            h('h4', { text: quiz.kind === 'mock' ? 'By outcome' : 'By topic' }),
            h('div', { class: 'quiz-topics' }, ...result.topics.map(item => h('div', { class: `quiz-topic ${item.right === item.total ? 'strong' : 'weak'}` }, h('span', { text: item.topic }), h('span', { text: `${item.right}/${item.total}` })))),
            h('p', { class: 'muted', text: result.weak.length ? `Study next: ${result.weak.join(', ')}. Review those answers, or make a new quiz aimed at them.` : 'You got every topic right. Try Hard difficulty next.' }),
            result.carded ? h('p', { class: 'muted small', text: `${result.carded} question${result.carded === 1 ? '' : 's'} you missed became flashcards. They come back for review in Study Center → Flashcards.` }) : null,
            h('div', { class: 'row wrap' },
                h('button', { type: 'button', class: 'mini-button', text: 'Review answers', onclick: () => { state.finished = false; state.index = 0; draw(); } }),
                h('button', { type: 'button', class: 'mini-button', text: 'Retake', onclick: () => playQuiz({ ...quiz }, {}) }),
                quiz.kind === 'mock' && result.weak.length ? h('button', { type: 'button', class: 'mini-button', text: 'Open the Mistake notebook', onclick: () => openStudyTab('mistakes') }) : null,
                result.weak.length && lastQuizSetup ? h('button', { type: 'button', class: 'action-btn-primary', text: 'New quiz on what I missed', onclick: () => startQuiz({ ...lastQuizSetup, focus: `the topics I got wrong: ${result.weak.join('; ')}`, size: 'fewer' }) }) : null));
        PAGE_HOOKS.studyChanged?.();
    }

    draw();
    if (done) quiz.writing = false;
    return { update: draw, fail: message => card.replaceChildren(h('p', { class: 'error-text', text: message })) };
}

// The longer explanation, written while you watch, citing where it is in the notes.
async function explainQuestion(button, box, quiz, index, chosen) {
    button.disabled = true;
    const requestId = `explain-${Date.now()}`;
    const text = h('div', { class: 'quiz-explain-text', text: 'Thinking…' });
    box.replaceChildren(text);
    let streamed = '';
    const listener = (_event, data) => { if (data.requestId === requestId) { streamed += data.text; text.textContent = streamed; } };
    ipcRenderer.on('study:quiz-explain-token', listener);
    try { const result = await call('study:quiz-explain', { quizId: quiz.id, index, chosen, requestId }); text.textContent = ''; renderFormattedMessage(text, result.text); }
    catch (error) { text.textContent = error.message; }
    finally { ipcRenderer.removeListener('study:quiz-explain-token', listener); }
}
