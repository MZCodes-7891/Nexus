// The Coach tab: Teacher Mode and the predicted test, predicted mark, exam countdown, grades, study time, the weekly
// plan, teach-back, rubric check, vocabulary, and the group quiz on Discord. Plus the home cards: what to do now,
// Kick a Ball, and focus music.
// replaceChildren would show a missing part as the word "null", so missing parts are left out.
const fill = (element, ...children) => element.replaceChildren(...children.filter(child => child !== null && child !== undefined && child !== false));
const coachCard = (title, ...children) => h('section', { class: 'school-card coach-card' }, h('h3', { text: title }), ...children);
const coachField = (label, control) => h('label', { class: 'coach-field' }, h('span', { class: 'muted small', text: label }), control);
const minutesText = minutes => (minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60 ? `${minutes % 60} min` : ''}`.trim() : `${minutes} min`);

let coachSection = 'overview';
async function renderCoachTab(section = coachSection) {
    coachSection = section;
    const panel = document.getElementById('study-tab-coach');
    panel.replaceChildren(h('p', { class: 'muted', text: 'Loading…' }));
    const need = { overview: ['mark', 'exams', 'plan'], teacher: ['teachers', 'units'], exams: ['mark', 'teachers', 'exams', 'units'], grades: ['grades', 'time'] }[section] || [];
    const load = { teachers: () => ipcRenderer.invoke('coach:teachers'), units: () => ipcRenderer.invoke('study:units').catch(() => []), mark: () => ipcRenderer.invoke('coach:predict-mark', {}), exams: () => ipcRenderer.invoke('coach:exams'), grades: () => ipcRenderer.invoke('coach:grades'), time: () => ipcRenderer.invoke('coach:time-stats'), plan: () => ipcRenderer.invoke('coach:weekly-plan', {}) };
    const data = Object.fromEntries(await Promise.all(need.map(async key => [key, await load[key]()])));
    if (section !== coachSection) return;
    const cards = {
        overview: () => [whatNowCard(), markCard(data.mark, []), examCard(data.exams, []), planCard(data.plan)],
        teacher: () => [teacherCard(data.teachers, data.units)],
        exams: () => [markCard(data.mark, data.teachers), examCard(data.exams, data.units)],
        guide: () => [assignmentGuideCard(), rubricCard()],
        explain: () => [teachBackCard(), vocabCard()],
        grades: () => [gradesCard(data.grades), timeCard(data.time)],
        group: () => [groupQuizCard()]
    }[section]();
    panel.replaceChildren(h('div', { class: 'coach-grid' + (cards.length === 1 ? ' single' : '') }, ...cards));
}

// ---------- Teacher Mode ----------
function teacherCard(teachers, units) {
    const courseNames = teachers.map(item => item.course);
    let current = courseNames[0] || '';
    const body = h('div');
    const draw = () => {
        const entry = teachers.find(item => item.course === current);
        const courseBox = h('input', { class: 'field', value: current, placeholder: 'Course, such as Science 9', 'aria-label': 'Course' });
        const kind = selectBox([['test', 'Tests'], ['quiz', 'Quizzes'], ['worksheet', 'Worksheets'], ['review', 'Review sheets']], 'test', () => {});
        const pick = courseNames.length > 1 ? selectBox(courseNames.map(name => [name, name]), current, value => { current = value; draw(); }) : null;
        const addFiles = h('button', { type: 'button', class: 'mini-button', text: '+ Add their files' });
        addFiles.addEventListener('click', busyButton(addFiles, 'Reading…', async () => {
            if (!courseBox.value.trim()) { toast('Type the course name first.', 'error'); return; }
            const result = await ipcRenderer.invoke('coach:teacher-add-files', { course: courseBox.value.trim(), kind: kind.value });
            if (result.cancelled) return;
            if (!result.ok) { toast(result.message, 'error'); return; }
            toast(`${result.message}${result.failed.length ? ` ${result.failed.length} couldn't be read.` : ''}`, 'ok');
            renderCoachTab();
        }));
        const learn = h('button', { type: 'button', class: 'action-btn-primary', text: entry?.profile ? 'Learn again' : 'Learn my teacher', disabled: !entry?.samples.length });
        learn.addEventListener('click', busyButton(learn, 'Studying their tests…', async () => { await call('coach:teacher-analyze', current); toast('NEXUS learned your teacher\'s style.', 'ok'); renderCoachTab(); }));
        const unitBox = selectBox(units.map(unit => [unit.name, unit.name.replace(/\.(pdf|docx?)$/i, '').replace(/^\d+--Print;\s*/i, '')]), units[0]?.name || '', () => {});
        const count = selectBox([['12', '12 questions'], ['20', '20 questions'], ['30', '30 questions']], '20', () => {});
        const predict = h('button', { type: 'button', class: 'action-btn-primary', text: 'Make my predicted test', disabled: !entry?.profile || !units.length });
        predict.addEventListener('click', () => { go('school'); openStudyTab('quizzes'); setTimeout(() => startQuiz({ mock: true, predict: true, course: current, unit: unitBox.value, count: Number(count.value), minutes: Math.round(Number(count.value) * 2.2) }), 300); });
        const compare = h('button', { type: 'button', class: 'mini-button', text: 'I got the real test back', disabled: !entry?.profile });
        compare.addEventListener('click', busyButton(compare, 'Comparing…', async () => {
            const result = await ipcRenderer.invoke('coach:teacher-compare', { course: current });
            if (result.cancelled) return;
            if (!result.ok) { toast(result.message, 'error'); return; }
            modal('How close was the prediction?', h('div', {},
                h('p', { text: result.accuracy === null ? 'NEXUS couldn\'t find outcome codes (like 2B) on that test, so it saved the test to learn from but couldn\'t score the prediction.' : `NEXUS predicted ${result.hits.length} of the ${result.actual.length} outcomes that were on the test (${result.accuracy}%).` }),
                result.actual.length ? h('p', { class: 'muted small', text: `On the test: ${result.actual.join(', ')}. Predicted: ${result.predicted.join(', ') || 'none'}.` }) : null,
                h('p', { class: 'muted small', text: 'NEXUS adjusted its weights, so the next prediction leans toward what your teacher really tested.' })));
            renderCoachTab();
        }));
        const profile = entry?.profile;
        const weights = profile ? Object.entries(profile.weights || {}).slice(0, 8) : [];
        const lastCheck = entry?.history?.at(-1);
        fill(body, 
            h('p', { class: 'muted small', text: 'Give NEXUS your teacher\'s old tests, quizzes, and worksheets. It learns how they write and mark tests, then makes a practice test in their style, weighted to what they test most. NEXUS also adds tests and quizzes it finds on D2L by itself.' }),
            h('div', { class: 'row wrap' }, pick, coachField('Course', courseBox), coachField('These are', kind), addFiles),
            entry ? h('p', { class: 'muted small', text: `${entry.samples.length} file${entry.samples.length === 1 ? '' : 's'} so far: ${entry.samples.slice(-4).map(sample => sample.name).join(', ')}${entry.samples.length > 4 ? '…' : ''}` }) : null,
            h('div', { class: 'row wrap' }, learn),
            profile ? h('div', { class: 'coach-profile' },
                h('p', { text: profile.summary }),
                weights.length ? h('div', { class: 'coach-bars' }, ...weights.map(([code, value]) => h('div', { class: 'coach-bar-row' }, h('span', { class: 'coach-code', text: code }), h('div', { class: 'coach-bar' }, h('div', { style: `width:${Math.min(100, value * 2.5)}%` })), h('span', { class: 'muted small', text: value >= 15 ? 'very likely' : value >= 7 ? 'likely' : 'sometimes' })))) : h('p', { class: 'muted small', text: 'No outcome codes (like 2B) were found in the files, so the test is spread evenly over the unit.' }),
                profile.habits?.length ? h('ul', { class: 'coach-list' }, ...profile.habits.map(item => h('li', { text: item }))) : null,
                profile.marking?.length ? h('p', { class: 'muted small', text: `Marks on: ${profile.marking.join('; ')}` }) : null,
                lastCheck?.accuracy !== null && lastCheck ? h('p', { class: 'muted small', text: `Last real test: NEXUS predicted ${lastCheck.accuracy}% of its outcomes.` }) : null) : null,
            profile ? h('div', { class: 'row wrap' }, coachField('Unit', unitBox), coachField('Length', count), predict, compare) : null);
    };
    draw();
    return coachCard('🎯 Teacher Mode', body);
}

// ---------- Predicted mark ----------
function markCard(mark, teachers) {
    const body = h('div');
    const draw = result => {
        if (!result.ok) { fill(body, emptyState(result.message)); return; }
        fill(body, 
            h('div', { class: 'coach-big' }, h('b', { text: `${result.mark}%` }), h('span', { class: 'muted small', text: `if the test was today, from ${result.basis}` })),
            result.raise?.length ? h('p', { text: `Raise it most by practising ${result.raise.map(row => `${row.code} (${row.accuracy}%)`).join(', ')}.` }) : null,
            result.rows?.length ? h('div', { class: 'coach-bars' }, ...result.rows.slice(0, 10).map(row => h('div', { class: 'coach-bar-row' }, h('span', { class: 'coach-code', text: row.code }), h('div', { class: `coach-bar${row.accuracy < 60 ? ' low' : row.accuracy >= 85 ? ' high' : ''}` }, h('div', { style: `width:${row.accuracy}%` })), h('span', { class: 'muted small', text: row.answers ? `${row.accuracy}%` : 'not practised' })))) : null);
    };
    draw(mark);
    const pick = teachers.length ? selectBox([['', 'All my quizzes'], ...teachers.map(item => [item.course, `Weighted for ${item.course}`])], '', async value => draw(await ipcRenderer.invoke('coach:predict-mark', { course: value }))) : null;
    return coachCard('📈 Predicted mark', pick, body);
}

// ---------- Exam countdown ----------
function examCard(exams, units) {
    const title = h('input', { class: 'field', placeholder: 'Unit B test', 'aria-label': 'Test name' });
    const date = h('input', { class: 'field', type: 'date', 'aria-label': 'Test date' });
    const outcomes = h('input', { class: 'field', placeholder: '1A, 1B, 2A… (optional)', 'aria-label': 'Outcomes on the test' });
    const add = h('button', { type: 'button', class: 'mini-button', text: 'Start countdown' });
    add.addEventListener('click', busyButton(add, 'Saving…', async () => {
        await call('coach:exam-add', { title: title.value.trim(), date: date.value ? `${date.value}T09:00` : '', outcomes: (outcomes.value.toUpperCase().match(/[1-9][A-D]/g) || []) });
        toast('Countdown started. NEXUS will tell you what to do each day.', 'ok'); renderCoachTab();
    }));
    return coachCard('⏳ Exam countdown',
        exams.length ? h('div', { class: 'doc-list' }, ...exams.map(item => h('div', { class: 'doc-row' },
            h('div', { class: 'grow' }, h('div', { class: 'doc-title', text: `${item.exam.title}: ${item.days === 0 ? 'today' : `in ${item.days} day${item.days === 1 ? '' : 's'}`}` }), h('div', { class: 'doc-meta', text: `Today: ${item.task}${item.mark !== null ? ` · predicted ${item.mark}%` : ''}` })),
            h('button', { type: 'button', class: 'mini-button', text: 'Go', onclick: () => { go('school'); openStudyTab(item.days <= 2 ? 'quizzes' : item.focus.length ? 'quizzes' : 'mistakes'); } }),
            h('button', { type: 'button', class: 'mini-button', text: 'Remove', onclick: async () => { await call('coach:exam-remove', item.exam.id); renderCoachTab(); } })))) : h('p', { class: 'muted small', text: 'Add a test date and NEXUS spaces out your studying until then: the weakest outcomes first, then a mock test two days before.' }),
        h('div', { class: 'row wrap' }, coachField('Test', title), coachField('Date', date), coachField('Outcomes', outcomes), add));
}

// ---------- Grades ----------
function gradesCard(courses) {
    const course = h('input', { class: 'field', placeholder: 'Science 9', 'aria-label': 'Course' });
    const what = h('input', { class: 'field', placeholder: 'Unit A quiz', 'aria-label': 'What it was' });
    const score = h('input', { class: 'field', type: 'number', step: 'any', placeholder: '18', style: 'width:80px', 'aria-label': 'Score' });
    const outOf = h('input', { class: 'field', type: 'number', step: 'any', placeholder: '20', style: 'width:80px', 'aria-label': 'Out of' });
    const add = h('button', { type: 'button', class: 'mini-button', text: 'Add mark' });
    add.addEventListener('click', busyButton(add, 'Saving…', async () => { await call('coach:grade-add', { course: course.value.trim(), title: what.value.trim(), score: score.value, outOf: outOf.value }); renderCoachTab(); }));
    const check = h('button', { type: 'button', class: 'mini-button', text: 'Check D2L now' });
    check.addEventListener('click', busyButton(check, 'Checking D2L in the background…', async () => {
        const result = await ipcRenderer.invoke('school:check-now');
        if (result.signInNeeded) toast('D2L needs you to sign in once. Open D2L from the D2L Practice tab.', 'error');
        else if (!result.ok) toast(result.message || 'D2L could not be checked.', 'error');
        else toast(`Checked D2L: ${result.newGrades.length} new mark${result.newGrades.length === 1 ? '' : 's'}${result.scanned ? `, ${result.scanned.pages} pages read, ${result.scanned.teacher} test${result.scanned.teacher === 1 ? '' : 's'} for Teacher Mode` : ''}.`, 'ok');
        renderCoachTab();
    }));
    return coachCard('🧾 Grades',
        courses.length ? h('div', { class: 'doc-list' }, ...courses.map(item => h('details', { class: 'doc-row coach-course' },
            h('summary', {}, h('b', { text: item.course }), h('span', { text: ` ${item.percent}%` }), item.trend !== null ? h('span', { class: item.trend >= 0 ? 'diag-ok' : 'error-text', text: ` ${item.trend >= 0 ? '▲' : '▼'} ${Math.abs(item.trend)}` }) : null, h('span', { class: 'muted small', text: ` · ${item.count} mark${item.count === 1 ? '' : 's'}` })),
            h('div', {}, ...item.items.slice(0, 12).map(grade => h('div', { class: 'line' }, h('span', { text: `${grade.title}: ${grade.score}/${grade.outOf} (${grade.percent}%)${grade.source === 'd2l' ? ' · D2L' : ''}` }), h('button', { type: 'button', class: 'link-like', text: 'remove', onclick: async () => { await call('coach:grade-remove', grade.id); renderCoachTab(); } }))))))) : h('p', { class: 'muted small', text: 'Marks from D2L come in by themselves when NEXUS checks it in the background. You can add others here.' }),
        h('div', { class: 'row wrap' }, coachField('Course', course), coachField('What', what), coachField('Mark', score), coachField('Out of', outOf), add, check));
}

// ---------- Study time ----------
function timeCard(stats) {
    const top = Math.max(30, ...stats.days.map(day => day.minutes));
    return coachCard('⏱ Study time',
        h('div', { class: 'coach-big' }, h('b', { text: minutesText(stats.weekMinutes) }), h('span', { class: 'muted small', text: `this week${stats.streak ? ` · ${stats.streak}-day streak` : ''}` })),
        h('div', { class: 'coach-week' }, ...stats.days.map(day => h('div', { class: 'coach-day', title: `${day.minutes} min` }, h('div', { class: 'coach-day-bar', style: `height:${Math.round(day.minutes / top * 100)}%` }), h('span', { class: 'muted small', text: new Date(`${day.day}T12:00`).toLocaleDateString([], { weekday: 'narrow' }) })))),
        Object.keys(stats.byKind).length ? h('p', { class: 'muted small', text: Object.entries(stats.byKind).map(([kind, minutes]) => `${kind}: ${minutesText(minutes)}`).join(' · ') }) : h('p', { class: 'muted small', text: 'Quizzes and focus sessions count here automatically.' }),
        stats.link.length ? h('div', {}, h('p', { class: 'muted small', text: 'Study time in the two weeks before each mark:' }), ...stats.link.map(item => h('div', { class: 'line' }, h('span', { text: item.title }), h('span', { class: 'when', text: `${minutesText(item.minutes)} → ${item.percent}%` })))) : null);
}

// ---------- Weekly plan ----------
function planCard(plan) {
    const again = h('button', { type: 'button', class: 'mini-button', text: 'Make a new plan' });
    again.addEventListener('click', busyButton(again, 'Planning…', async () => { await call('coach:weekly-plan', { make: true }); renderCoachTab(); }));
    return coachCard('🗓 This week',
        h('p', { class: 'muted small', text: 'Made every Sunday evening from your due dates, tests, and weak spots, and sent as a notification.' }),
        h('div', { class: 'coach-plan' }, ...plan.days.map(day => h('div', { class: 'coach-plan-day' }, h('b', { text: day.label }), h('ul', {}, ...day.items.map(item => h('li', { text: item })))))),
        again);
}

// ---------- Teach-back ----------
function teachBackCard() {
    const topic = h('input', { class: 'field', placeholder: 'Topic, such as 2B ecosystems', 'aria-label': 'Topic' });
    const text = h('textarea', { class: 'field', rows: 5, placeholder: 'Explain it in your own words, as if you were teaching a friend…', 'aria-label': 'Your explanation' });
    const result = h('div');
    const check = h('button', { type: 'button', class: 'action-btn-primary', text: 'Check my explanation' });
    check.addEventListener('click', busyButton(check, 'Reading your explanation…', async () => {
        const reply = await call('coach:teach-back', { topic: topic.value, explanation: text.value });
        coachLog('teach-back', topic.value);
        fill(result, h('div', { class: 'coach-big' }, h('b', { text: `${reply.score}/10` }), h('span', { class: 'muted small', text: 'understanding' })),
            reply.good?.length ? h('p', { class: 'diag-ok', text: `✓ ${reply.good.join(' ✓ ')}` }) : null,
            reply.missing?.length ? h('div', {}, h('b', { text: 'You left out' }), h('ul', { class: 'coach-list' }, ...reply.missing.map(item => h('li', { text: item })))) : null,
            reply.wrong?.length ? h('div', {}, h('b', { class: 'error-text', text: 'Fix these' }), h('ul', { class: 'coach-list' }, ...reply.wrong.map(item => h('li', { text: item })))) : null,
            reply.question ? h('p', { text: `Now try this: ${reply.question}` }) : null);
    }));
    return coachCard('🧑‍🏫 Teach-back', h('p', { class: 'muted small', text: 'The best way to know you understand something is to explain it. NEXUS checks your explanation against your notes.' }), topic, text, check, result);
}

// ---------- Assignment guide ----------
// A box filled from a file the person picks (PDF, Word, PowerPoint, text, or a photo).
function fileButton(box, label, what) {
    const button = h('button', { type: 'button', class: 'mini-button', text: label });
    button.addEventListener('click', busyButton(button, 'Reading…', async () => { const file = await ipcRenderer.invoke('coach:read-file', { title: what }); if (file.cancelled) return; if (!file.ok) { toast(file.message, 'error'); return; } box.value = file.text; toast(`Added ${file.name}.`, 'ok'); }));
    return button;
}
function assignmentGuideCard() {
    const task = h('input', { class: 'field', placeholder: 'The assignment, such as "Ecosystem lab report"', 'aria-label': 'Assignment' });
    const due = h('input', { class: 'field', type: 'date', 'aria-label': 'Due date' });
    const rubric = h('textarea', { class: 'field', rows: 3, placeholder: 'Add the rubric file, or paste it here…', 'aria-label': 'Assignment rubric' });
    const sheet = h('textarea', { class: 'field', rows: 2, placeholder: 'The assignment sheet (optional)…', 'aria-label': 'Assignment sheet' });
    const result = h('div');
    const go_ = h('button', { type: 'button', class: 'action-btn-primary', text: 'Tell me exactly what to do' });
    go_.addEventListener('click', busyButton(go_, 'Reading the rubric like your teacher would…', async () => {
        const guide = await call('coach:assignment-guide', { task: task.value.trim(), due: due.value, rubric: rubric.value, sheet: sheet.value });
        drawGuide(result, guide, rubric.value);
        result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    return coachCard('📋 Assignment guide',
        h('p', { class: 'muted small', text: 'Give NEXUS the rubric (and the assignment sheet if you have it). It tells you exactly what each part needs for top marks, the steps to get there with times, and what to check before you hand it in. The work itself stays yours.' }),
        h('div', { class: 'row wrap' }, coachField('Assignment', task), coachField('Due', due)),
        rubric, h('div', { class: 'row wrap' }, fileButton(rubric, '📎 Add rubric file', 'The rubric'), fileButton(sheet, '📎 Add assignment sheet', 'The assignment sheet')),
        sheet, go_, result);
}
function drawGuide(host, guide, rubricText) {
    const total = guide.steps.reduce((sum, step) => sum + step.minutes, 0);
    const toDay = h('button', { type: 'button', class: 'action-btn-primary', text: '📅 Put these steps in My Day' });
    toDay.addEventListener('click', busyButton(toDay, 'Planning…', async () => { const result = await call('coach:guide-to-day', { id: guide.id }); toast(`Added ${result.added} steps as tasks${guide.due ? ', finishing the day before the due date' : ''}. My Day fits them in.`, 'ok'); }));
    const checkDraft = h('button', { type: 'button', class: 'mini-button', text: 'Check my draft against this rubric', onclick: () => { const box = document.querySelector('textarea[aria-label="Rubric"]'); if (box) { box.value = rubricText; box.closest('.coach-card').scrollIntoView({ behavior: 'smooth' }); document.querySelector('textarea[aria-label="Your draft"]')?.focus(); } } });
    fill(host,
        h('div', { class: 'coach-profile' }, h('p', {}, h('b', { text: 'What you are making: ' }), guide.goal), guide.deliverable ? h('p', { class: 'muted small', text: `Hand in: ${guide.deliverable}` }) : null),
        h('h4', { text: 'For top marks' }),
        h('div', { class: 'doc-list' }, ...guide.criteria.map(item => h('div', { class: 'doc-row coach-criterion' }, h('div', { class: 'grow' },
            h('div', { class: 'doc-title', text: item.name }), h('div', { class: 'muted small', text: `Top level: ${item.topLevel || ''}` }),
            h('ul', { class: 'coach-list' }, ...(item.doThis || []).map(action => h('li', { text: action }))))))),
        h('h4', { text: `Steps (about ${minutesText(total)} in all)` }),
        h('ol', { class: 'coach-steps' }, ...guide.steps.map(step => h('li', {}, h('b', { text: step.title }), h('span', { class: 'muted small', text: ` · ${minutesText(step.minutes)}` }), step.detail ? h('div', { class: 'small', text: step.detail }) : null))),
        guide.checklist?.length ? h('div', {}, h('h4', { text: 'Before you hand it in' }), ...guide.checklist.map(item => h('label', { class: 'row small' }, h('input', { type: 'checkbox' }), item))) : null,
        guide.mistakes?.length ? h('div', {}, h('h4', { text: 'Where students lose marks' }), h('ul', { class: 'coach-list' }, ...guide.mistakes.map(item => h('li', { text: item })))) : null,
        h('div', { class: 'row wrap' }, toDay, checkDraft));
}

// ---------- Rubric check ----------
function rubricCard() {
    const task = h('input', { class: 'field', placeholder: 'The assignment, in a few words', 'aria-label': 'Assignment' });
    const rubric = h('textarea', { class: 'field', rows: 4, placeholder: 'Paste the rubric here…', 'aria-label': 'Rubric' });
    const draft = h('textarea', { class: 'field', rows: 5, placeholder: 'Paste your draft here…', 'aria-label': 'Your draft' });
    const result = h('div');
    // A rubric or draft can come from a file: PDF, Word, PowerPoint, text, or a photo of a printed rubric.
    const fromFile = (box, label, what) => { const button = h('button', { type: 'button', class: 'mini-button', text: label }); button.addEventListener('click', busyButton(button, 'Reading…', async () => { const file = await ipcRenderer.invoke('coach:read-file', { title: what }); if (file.cancelled) return; if (!file.ok) { toast(file.message, 'error'); return; } box.value = file.text; toast(`Added ${file.name}.`, 'ok'); })); return button; };
    const check = h('button', { type: 'button', class: 'action-btn-primary', text: 'Check against the rubric' });
    check.addEventListener('click', busyButton(check, 'Marking it like your teacher would…', async () => {
        const reply = await call('coach:rubric', { task: task.value, rubric: rubric.value, draft: draft.value });
        fill(result, 
            reply.fixFirst ? h('p', {}, h('b', { text: 'Fix first: ' }), reply.fixFirst) : null,
            h('div', { class: 'doc-list' }, ...(reply.criteria || []).map(item => h('div', { class: 'doc-row' }, h('div', { class: 'grow' }, h('div', { class: 'doc-title', text: `${item.name}: ${item.level}` }), h('div', { class: 'doc-meta', text: item.next }))))),
            reply.overall ? h('p', { class: 'muted small', text: reply.overall }) : null);
    }));
    return coachCard('✅ Rubric check', h('p', { class: 'muted small', text: 'Before you hand something in, see where it lands on the rubric and what\'s missing. NEXUS gives feedback only; the writing stays yours.' }), task, rubric, h('div', { class: 'row wrap' }, fromFile(rubric, '📎 Add rubric file', 'The rubric')), draft, h('div', { class: 'row wrap' }, fromFile(draft, '📎 Add my draft file', 'Your draft')), check, result);
}

// ---------- Vocabulary ----------
function vocabCard() {
    const topic = h('input', { class: 'field', placeholder: 'Topic or unit, such as biological diversity', 'aria-label': 'Topic' });
    const result = h('div');
    const make = h('button', { type: 'button', class: 'action-btn-primary', text: 'Find the key words' });
    make.addEventListener('click', busyButton(make, 'Reading your notes…', async () => {
        const reply = await call('coach:vocab', { topic: topic.value, subject: 'Science' });
        fill(result, h('p', { class: 'diag-ok', text: `${reply.terms.length} key words found; ${reply.added} new flashcard${reply.added === 1 ? '' : 's'} added.` }),
            h('div', { class: 'coach-vocab' }, ...reply.terms.map(item => h('div', { class: 'coach-term' }, h('b', { text: item.term }), h('span', { text: item.definition })))),
            h('button', { type: 'button', class: 'mini-button', text: 'Review them as flashcards', onclick: () => openStudyTab('flashcards') }));
    }));
    return coachCard('🔤 Vocabulary builder', h('p', { class: 'muted small', text: 'NEXUS pulls the key terms out of your notes and turns them into flashcards.' }), topic, make, result);
}

// ---------- Group quiz on Discord ----------
function groupQuizCard() {
    const body = h('div', {}, h('p', { class: 'muted small', text: 'Loading…' }));
    (async () => {
        const [tests, channels, board, status] = await Promise.all([ipcRenderer.invoke('study:tests'), ipcRenderer.invoke('hub:discord-text-channels'), ipcRenderer.invoke('hub:group-leaderboard'), ipcRenderer.invoke('hub:group-quiz-status')]);
        if (!channels.ok) { fill(body, emptyState('Set up the NEXUS Discord bot in the Hub first, then you can run quizzes with friends.')); return; }
        const quizzes = tests.filter(item => item.questions?.some(question => question.choices));
        const quiz = selectBox(quizzes.map(item => [item.id, item.title]), quizzes[0]?.id || '', () => {});
        const channel = selectBox(channels.channels.map(item => [item.id, item.name]), channels.channels[0]?.id || '', () => {});
        const seconds = selectBox([['20', '20 seconds'], ['30', '30 seconds'], ['45', '45 seconds']], '30', () => {});
        const start = h('button', { type: 'button', class: 'action-btn-primary', text: status.running ? `Running: question ${status.at}` : 'Start group quiz', disabled: status.running || !quizzes.length });
        start.addEventListener('click', busyButton(start, 'Starting…', async () => { await call('hub:group-quiz-start', { quizId: quiz.value, channelId: channel.value, seconds: Number(seconds.value), count: 10 }); toast('The quiz is live in Discord.', 'ok'); start.textContent = 'Running…'; start.disabled = true; }));
        const stop = status.running ? h('button', { type: 'button', class: 'mini-button', text: 'Stop', onclick: async () => { await call('hub:group-quiz-stop'); toast('It stops after this question.'); } }) : null;
        fill(body, 
            h('p', { class: 'muted small', text: 'The bot posts each question in the channel. Friends reply A, B, C, or D; the fastest right answer gets a bonus point.' }),
            h('div', { class: 'row wrap' }, coachField('Quiz', quiz), coachField('Channel', channel), coachField('Time', seconds), start, stop),
            board.players.length ? h('div', {}, h('b', { text: 'Leaderboard' }), ...board.players.slice(0, 8).map((player, place) => h('div', { class: 'line' }, h('span', { text: `${['🥇', '🥈', '🥉'][place] || `${place + 1}.`} ${player.name}` }), h('span', { class: 'when', text: `${player.points} pts · ${player.wins} win${player.wins === 1 ? '' : 's'}` })))) : null);
    })().catch(error => fill(body, emptyState(error.message)));
    return coachCard('🏆 Group quiz on Discord', body);
}

const coachLog = (kind, topic) => ipcRenderer.invoke('coach:log-time', { minutes: 5, kind, topic }).catch(() => {});

// ---------- Home cards ----------
function nowAction(action) {
    if (!action) return;
    if (action.kind === 'd2l-sign-in') { call('school:open').then(() => toast('Sign in to D2L in the window that opened. NEXUS checks it in the background after that.')).catch(error => toast(error.message, 'error')); return; }
    if (action.kind === 'section') { go(action.id); return; }
    if (action.kind === 'tasks') { go('tasks'); return; }
    go('school');
    openStudyTab({ mock: 'quizzes', quizzes: 'quizzes', mistakes: 'mistakes', flashcards: 'flashcards', assignments: 'assignments' }[action.kind] || 'coach');
}
function whatNowCard() {
    const list = h('div', {}, h('p', { class: 'muted small', text: 'Working out what matters most…' }));
    ipcRenderer.invoke('coach:now').then(items => {
        fill(list, ...(items.length ? items.map((item, index) => h('button', { type: 'button', class: `coach-now${index === 0 ? ' first' : ''}`, onclick: () => nowAction(item.action) }, h('b', { text: item.title }), h('span', { class: 'muted small', text: item.detail }))) : [emptyState('You\'re all caught up. A good time to get ahead, or take a break.')]));
    }).catch(error => fill(list, emptyState(error.message)));
    return h('section', { class: 'home-card coach-now-card' }, h('h3', { text: 'What to do right now' }), list);
}
function kickABallCard() {
    const body = h('div', {}, h('p', { class: 'muted small', text: 'Asking Roblox…' }));
    ipcRenderer.invoke('hub:kick-a-ball').then(data => {
        const change = value => (value ? ` (${value > 0 ? '+' : ''}${value.toLocaleString()})` : '');
        fill(body, 
            data.game ? h('div', { class: 'stat-grid coach-kab' },
                h('div', { class: 'stat' }, h('b', { text: data.game.playing.toLocaleString() }), h('span', { class: 'muted small', text: 'playing now' })),
                h('div', { class: 'stat' }, h('b', { text: data.game.visits.toLocaleString() }), h('span', { class: 'muted small', text: `visits${change(data.change?.visits)}` })),
                h('div', { class: 'stat' }, h('b', { text: data.game.favorites.toLocaleString() }), h('span', { class: 'muted small', text: `favorites${change(data.change?.favorites)}` })),
                h('div', { class: 'stat' }, h('b', { text: data.game.likes + data.game.dislikes ? `${Math.round(data.game.likes / (data.game.likes + data.game.dislikes) * 100)}%` : '–' }), h('span', { class: 'muted small', text: `liked (${data.game.likes} 👍)` }))) : h('p', { class: 'error-text small', text: data.error }),
            h('div', { class: 'line' }, h('span', { text: `Suggestions: ${data.suggestions.waiting} waiting, ${data.suggestions.done} done` }), h('button', { type: 'button', class: 'link-like', text: 'Open inbox', onclick: () => go('hub') })),
            data.game ? h('button', { type: 'button', class: 'link-like', text: 'Open the game page', onclick: () => ipcRenderer.invoke('open-external-url', data.game.url) }) : null);
    }).catch(error => fill(body, emptyState(error.message)));
    return h('section', { class: 'home-card' }, h('h3', { text: '⚽ Kick a Ball' }), body);
}
// Focus music: Spotify needs a Premium developer account to play through NEXUS, so these open on YouTube for now.
const FOCUS_MIXES = [['Lo-fi beats', 'lofi hip hop study mix'], ['Calm piano', 'calm piano study music 1 hour'], ['Rain sounds', 'rain sounds for studying 1 hour'], ['Brown noise', 'brown noise focus 1 hour'], ['Video game music', 'video game music for studying'], ['Classical', 'classical music for studying']];
function focusMusicCard() {
    const minutes = selectBox([['25', '25 min'], ['45', '45 min'], ['60', '60 min']], '25', () => {});
    const withFocus = h('input', { type: 'checkbox', checked: true });
    const play = query => {
        ipcRenderer.invoke('open-external-url', `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
        if (withFocus.checked) ipcRenderer.invoke('system:focus-start', { minutes: Number(minutes.value) }).then(() => toast(`Focus mode on for ${minutes.value} minutes.`, 'ok')).catch(() => {});
    };
    return h('section', { class: 'home-card' }, h('h3', { text: '🎧 Focus music' }),
        h('div', { class: 'coach-mixes' }, ...FOCUS_MIXES.map(([name, query]) => h('button', { type: 'button', class: 'mini-button', text: name, onclick: () => play(query) }))),
        h('label', { class: 'muted small hub-inline' }, withFocus, 'Also start focus mode for', minutes),
        h('p', { class: 'muted small', text: 'Opens on YouTube. Spotify will be used once your Spotify developer account has Premium.' }));
}
