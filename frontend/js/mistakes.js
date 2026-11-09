// Mistake notebook: every question missed in quizzes and mock tests, grouped by topic, until it is learned.
async function renderMistakesTab() {
    const panel = document.getElementById('study-tab-mistakes');
    const mistakes = await ipcRenderer.invoke('study:mistakes');
    const player = h('div');
    const practise = async keys => {
        try {
            const { quiz } = await call('study:mistakes-quiz', keys);
            playQuiz(quiz, { host: player });
        } catch (error) { toast(error.message, 'error'); }
    };
    if (!mistakes.length) {
        panel.replaceChildren(h('section', { class: 'school-card' }, h('h3', { text: 'Mistake notebook' }), emptyState('No mistakes to review. Every question you miss in a quiz or mock test shows up here until you have learned it.')), player);
        return;
    }
    const groups = new Map();
    for (const item of mistakes) { const key = item.topic; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item); }
    const entry = item => {
        const explain = h('div', { class: 'quiz-explain' });
        const row = h('div', { class: 'mistake' },
            h('p', { class: 'quiz-question', text: item.question }),
            h('div', { class: 'mistake-answers' },
                item.chosen ? h('div', { class: 'mistake-wrong', text: `You said ${item.chosen}) ${item.choices?.[item.chosen] || ''}` }) : h('div', { class: 'mistake-wrong', text: 'Not answered' }),
                h('div', { class: 'mistake-right', text: `Answer: ${item.answer}) ${item.choices?.[item.answer] || ''}` })),
            item.explanation ? h('p', { class: 'muted small', text: item.explanation }) : null,
            item.quote ? h('div', { class: 'passage' }, h('div', { text: `“${item.quote}”` }), h('div', { class: 'muted small', text: `From ${[item.source, item.location].filter(Boolean).join(', ')}` })) : null,
            explain,
            h('div', { class: 'row wrap' },
                h('button', { type: 'button', class: 'mini-button', text: 'Explain', onclick: event => explainQuestion(event.currentTarget, explain, { id: item.quizId }, item.index, item.chosen) }),
                h('button', { type: 'button', class: 'mini-button', text: '✓ Got it now', onclick: async () => { await call('study:mistake-learned', item.key); row.remove(); toast('Taken off the list.', 'ok'); } }),
                h('span', { class: 'muted small', text: `${item.quizTitle} · ${formatWhen(item.at)}` })));
        return row;
    };
    panel.replaceChildren(
        h('section', { class: 'school-card' }, h('h3', { text: `Mistake notebook: ${mistakes.length} to review` }),
            h('p', { class: 'muted small', text: 'Questions you missed, grouped by topic, with the right answer and where it is in your notes. Mark one as learned when you have got it, or take them again as a quiz.' }),
            h('div', { class: 'row' }, h('button', { type: 'button', class: 'action-btn-primary', text: 'Quiz me on all of these', onclick: () => practise([]) }))),
        player,
        ...[...groups].map(([topic, items]) => h('details', { class: 'school-card mistake-group', open: groups.size <= 3 ? '' : null },
            h('summary', {}, h('b', { text: topic }), h('span', { class: 'muted small', text: ` · ${items.length} mistake${items.length === 1 ? '' : 's'}` })),
            h('div', { class: 'row' }, h('button', { type: 'button', class: 'mini-button', text: 'Quiz me on this topic', onclick: () => practise(items.map(item => item.key)) })),
            ...items.map(entry))));
}
