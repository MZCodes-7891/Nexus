// Study Center: guides, spaced-repetition flashcards, mixed practice tests, one-at-a-time quiz, planner, and progress.
const SUBJECTS = ['English', 'Science', 'Social Studies', 'Math'];
let studyTabSelect = null;
let pendingSelection = { documentIds: [], libraryIds: [] };

function subjectSelect(value = 'Science') { return h('select', { class: 'field', 'aria-label': 'Class' }, SUBJECTS.map(name => h('option', { value: name, text: name, selected: name === value }))); }
// One source picker for every study tool: the study library plus the document library.
async function sourcePicker() {
    const [library, docs] = await Promise.all([ipcRenderer.invoke('school:library:list'), ipcRenderer.invoke('documents:list')]);
    const checks = [];
    const row = (kind, id, label, detail) => { const input = h('input', { type: 'checkbox', checked: (kind === 'doc' ? pendingSelection.documentIds : pendingSelection.libraryIds).includes(id), dataset: { kind, id } }); checks.push(input); return h('label', {}, input, h('span', { text: label }), h('span', { class: 'muted small', text: detail })); };
    const element = h('div', { class: 'source-picker' }, (library.length + docs.length) ? [...library.map(item => row('lib', item.id, item.title, item.subject ? ` · ${item.subject}` : '')), ...docs.map(doc => row('doc', doc.id, doc.name, doc.folder ? ` · ${doc.folder}` : ''))] : h('p', { class: 'muted small', text: 'Nothing to study yet. Add files in Documents, or add course content in the Library tab.' }));
    return { element, selection: () => ({ documentIds: checks.filter(item => item.checked && item.dataset.kind === 'doc').map(item => item.dataset.id), libraryIds: checks.filter(item => item.checked && item.dataset.kind === 'lib').map(item => item.dataset.id) }), count: () => checks.filter(item => item.checked).length };
}
function busyButton(button, label, work) {
    return async (...args) => {
        const original = button.textContent;
        button.disabled = true; button.textContent = label;
        try { await work(...args); }
        catch (error) { toast(error.message, 'error'); }
        finally { button.disabled = false; button.textContent = original; }
    };
}

let guideProgressOff = null;
async function renderGuidesTab(openId) {
    const panel = document.getElementById('study-tab-guides');
    const picker = await sourcePicker();
    const title = h('input', { class: 'field', type: 'text', placeholder: 'Guide title, such as Biodiversity unit', 'aria-label': 'Guide title' });
    const subject = subjectSelect();
    const status = h('div', { class: 'muted small status-line', role: 'status' });
    const create = h('button', { type: 'button', class: 'action-btn-primary', text: 'Generate study guide' });
    const requestId = `guide-${Date.now()}`;
    guideProgressOff?.();
    guideProgressOff = bridge.on('study:progress', data => { if (data.requestId === requestId) status.textContent = data.status; });
    const reader = h('article', { class: 'doc-preview' }, h('p', { class: 'muted', text: 'Choose a saved guide to read it.' }));
    const list = h('div', { class: 'doc-list' });
    const show = guide => {
        const content = h('div', {}); renderFormattedMessage(content, guide.content);
        reader.replaceChildren(h('h3', { text: guide.title }), h('p', { class: 'muted small', text: `From: ${guide.sources.join(', ') || 'selected sources'}${guide.truncated ? ' · The material was very long, so its end was not covered.' : ''}` }), h('div', { class: 'row' }, h('button', { type: 'button', class: 'mini-button', text: 'Save as file', onclick: async () => { try { const result = await call('study:guide-export', guide.id); if (!result.canceled) toast(`Saved ${result.path}`, 'ok'); } catch (error) { toast(error.message, 'error'); } } })), content);
    };
    const refresh = async selectId => {
        const guides = await ipcRenderer.invoke('study:guides');
        list.replaceChildren(...(guides.length ? guides.map(guide => h('div', { class: 'doc-row' }, h('div', { class: 'grow' }, h('button', { type: 'button', class: 'link-like doc-title', text: guide.title, onclick: () => show(guide) }), h('div', { class: 'doc-meta', text: `${guide.subject || ''} · ${formatWhen(guide.createdAt)}` })), h('button', { type: 'button', class: 'mini-button danger', text: 'Delete', onclick: async () => { if (await confirmModal('Delete guide', `Delete “${guide.title}”?`, 'Delete')) { await call('study:guide-remove', guide.id); refresh(); } } }))) : [emptyState('No study guides yet.')]));
        const chosen = guides.find(guide => guide.id === selectId);
        if (chosen) show(chosen);
    };
    create.addEventListener('click', busyButton(create, 'Writing…', async () => {
        if (!picker.count()) throw new Error('Tick at least one source first.');
        status.textContent = 'Reading your sources…';
        try {
            const result = await call('study:guide', { selection: picker.selection(), title: title.value, subject: subject.value, requestId });
            toast('Study guide saved.', 'ok'); refresh(result.guide.id);
        } finally { status.textContent = ''; }
    }));
    panel.replaceChildren(h('section', { class: 'school-card study-form' }, h('h4', { text: 'New study guide' }), h('div', { class: 'study-form-row' }, title, subject), picker.element, h('div', { class: 'row' }, create), status), h('div', { class: 'docs-layout' }, list, reader));
    await refresh(openId);
}

