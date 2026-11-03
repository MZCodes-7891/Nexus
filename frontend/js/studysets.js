// Study sets, modelled on Quizlet: terms pulled from the user's own documents, then Flashcards, Learn, Test, and Match.
const answerKey = text => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
function editDistance(a, b) {
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
        const row = [i];
        for (let j = 1; j <= b.length; j++) row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        previous = row;
    }
    return previous[b.length];
}
// Small typos still count, as long as the word is long enough that a typo can't turn it into a different answer.
function typedAnswerMatches(typed, term) {
    const given = answerKey(typed);
    const wanted = answerKey(term);
    if (!given) return false;
    return editDistance(given, wanted) <= (wanted.length >= 8 ? 2 : wanted.length >= 5 ? 1 : 0);
}
function shuffleList(list) {
    const copy = [...list];
    for (let index = copy.length - 1; index > 0; index--) { const other = Math.floor(Math.random() * (index + 1)); [copy[index], copy[other]] = [copy[other], copy[index]]; }
    return copy;
}
const maskTerm = (text, term) => String(text).replace(new RegExp(`\\b${String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '____');
const proofOf = card => (card.quote ? h('div', { class: 'passage' }, h('div', { text: `“${card.quote}”` }), h('div', { class: 'muted small', text: `From ${[card.source, card.location].filter(Boolean).join(', ')}` })) : null);

let setProgressOff = null;
async function renderSetsTab(openId) {
    const panel = document.getElementById('study-tab-sets');
    const sets = await ipcRenderer.invoke('study:sets');
    const chosen = sets.find(set => set.id === openId);
    if (chosen) return renderSetView(chosen);
    const picker = await sourcePicker();
    const title = h('input', { class: 'field', type: 'text', placeholder: 'Set name, such as Biodiversity unit', 'aria-label': 'Set name' });
    const subject = subjectSelect();
    const count = h('select', { class: 'field', 'aria-label': 'Number of terms' }, [10, 20, 30, 50].map(value => h('option', { value, text: `Up to ${value} terms`, selected: value === 20 })));
    const instructions = instructionsBox('sets', 'Focus on chapter 3 vocabulary. Skip the dates.');
    const status = h('div', { class: 'muted small status-line', role: 'status' });
    const requestId = `set-${Date.now()}`;
    setProgressOff?.();
    setProgressOff = bridge.on('study:progress', data => { if (data.requestId === requestId) status.textContent = data.status; });
    const create = h('button', { type: 'button', class: 'action-btn-primary', text: 'Make study set' });
    create.addEventListener('click', busyButton(create, 'Reading your files…', async () => {
        if (!picker.count()) throw new Error('Tick at least one file first.');
        status.textContent = 'Reading your files…';
        try {
            const { set } = await call('study:set-create', { selection: picker.selection(), title: title.value, subject: subject.value, count: Number(count.value), instructions: instructions.input.value, requestId });
            pendingSelection = { documentIds: [], libraryIds: [] };
            toast(`Made a set of ${set.cards.length} terms from your files.`, 'ok');
            await renderSetView(set);
        } finally { status.textContent = ''; }
    }));
    const addFiles = h('button', { type: 'button', class: 'integration-button secondary', text: 'Add files from this computer' });
    addFiles.addEventListener('click', busyButton(addFiles, 'Adding…', async () => {
        const known = new Set((await ipcRenderer.invoke('school:library:list')).map(item => item.id));
        await addLocalFilesToStudyLibrary();
        const added = (await ipcRenderer.invoke('school:library:list')).filter(item => !known.has(item.id)).map(item => item.id);
        pendingSelection = { ...picker.selection(), libraryIds: [...picker.selection().libraryIds, ...added] };
        await renderSetsTab();
    }));
    const list = h('div', { class: 'doc-list' }, sets.length ? sets.map(set => {
        const known = set.cards.filter(card => card.known).length;
        return h('div', { class: 'doc-row' },
            h('div', { class: 'grow' },
                h('button', { type: 'button', class: 'link-like doc-title', text: set.title, onclick: () => renderSetView(set) }),
                h('div', { class: 'doc-meta', text: `${set.cards.length} terms · ${known} known · from ${set.sources.join(', ')}` })),
            h('button', { type: 'button', class: 'mini-button danger', text: 'Delete', onclick: async () => { if (await confirmModal('Delete set', `Delete “${set.title}”?`, 'Delete')) { await call('study:set-remove', set.id); renderSetsTab(); } } }));
    }) : emptyState('No study sets yet. Pick your files above to make the first one.'));
    panel.replaceChildren(
        h('section', { class: 'school-card study-form' },
            h('h4', { text: 'New study set' }),
            h('p', { class: 'muted small', text: 'Nexus pulls the key terms out of your files. Each one must trace back to a sentence in the file, and the rest are thrown out. Then study with Flashcards, Learn, Test, and Match.' }),
            h('div', { class: 'study-form-row' }, title, subject, count),
            picker.element,
            instructions.element,
            h('div', { class: 'row wrap' }, create, addFiles),
            status),
        h('h3', { class: 'section-title', text: 'Your sets' }),
        list);
}

async function renderSetView(initial) {
    const panel = document.getElementById('study-tab-sets');
    let set = initial;
    const reload = async () => { set = (await ipcRenderer.invoke('study:sets')).find(item => item.id === set.id) || set; drawHeader(); };
    const summary = h('div', { class: 'muted small' });
    const bar = h('i', {});
    const drawHeader = () => {
        const known = set.cards.filter(card => card.known).length;
        summary.textContent = `${set.cards.length} terms · ${known} known · from ${set.sources.join(', ')}`;
        bar.style.width = `${Math.round(known / Math.max(1, set.cards.length) * 100)}%`;
    };
    const area = h('div', { class: 'set-area' });
    const modes = { flashcards: 'Flashcards', learn: 'Learn', test: 'Test', match: 'Match' };
    const buttons = Object.entries(modes).map(([id, label]) => h('button', { type: 'button', class: 'integration-button secondary', text: label, dataset: { mode: id }, onclick: () => open(id) }));
    const open = id => {
        buttons.forEach(button => button.classList.toggle('active', button.dataset.mode === id));
        ({ flashcards: drawFlashcards, learn: drawLearn, test: drawTest, match: drawMatch })[id](set, area, reload);
    };
    panel.replaceChildren(
        h('button', { type: 'button', class: 'link-like', text: '← All study sets', onclick: () => renderSetsTab() }),
        h('h3', { class: 'section-title', text: set.title }),
        summary,
        h('div', { class: 'bar', role: 'img', 'aria-label': 'Terms known' }, bar),
        h('div', { class: 'set-modes' }, buttons),
        area);
    drawHeader();
    open('flashcards');
}

function drawFlashcards(set, area, reload) {
    let order = [...set.cards];
    let index = 0;
    const draw = () => {
        const card = order[index];
        const flip = h('div', { class: 'flashcard', role: 'button', tabindex: 0, 'aria-label': 'Flip card' },
            h('div', { class: 'flashcard-inner' },
                h('div', { class: 'flashcard-face set-face', text: card.term }),
                h('div', { class: 'flashcard-face back set-face' }, h('div', { text: card.definition }), card.quote ? h('div', { class: 'muted small set-proof', text: `“${card.quote}”${card.location ? ` (${card.location})` : ''}` }) : null)));
        const step = amount => { index = (index + amount + order.length) % order.length; draw(); };
        const mark = async known => { try { await call('study:set-mark', set.id, card.id, known); card.known = known; await reload(); step(1); } catch (error) { toast(error.message, 'error'); } };
        const toggle = () => flip.classList.toggle('flipped');
        flip.addEventListener('click', toggle);
        const wrap = h('div', { tabindex: -1, onkeydown: event => {
            if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); toggle(); }
            if (event.key === 'ArrowRight') step(1);
            if (event.key === 'ArrowLeft') step(-1);
        } },
            h('p', { class: 'muted small', style: 'text-align:center', text: `Card ${index + 1} of ${order.length}${card.known ? ' · known' : ''}` }),
            flip,
            h('div', { class: 'grade-row' },
                h('button', { type: 'button', class: 'integration-button secondary', text: '← Back', onclick: () => step(-1) }),
                h('button', { type: 'button', class: 'integration-button secondary', text: 'Still learning', onclick: () => mark(false) }),
                h('button', { type: 'button', class: 'action-btn-primary', text: 'Know it', onclick: () => mark(true) }),
                h('button', { type: 'button', class: 'integration-button secondary', text: 'Next →', onclick: () => step(1) }),
                h('button', { type: 'button', class: 'integration-button secondary', text: 'Shuffle', onclick: () => { order = shuffleList(order); index = 0; draw(); } })),
            h('p', { class: 'muted small', style: 'text-align:center', text: 'Space flips. Arrow keys move between cards.' }));
        area.replaceChildren(wrap, drawTermList(set, reload));
        flip.focus({ preventScroll: true });
    };
    draw();
}

function drawTermList(set, reload) {
    const rows = h('div', { class: 'doc-list' });
    const draw = () => rows.replaceChildren(...set.cards.map(card => {
        const row = h('div', { class: 'doc-row' },
            h('div', { class: 'grow' }, h('div', { class: 'doc-title', text: card.term }), h('div', { class: 'doc-meta set-definition', text: card.definition, title: card.quote ? `“${card.quote}” (${card.source})` : '' })),
            h('button', { type: 'button', class: 'mini-button', text: 'Edit', onclick: () => {
                const term = h('input', { class: 'field', type: 'text', value: card.term, 'aria-label': 'Term' });
                const definition = h('input', { class: 'field', type: 'text', value: card.definition, 'aria-label': 'Definition' });
                row.replaceChildren(h('div', { class: 'grow study-form-row' }, term, definition), h('button', { type: 'button', class: 'mini-button', text: 'Save', onclick: async () => { try { await call('study:set-edit-card', set.id, card.id, { term: term.value, definition: definition.value }); card.term = term.value.trim(); card.definition = definition.value.trim(); draw(); } catch (error) { toast(error.message, 'error'); } } }));
            } }),
            h('button', { type: 'button', class: 'mini-button danger', text: 'Delete', onclick: async () => { try { await call('study:set-remove-card', set.id, card.id); set.cards = set.cards.filter(item => item.id !== card.id); await reload(); draw(); } catch (error) { toast(error.message, 'error'); } } }));
        return row;
    }));
    draw();
    return h('div', {}, h('h3', { class: 'section-title', text: `Terms in this set (${set.cards.length})` }), rows);
}

// Learn asks each card until it sticks: multiple choice first, then typing it from memory. Misses come back soon.
function drawLearn(set, area, reload) {
    const cards = set.cards.map(card => ({ ...card }));
    let queue = shuffleList(cards.filter(card => !card.known));
    const progress = h('div', { class: 'muted small status-line', role: 'status' });
    const draw = () => {
        progress.textContent = `${cards.filter(card => card.known).length} of ${cards.length} learned`;
        if (!queue.length) {
            area.replaceChildren(progress, h('div', { class: 'empty' }, h('p', { text: 'You have learned every term in this set.' }), h('button', { type: 'button', class: 'integration-button secondary', text: 'Start over', onclick: async () => { await call('study:set-reset', set.id); await reload(); drawLearn(set, area, reload); } })));
            return;
        }
        const card = queue.shift();
        const box = h('div', { class: 'test-question' });
        const settle = async correct => {
            try {
                const updated = await call('study:set-answer', set.id, card.id, correct);
                Object.assign(card, updated);
                await reload();
                if (!updated.known) queue.splice(correct ? queue.length : Math.min(2, queue.length), 0, card);
                draw();
            } catch (error) { toast(error.message, 'error'); }
        };
        const judge = (correct, given) => {
            box.classList.add(correct ? 'result-ok' : 'result-bad');
            if (correct) { box.append(h('div', { class: 'practice-result', text: 'Correct.' })); setTimeout(() => settle(true), 650); return; }
            box.append(h('div', { class: 'practice-result', text: `Not quite. The answer is: ${card.term}.` }), proofOf(card), h('div', { class: 'row wrap' },
                h('button', { type: 'button', class: 'action-btn-primary', text: 'Continue', onclick: () => settle(false) }),
                given ? h('button', { type: 'button', class: 'integration-button secondary', text: 'I was right', onclick: () => settle(true) }) : null));
        };
        const prompt = h('div', { class: 'q', text: maskTerm(card.definition, card.term) });
        const others = shuffleList(cards.filter(item => item.id !== card.id && answerKey(item.term) !== answerKey(card.term))).slice(0, 3);
        if (!(card.streak >= 1) && others.length === 3) {
            const options = shuffleList([card, ...others]).map(option => h('button', { type: 'button', class: 'practice-choice set-option', text: option.term, onclick: event => {
                options.forEach(button => { button.disabled = true; });
                event.currentTarget.classList.add(option.id === card.id ? 'chosen-right' : 'chosen-wrong');
                judge(option.id === card.id);
            } }));
            box.append(h('div', { class: 'muted small', text: 'Choose the matching term' }), prompt, ...options);
        } else {
            const input = h('input', { type: 'text', 'aria-label': 'Type the term', autocomplete: 'off' });
            const check = h('button', { type: 'button', class: 'action-btn-primary', text: 'Check' });
            const submit = () => { if (!input.value.trim()) return; input.disabled = true; check.remove(); judge(typedAnswerMatches(input.value, card.term), input.value); };
            check.addEventListener('click', submit);
            input.addEventListener('keydown', event => { if (event.key === 'Enter') submit(); });
            box.append(h('div', { class: 'muted small', text: 'Type the term from memory' }), prompt, input, check);
            area.replaceChildren(progress, box);
            input.focus();
            return;
        }
        area.replaceChildren(progress, box);
    };
    draw();
}

function drawTest(set, area) {
    const total = set.cards.length;
    const sizes = [...new Set([10, 20, total].filter(value => value <= total))];
    const size = h('select', { class: 'field', 'aria-label': 'Number of questions' }, sizes.map(value => h('option', { value, text: value === total ? `All ${total} terms` : `${value} questions`, selected: value === Math.min(20, total) })));
    const holder = h('div', {});
    const status = h('div', { class: 'muted small status-line', role: 'status' });
    const hardSize = h('select', { class: 'field', 'aria-label': 'Number of hard questions' }, [5, 10, 15, 20].map(value => h('option', { value, text: `${value} questions`, selected: value === 10 })));
    const hard = h('button', { type: 'button', class: 'action-btn-primary', text: 'Build hard test' });
    hard.addEventListener('click', busyButton(hard, 'Writing questions…', async () => {
        status.textContent = 'Writing questions from your files, then throwing out any the AI can answer without them. This can take a few minutes.';
        try {
            const { test } = await call('study:set-hard-test', set.id, { count: Number(hardSize.value) });
            const short = Number(hardSize.value) - test.questions.length;
            status.textContent = [short > 0 ? `Made ${test.questions.length} of ${hardSize.value} questions. The AI could not prove the others from your files.` : '', test.easierCount ? `The AI could answer ${test.easierCount} of these without your file, so they may feel easier. They are still checked against it.` : ''].filter(Boolean).join(' ');
            renderTakeTest(test, holder);
        } catch (error) { status.textContent = ''; throw error; }
    }));
    const start = h('button', { type: 'button', class: 'integration-button secondary', text: 'Start term test' });
    start.addEventListener('click', busyButton(start, 'Building…', async () => {
        const { test } = await call('study:set-test', set.id, { count: Number(size.value) });
        status.textContent = '';
        renderTakeTest(test, holder);
    }));
    area.replaceChildren(
        h('section', { class: 'school-card study-form' },
            h('h4', { text: 'Hard test' }),
            h('p', { class: 'muted small', text: 'Questions only someone who read your files could answer. Each answer is checked against your file, and the AI tries each question without the file so it can replace the ones it gets right. After you submit, each answer shows the sentence and page to go back to.' }),
            h('div', { class: 'row wrap' }, hardSize, hard)),
        h('section', { class: 'school-card study-form' },
            h('h4', { text: 'Term test' }),
            h('p', { class: 'muted small', text: 'A quick check on the terms in this set: multiple choice, true/false, and fill-in-the-blank. It is good for memorizing, and instant because no AI is involved.' }),
            h('div', { class: 'row wrap' }, size, start)),
        status,
        holder);
}

// Match: clear the board of term and definition pairs as fast as possible.
function drawMatch(set, area, reload) {
    const round = shuffleList(set.cards).slice(0, 6);
    const clock = h('div', { class: 'set-clock', role: 'timer', text: '0.0s' });
    const board = h('div', { class: 'match-board' });
    const startedAt = Date.now();
    const seconds = () => Number(((Date.now() - startedAt) / 1000).toFixed(1));
    const ticking = setInterval(() => { if (!clock.isConnected) { clearInterval(ticking); return; } clock.textContent = `${seconds()}s`; }, 100);
    let selected = null;
    let left = round.length;
    const finish = async () => {
        clearInterval(ticking);
        const time = seconds();
        const result = await call('study:set-match-time', set.id, time);
        await reload();
        area.replaceChildren(h('div', { class: 'empty' }, h('p', { text: `Cleared in ${time} seconds.${result.best ? ' That is your best time.' : ` Your best is ${result.bestMatch} seconds.`}` }), h('button', { type: 'button', class: 'action-btn-primary', text: 'Play again', onclick: () => drawMatch(set, area, reload) })));
    };
    const tiles = shuffleList(round.flatMap(card => [{ card, text: card.term }, { card, text: maskTerm(card.definition, card.term) }])).map(({ card, text }) => {
        const tile = h('button', { type: 'button', class: 'match-tile', text, dataset: { pair: card.id } });
        tile.addEventListener('click', () => {
            if (selected === tile) { tile.classList.remove('picked'); selected = null; return; }
            if (!selected) { selected = tile; tile.classList.add('picked'); return; }
            const other = selected;
            selected = null;
            other.classList.remove('picked');
            if (other.dataset.pair === tile.dataset.pair) {
                [other, tile].forEach(item => { item.classList.add('cleared'); item.disabled = true; });
                left--;
                if (!left) finish().catch(error => toast(error.message, 'error'));
            } else {
                [other, tile].forEach(item => item.classList.add('missed'));
                setTimeout(() => [other, tile].forEach(item => item.classList.remove('missed')), 450);
            }
        });
        return tile;
    });
    board.replaceChildren(...tiles);
    area.replaceChildren(clock, board);
}