async function renderFlashcardsTab() {
    const panel = document.getElementById('study-tab-flashcards');
    const picker = await sourcePicker();
    const topic = h('input', { class: 'field', type: 'text', placeholder: 'Topic', 'aria-label': 'Topic' });
    const subject = subjectSelect();
    const count = h('input', { class: 'field', type: 'number', min: 1, max: 60, value: 20, 'aria-label': 'Number of cards' });
    const create = h('button', { type: 'button', class: 'action-btn-primary', text: 'Generate flashcards' });
    const reviewArea = h('div', {});
    const stats = h('div', { class: 'muted small status-line' });
    let queue = [];
    const drawCard = () => {
        if (!queue.length) { reviewArea.replaceChildren(emptyState('No cards are due right now.')); return; }
        const card = queue[0];
        const flip = h('div', { class: 'flashcard', role: 'button', tabindex: 0, 'aria-label': 'Flip card' }, h('div', { class: 'flashcard-inner' }, h('div', { class: 'flashcard-face', text: card.question }), h('div', { class: 'flashcard-face back', text: card.answer })));
        const toggle = () => flip.classList.toggle('flipped');
        flip.addEventListener('click', toggle);
        flip.addEventListener('keydown', event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); toggle(); } });
        const grade = (label, value) => h('button', { type: 'button', class: 'integration-button secondary', text: label, onclick: async () => { try { await call('study:card-review', card.id, value); queue.shift(); drawCard(); refreshStats(); } catch (error) { toast(error.message, 'error'); } } });
        reviewArea.replaceChildren(h('p', { class: 'muted small', style: 'text-align:center', text: `${card.topic} · ${card.difficulty} · ${queue.length} due` }), flip, h('div', { class: 'grade-row' }, grade('Again', 0), grade('Hard', 3), grade('Good', 4), grade('Easy', 5)), h('p', { class: 'muted small', style: 'text-align:center', text: 'Your answer sets when this card comes back.' }));
    };
    const refreshStats = async () => { const all = await ipcRenderer.invoke('study:cards'); const due = all.filter(card => card.due <= new Date().toISOString()).length; const learned = all.filter(card => card.interval >= 21).length; stats.textContent = `${all.length} cards · ${due} due · ${learned} well learned`; };
    const refresh = async () => { queue = await ipcRenderer.invoke('study:cards-due', {}); drawCard(); refreshStats(); };
    create.addEventListener('click', busyButton(create, 'Writing cards…', async () => {
        if (!picker.count()) throw new Error('Tick at least one source first.');
        const result = await call('study:flashcards-generate', { selection: picker.selection(), topic: topic.value, subject: subject.value, count: Number(count.value) });
        toast(`Created ${result.cards.length} cards.`, 'ok'); refresh();
    }));
    const manualQ = h('input', { class: 'field', type: 'text', placeholder: 'Question', 'aria-label': 'Question' });
    const manualA = h('input', { class: 'field', type: 'text', placeholder: 'Answer', 'aria-label': 'Answer' });
    const addManual = h('button', { type: 'button', class: 'integration-button secondary', text: 'Add card', onclick: async () => { try { await call('study:card-add', { question: manualQ.value, answer: manualA.value, topic: topic.value, subject: subject.value }); manualQ.value = ''; manualA.value = ''; refresh(); } catch (error) { toast(error.message, 'error'); } } });
    panel.replaceChildren(stats, reviewArea, h('details', { class: 'browser-details' }, h('summary', { text: 'Make new cards' }), h('div', { class: 'study-form', style: 'margin-top:10px' }, h('div', { class: 'study-form-row' }, topic, subject, count), picker.element, h('div', { class: 'row' }, create), h('div', { class: 'study-form-row' }, manualQ, manualA, addManual))));
    await refresh();
}

// Shared test-taking view, used by both practice-test sections.
function renderTakeTest(test, area, onDone) {
    const answers = {};
    const choice = (index, value, text, letter) => { const id = `t-${test.id}-${index}-${value}`; return h('label', { class: 'practice-choice', for: id }, h('input', { id, type: 'radio', name: `t-${test.id}-${index}`, value, onchange: () => { answers[index] = value; } }), letter ? h('span', { class: 'practice-choice-letter', text: letter }) : null, h('span', { class: 'practice-choice-text', text })); };
    const form = test.questions.map((question, index) => {
        let control;
        if (question.type === 'multiple_choice') control = h('div', {}, ['A', 'B', 'C', 'D'].map(letter => choice(index, letter, question.choices[letter], letter)));
        else if (question.type === 'true_false') control = h('div', {}, ['True', 'False'].map(value => choice(index, value, value)));
        else control = question.type === 'fill_blank' ? h('input', { type: 'text', 'aria-label': 'Your answer', oninput: event => { answers[index] = event.target.value; } }) : h('textarea', { rows: 3, 'aria-label': 'Your answer', oninput: event => { answers[index] = event.target.value; } });
        return h('div', { class: 'test-question', dataset: { index } }, h('div', { class: 'q', text: `${index + 1}. ${question.question}` }), h('div', { class: 'muted small', text: TYPE_LABELS[question.type] }), control);
    });
    const status = h('div', { class: 'muted small status-line', role: 'status' });
    const submit = h('button', { type: 'button', class: 'action-btn-primary', text: 'Submit test' });
    submit.addEventListener('click', busyButton(submit, 'Grading…', async () => {
        status.textContent = 'Written answers are graded by the AI, which can take a moment.';
        const attempt = await call('study:test-submit', test.id, answers);
        attempt.results.forEach((result, index) => {
            const box = form[index];
            const question = test.questions[index];
            box.classList.add(result.correct ? 'result-ok' : 'result-bad');
            box.append(h('div', { class: 'practice-result', text: `${result.correct ? 'Correct.' : `Not quite. Answer: ${result.key}.`} ${result.feedback || result.explanation || ''}` }));
            if (question.quote) box.append(h('div', { class: 'passage' }, h('div', { text: `“${question.quote}”` }), question.sourceUrl ? h('button', { type: 'button', class: 'link-like', text: `From D2L: ${question.source} ↗`, dataset: { external: question.sourceUrl } }) : h('div', { class: 'muted small', text: `Go back to: ${test.fromD2L ? 'D2L, ' : ''}${[question.source, question.location].filter(Boolean).join(', ')}` })));
            else if (question.source) box.append(h('div', { class: 'muted small', text: `Source: ${question.source}` }));
        });
        status.textContent = `Score: ${attempt.score} / ${attempt.total}${attempt.gradedCount < attempt.total ? ` (${attempt.total - attempt.gradedCount} could not be graded)` : ''}`;
        submit.remove();
        onDone?.();
    }));
    const meta = test.sources?.length ? h('p', { class: 'muted small', text: `Built only from ${test.fromD2L ? 'your D2L material' : 'your files'}: ${test.sources.join(', ')}. Each question comes with the sentence that proves its answer, shown after you submit.` }) : null;
    area.replaceChildren(h('h3', { class: 'section-title', text: test.title }), meta, ...form, submit, status);
}

async function renderAssignmentsTab() {
    const panel = document.getElementById('study-tab-assignments');
    const status = h('div', { class: 'muted small status-line', role: 'status' });
    const list = h('div', { class: 'doc-list' });
    const refresh = async () => {
        const items = (await ipcRenderer.invoke('study:planner')).filter(item => item.kind === 'assignment').sort((a, b) => String(a.when || '9').localeCompare(String(b.when || '9')));
        list.replaceChildren(...(items.length ? items.map(item => h('div', { class: 'doc-row' }, h('input', { type: 'checkbox', checked: item.done, 'aria-label': `Mark ${item.title} done`, onchange: async event => { await call('study:planner-update', item.id, { done: event.target.checked }); refresh(); } }), h('div', { class: 'grow' }, h('div', { class: `doc-title${item.done ? ' task-done' : ''}`, text: item.title }), h('div', { class: `doc-meta${item.when && !item.done && new Date(item.when) < new Date() ? ' task-overdue' : ''}`, text: [item.subject, item.when ? `Due ${formatWhen(item.when)}` : 'No due date'].filter(Boolean).join(' · ') })))) : [emptyState('No assignments yet. Sign in to D2L, then import them.')]));
    };
    const load = h('button', { type: 'button', class: 'action-btn-primary', text: 'Import from D2L' });
    load.addEventListener('click', busyButton(load, 'Reading D2L…', async () => {
        status.textContent = 'Reading each course…'; status.dataset.kind = '';
        const result = await ipcRenderer.invoke('school:import-assignments');
        status.textContent = result.message || result.error; status.dataset.kind = result.ok ? 'ok' : 'error';
        await refresh();
    }));
    const open = h('button', { type: 'button', class: 'integration-button secondary', text: 'Open D2L', onclick: async () => { const result = await ipcRenderer.invoke('school:open'); status.textContent = result.message; status.dataset.kind = result.ok ? '' : 'error'; } });
    panel.replaceChildren(h('section', { class: 'school-card study-form' }, h('p', { class: 'muted small', text: 'Assignments and due dates from your D2L courses, added to your planner and calendar. Importing again only adds new ones.' }), h('div', { class: 'row wrap' }, load, open), status), list);
    await refresh();
}

// D2L Practice: the quick path from course material to a test.
async function renderD2LPracticeTab() {
    const panel = document.getElementById('study-tab-d2l');
    const subject = subjectSelect(document.getElementById('d2l-subject-select')?.value || 'Science');
    const count = h('select', { class: 'field', 'aria-label': 'Number of questions' }, [5, 10, 15, 20].map(value => h('option', { value, text: `${value} questions`, selected: value === 10 })));
    const list = h('div', { class: 'source-picker' });
    const status = h('div', { class: 'muted small status-line', role: 'status' });
    const area = h('div', {});
    const courseFilter = h('select', { class: 'field', 'aria-label': 'Course' });
    let checks = [];
    const school = await ipcRenderer.invoke('school:status');
    const refresh = async () => {
        const allItems = await ipcRenderer.invoke('study:d2l-sources', subject.value);
        const chosenCourse = courseFilter.value;
        const courses = [...new Set(allItems.map(item => item.course).filter(Boolean))].sort();
        courseFilter.replaceChildren(h('option', { value: '', text: 'All courses' }), ...courses.map(name => h('option', { value: name, text: name })));
        courseFilter.value = courses.includes(chosenCourse) ? chosenCourse : '';
        courseFilter.classList.toggle('hidden', courses.length < 2);
        const items = allItems.filter(item => !courseFilter.value || item.course === courseFilter.value);
        const usable = items.filter(item => item.usable);
        checks = usable.map(item => ({ item, box: h('input', { type: 'checkbox', checked: true }) }));
        const titleOnly = items.length - usable.length;
        list.replaceChildren(...checks.map(({ item, box }) => h('label', {}, box, h('span', { text: item.title }), h('span', { class: 'muted small', text: `${item.truncated ? ' · long, partly used' : ''} · saved ${formatWhen(item.updatedAt)}` }))),
            ...(checks.length ? [] : [h('p', { class: 'muted small', text: `No ${subject.value} reading from D2L yet. Open D2L below, go to a course's Content page, then press "Save the course I'm viewing".` })]),
            ...(titleOnly ? [h('p', { class: 'muted small', text: `${titleOnly} saved item${titleOnly === 1 ? ' holds' : 's hold'} only a page title, with no reading text, so ${titleOnly === 1 ? 'it is' : 'they are'} left out. Saving the course again picks up its files.` })] : []));
        build.disabled = !checks.length;
    };
    const build = h('button', { type: 'button', class: 'action-btn-primary', text: 'Build practice test' });
    build.addEventListener('click', busyButton(build, 'Writing questions…', async () => {
        const ids = checks.filter(({ box }) => box.checked).map(({ item }) => item.id);
        if (!ids.length) throw new Error('Tick at least one D2L topic.');
        status.textContent = 'Writing questions from your D2L material, then checking each one against it. This can take a minute.';
        status.dataset.kind = '';
        try {
            const { test } = await call('study:d2l-test', { ids, subject: subject.value, count: Number(count.value), instructions: instructions.input.value });
            status.textContent = test.questions.length < Number(count.value) ? `Made ${test.questions.length} of ${count.value} questions. The AI could not prove the others from your D2L material, so they were left out.` : `Made ${test.questions.length} questions, each checked against your D2L material.`;
            renderTakeTest(test, area);
            area.scrollIntoView({ behavior: 'smooth' });
        } catch (error) { status.textContent = ''; throw error; }
    }));
    const instructions = instructionsBox('d2l');
    const save = h('button', { type: 'button', class: 'integration-button secondary', text: "Save the course I'm viewing" });
    save.addEventListener('click', busyButton(save, 'Reading course…', async () => {
        status.textContent = 'Reading the open D2L course and its files…';
        const result = await ipcRenderer.invoke('school:read-content', { subject: subject.value });
        status.textContent = result.message; status.dataset.kind = result.ok ? 'ok' : 'error';
        await refresh();
    }));
    const open = h('button', { type: 'button', class: 'integration-button secondary', text: 'Open D2L', onclick: async () => { const result = await ipcRenderer.invoke('school:open'); status.textContent = result.message; status.dataset.kind = result.ok ? '' : 'error'; } });
    subject.addEventListener('change', refresh);
    courseFilter.addEventListener('change', refresh);
    panel.replaceChildren(
        h('section', { class: 'school-card study-form' },
            h('h4', { text: 'Practice test from D2L' }),
            h('p', { class: 'muted small', text: 'Questions come only from what you saved from D2L. Files added from your computer and outside knowledge are not used.' }),
            school.configured ? null : h('p', { class: 'error-text small', text: 'Your D2L address is not set yet. Add it in the Library tab first.' }),
            h('div', { class: 'study-form-row' }, subject, courseFilter, count),
            h('label', { class: 'muted small', text: 'Topics and files to include' }),
            list,
            instructions.element,
            h('div', { class: 'row wrap' }, build, open, save),
            status),
        area);
    await refresh();
}

// The same instructions box on every test builder. The last text is remembered per class of test as a convenience.
function instructionsBox(key, placeholder = 'Focus on food webs. Make the questions harder. Include vocabulary. Use scenarios.') {
    let saved = '';
    try { saved = localStorage.getItem(`nexus.testInstructions.${key}`) || ''; } catch {}
    const input = h('textarea', { class: 'field', rows: 2, maxlength: 1000, placeholder, 'aria-label': 'Instructions for the test', style: 'width:100%', oninput: () => { try { localStorage.setItem(`nexus.testInstructions.${key}`, input.value); } catch {} } });
    input.value = saved;
    return { input, element: h('div', {}, h('label', { class: 'muted small', text: 'Your instructions (optional): what to focus on, how hard, what style' }), input) };
}

const TYPE_LABELS = { multiple_choice: 'Multiple choice', true_false: 'True/false', short_answer: 'Short answer', fill_blank: 'Fill in the blank', application: 'Application', scenario: 'Scenario' };
async function renderTestsTab() {
    const panel = document.getElementById('study-tab-tests');
    const picker = await sourcePicker();
    const title = h('input', { class: 'field', type: 'text', placeholder: 'Test title', 'aria-label': 'Test title' });
    const subject = subjectSelect();
    const counts = Object.fromEntries(Object.keys(TYPE_LABELS).map(type => [type, h('input', { class: 'field', type: 'number', min: 0, max: 20, value: { multiple_choice: 6, short_answer: 1, application: 2, scenario: 1 }[type] || 0, 'aria-label': TYPE_LABELS[type] })]));
    const create = h('button', { type: 'button', class: 'action-btn-primary', text: 'Generate test' });
    const instructions = instructionsBox('tests');
    const list = h('div', { class: 'doc-list' });
    const area = h('div', {});
    const takeTest = test => renderTakeTest(test, area, refresh);
    const refresh = async () => {
        const tests = await ipcRenderer.invoke('study:tests');
        list.replaceChildren(...(tests.length ? tests.map(test => h('div', { class: 'doc-row' }, h('div', { class: 'grow' }, h('button', { type: 'button', class: 'link-like doc-title', text: test.title, onclick: () => takeTest(test) }), h('div', { class: 'doc-meta', text: `${test.questions.length} questions${test.attempts?.[0] ? ` · last score ${test.attempts[0].score}/${test.attempts[0].total}` : ''}` })), h('button', { type: 'button', class: 'mini-button danger', text: 'Delete', onclick: async () => { await call('study:test-remove', test.id); refresh(); } }))) : [emptyState('No practice tests yet.')]));
    };
    create.addEventListener('click', busyButton(create, 'Writing test…', async () => {
        if (!picker.count()) throw new Error('Tick at least one source first.');
        const result = await call('study:test-generate', { selection: picker.selection(), title: title.value, subject: subject.value, instructions: instructions.input.value, counts: Object.fromEntries(Object.entries(counts).map(([type, input]) => [type, Number(input.value)])) });
        const asked = Object.values(counts).reduce((sum, input) => sum + Number(input.value), 0);
        toast(asked && result.test.questions.length < asked ? `Made ${result.test.questions.length} of ${asked} questions. The AI could not prove the others from your files, so they were left out.` : 'Practice test ready.', 'ok'); await refresh(); takeTest(result.test);
    }));
    panel.replaceChildren(h('details', { class: 'browser-details' }, h('summary', { text: 'New practice test' }), h('div', { class: 'study-form', style: 'margin-top:10px' }, h('div', { class: 'study-form-row' }, title, subject), h('div', { class: 'study-form-row' }, Object.entries(counts).map(([type, input]) => h('label', { class: 'muted small' }, TYPE_LABELS[type], input))), picker.element, instructions.element, h('div', { class: 'row' }, create))), h('h3', { class: 'section-title', text: 'Your tests' }), list, area);
    await refresh();
}

async function renderQuizTab(options = {}) {
    const panel = document.getElementById('study-tab-quiz');
    const picker = await sourcePicker();
    const topic = h('input', { class: 'field', type: 'text', value: options.topic || '', placeholder: 'Topic, such as biodiversity', 'aria-label': 'Quiz topic' });
    const subject = subjectSelect(SUBJECTS.includes(options.subject) ? options.subject : 'Science');
    const area = h('div', {});
    const score = h('div', { class: 'muted small status-line', role: 'status' });
    const history = [];
    const start = h('button', { type: 'button', class: 'action-btn-primary', text: 'Ask me a question' });
    const instructions = instructionsBox('quiz', 'Ask me only about food webs. Keep the questions short.');
    const showError = error => area.replaceChildren(h('p', { class: 'error-text', text: error.message }));
    const ask = async () => {
        area.replaceChildren(h('p', { class: 'muted', text: 'Thinking of a question…' }));
        const result = await call('study:quiz-next', { selection: picker.selection(), topic: topic.value, subject: subject.value, instructions: instructions.input.value, history: history.map(({ question, correct }) => ({ question, correct })) });
        const question = result.question;
        let answer = '';
        const control = question.type === 'multiple_choice'
            ? h('div', {}, ['A', 'B', 'C', 'D'].filter(letter => question.choices[letter]).map(letter => { const id = `q-${history.length}-${letter}`; return h('label', { class: 'practice-choice', for: id }, h('input', { id, type: 'radio', name: `q-${history.length}`, value: letter, onchange: () => { answer = letter; } }), h('span', { class: 'practice-choice-letter', text: letter }), h('span', { class: 'practice-choice-text', text: question.choices[letter] })); }))
            : h('textarea', { rows: 3, 'aria-label': 'Your answer', oninput: event => { answer = event.target.value; } });
        const submit = h('button', { type: 'button', class: 'action-btn-primary', text: 'Check my answer' });
        const box = h('div', { class: 'test-question' }, h('div', { class: 'q', text: question.question }), h('div', { class: 'muted small', text: `${question.topic} · ${question.difficulty}` }), control, submit);
        submit.addEventListener('click', busyButton(submit, 'Checking…', async () => {
            if (!String(answer).trim()) throw new Error('Answer first.');
            const graded = (await call('study:quiz-answer', question, answer)).result;
            history.push({ question: question.question, correct: graded.correct });
            box.classList.add(graded.correct ? 'result-ok' : 'result-bad');
            submit.remove();
            box.append(h('div', { class: 'practice-result', text: `${graded.correct ? 'Correct.' : `Not quite. Answer: ${graded.key}.`} ${graded.feedback || graded.explanation || ''}` }), question.quote ? h('div', { class: 'passage' }, h('div', { text: `“${question.quote}”` }), h('div', { class: 'muted small', text: `Go back to: ${[question.source, question.location].filter(Boolean).join(', ')}` })) : null, h('button', { type: 'button', class: 'action-btn-primary', text: 'Next question', onclick: () => ask().catch(showError) }));
            score.textContent = `${history.filter(item => item.correct).length} of ${history.length} correct this session.`;
        }));
        area.replaceChildren(box);
    };
    start.addEventListener('click', busyButton(start, 'Starting…', () => ask().catch(showError)));
    panel.replaceChildren(h('section', { class: 'school-card study-form' }, h('p', { class: 'muted small', text: 'Nexus asks one question at a time, explains mistakes, and adjusts difficulty. Tick sources, or just name a topic to use your saved material.' }), h('div', { class: 'study-form-row' }, topic, subject), picker.element, instructions.element, h('div', { class: 'row' }, start)), score, area);
    if (options.topic) start.click();
}

async function renderPlannerTab() {
    const panel = document.getElementById('study-tab-planner');
    const kind = h('select', { class: 'field', 'aria-label': 'Type' }, [['test', 'Test'], ['assignment', 'Assignment'], ['session', 'Study session'], ['goal', 'Goal']].map(([value, text]) => h('option', { value, text })));
    const title = h('input', { class: 'field', type: 'text', placeholder: 'Science unit test', 'aria-label': 'Title' });
    const when = h('input', { class: 'field', type: 'text', placeholder: 'Friday at 9 AM', 'aria-label': 'When' });
    const minutes = h('input', { class: 'field', type: 'number', min: 0, value: 45, 'aria-label': 'Minutes' });
    const subject = subjectSelect();
    const priorities = h('div', { class: 'doc-list' });
    const list = h('div', { class: 'doc-list' });
    const refresh = async () => {
        const [items, next] = await Promise.all([ipcRenderer.invoke('study:planner'), ipcRenderer.invoke('study:priorities')]);
        priorities.replaceChildren(...(next.length ? next.map(item => h('div', { class: 'doc-row' }, h('div', { class: 'grow', text: item.text }), h('span', { class: 'muted small', text: item.subject || '' }))) : [emptyState('Nothing urgent. Add a test or take a quiz, and suggestions appear here.')]));
        list.replaceChildren(...(items.length ? items.sort((a, b) => String(a.when || '9').localeCompare(String(b.when || '9'))).map(item => h('div', { class: 'doc-row' }, h('input', { type: 'checkbox', checked: item.done, 'aria-label': `Mark ${item.title} done`, onchange: async event => { await call('study:planner-update', item.id, { done: event.target.checked }); refresh(); } }), h('div', { class: 'grow' }, h('div', { class: `doc-title${item.done ? ' task-done' : ''}`, text: item.title }), h('div', { class: 'doc-meta', text: [item.kind, item.subject, item.when ? formatWhen(item.when) : '', item.minutes ? `${item.minutes} min` : ''].filter(Boolean).join(' · ') })), h('button', { type: 'button', class: 'mini-button danger', text: 'Delete', onclick: async () => { await call('study:planner-remove', item.id); refresh(); } }))) : [emptyState('Your plan is empty.')]));
    };
    const add = h('button', { type: 'button', class: 'action-btn-primary', text: 'Add to plan', onclick: async () => { try { await call('study:planner-add', { kind: kind.value, title: title.value, when: when.value, minutes: Number(minutes.value), subject: subject.value }); title.value = ''; when.value = ''; refresh(); toast('Added. Dated items also appear on the calendar.', 'ok'); } catch (error) { toast(error.message, 'error'); } } });
    panel.replaceChildren(h('section', { class: 'school-card study-form' }, h('div', { class: 'study-form-row' }, kind, title, when, minutes, subject), h('div', { class: 'row' }, add)), h('h3', { class: 'section-title', text: 'Study next' }), priorities, h('h3', { class: 'section-title', text: 'Plan' }), list);
    await refresh();
}

async function renderProgressTab() {
    const panel = document.getElementById('study-tab-progress');
    const data = await ipcRenderer.invoke('study:progress');
    const stat = (value, label) => h('div', { class: 'stat' }, h('b', { text: String(value) }), h('span', { class: 'muted small', text: label }));
    const topics = Object.entries(data.topics).sort((a, b) => b[1].total - a[1].total);
    panel.replaceChildren(
        h('div', { class: 'stat-grid' }, stat(data.answers, 'Answers recorded'), stat(data.accuracy === null ? 'None yet' : `${data.accuracy}%`, 'Overall accuracy'), stat(data.dueCards, `Cards due, of ${data.cards}`), stat(data.sessionsDone, 'Sessions completed'), stat(data.minutesStudied, 'Minutes studied')),
        h('h3', { class: 'section-title', text: 'Topics' }),
        topics.length ? h('div', { class: 'doc-list' }, topics.map(([name, entry]) => { const percent = Math.round(entry.correct / Math.max(1, entry.total) * 100); return h('div', { class: 'doc-row' }, h('div', { class: 'grow' }, h('div', { class: 'doc-title', text: name }), h('div', { class: 'bar', role: 'img', 'aria-label': `${percent} percent` }, h('i', { style: `width:${percent}%` }))), h('span', { class: 'muted small', text: `${entry.correct}/${entry.total}` })); })) : emptyState('Answer quiz questions, tests, or flashcards to see topics here.'),
        h('h3', { class: 'section-title', text: 'Recent learning activity' }),
        data.activity.length ? h('div', { class: 'doc-list' }, data.activity.slice(0, 15).map(item => h('div', { class: 'doc-row' }, h('div', { class: 'grow', text: item.detail }), h('span', { class: 'when', text: formatWhen(item.at) })))) : emptyState('No activity yet.')
    );
}

function openStudyTab(tab, options = {}) {
    if (options.documentIds) pendingSelection = { documentIds: options.documentIds, libraryIds: [] };
    studyTabSelect(tab, options);
}
function bindStudy() {
    const PANELS = { sets: 'Study sets', d2l: 'D2L Practice', assignments: 'Assignments', library: 'Library', guides: 'Study guides', flashcards: 'Flashcards', tests: 'Practice tests', quiz: 'Quiz', planner: 'Planner', progress: 'Progress' };
    let tabOptions = {};
    const select = tabs('study-tabs', Object.entries(PANELS), async id => {
        for (const key of Object.keys(PANELS)) document.getElementById(`study-tab-${key}`).classList.toggle('hidden', key !== id);
        const options = tabOptions; tabOptions = {};
        try {
            if (id === 'sets') await renderSetsTab(options.id);
            if (id === 'd2l') await renderD2LPracticeTab();
            if (id === 'assignments') await renderAssignmentsTab();
            if (id === 'guides') await renderGuidesTab(options.id);
            if (id === 'flashcards') await renderFlashcardsTab();
            if (id === 'tests') await renderTestsTab();
            if (id === 'quiz') await renderQuizTab(options);
            if (id === 'planner') await renderPlannerTab();
            if (id === 'progress') await renderProgressTab();
        } catch (error) { toast(error.message, 'error'); }
    });
    studyTabSelect = (id, options) => { tabOptions = options || {}; select(id); };
    select('library');
    PAGE_HOOKS.studyOpenDefault = () => select('sets');
    document.getElementById('d2l-list-courses').addEventListener('click', async () => {
        const box = document.getElementById('d2l-courses');
        box.replaceChildren(h('p', { class: 'muted small', text: 'Asking D2L…' }));
        const result = await ipcRenderer.invoke('school:courses');
        if (!result.ok) { box.replaceChildren(h('p', { class: 'error-text small', text: result.error || result.message })); return; }
        box.replaceChildren(...(result.courses.length ? result.courses.map(course => h('div', { class: 'doc-row' }, h('div', { class: 'grow' }, h('div', { class: 'doc-title', text: course.name }), h('div', { class: 'doc-meta', text: `${course.code || ''}${course.active ? '' : ' · inactive'}` })), h('button', { type: 'button', class: 'mini-button', text: 'Open content', onclick: async () => { const opened = await ipcRenderer.invoke('school:open-course', course.id); toast(opened.message, opened.ok ? 'ok' : 'error'); } }))) : [emptyState('D2L returned no courses.')]));
    });
}
