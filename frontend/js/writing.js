// My writing: Nexus learns the person's voice from their own writing, then writes or polishes in it.
let styleTokenOff = null;
async function renderWritingTab() {
    const panel = document.getElementById('study-tab-writing');
    const data = await ipcRenderer.invoke('study:style-status');
    const status = h('div', { class: 'muted small status-line', role: 'status' });
    const say = (text, kind = '') => { status.textContent = text; status.dataset.kind = kind; };
    const redraw = () => renderWritingTab().catch(error => toast(error.message, 'error'));

    // Samples
    const pasteName = h('input', { class: 'field', type: 'text', placeholder: 'Name, such as "Science lab report"', 'aria-label': 'Sample name', maxlength: 80 });
    const pasteText = h('textarea', { class: 'field', rows: 6, placeholder: 'Paste something you wrote yourself: an essay, a paragraph answer, a story. The more natural, the better.', 'aria-label': 'Writing sample', style: 'width:100%' });
    const addPaste = h('button', { type: 'button', class: 'action-btn-primary', text: 'Add sample' });
    addPaste.addEventListener('click', busyButton(addPaste, 'Adding…', async () => { await call('study:style-add', { name: pasteName.value, text: pasteText.value }); toast('Sample added.', 'ok'); redraw(); }));
    const addFile = h('button', { type: 'button', class: 'mini-button', text: 'Add from a file' });
    addFile.addEventListener('click', busyButton(addFile, 'Reading…', async () => { const result = await ipcRenderer.invoke('study:style-pick'); if (result.added) toast(`Added ${result.added} sample${result.added === 1 ? '' : 's'}.`, 'ok'); if (result.message) toast(result.message, 'error'); if (result.added) redraw(); }));
    const samples = h('div', { class: 'doc-list' }, ...(data.samples.length ? data.samples.map(sample => h('div', { class: 'doc-row' }, h('div', { class: 'grow' }, h('div', { class: 'doc-title', text: sample.name }), h('div', { class: 'doc-meta', text: `${sample.words} words · added ${formatWhen(sample.addedAt)}` })), h('button', { type: 'button', class: 'mini-button danger', text: 'Remove', onclick: async () => { await call('study:style-remove', sample.id); redraw(); } }))) : [emptyState('No samples yet. Add two or three things you wrote yourself, about 300 words or more in total.')]));
    const totalWords = data.samples.reduce((sum, sample) => sum + sample.words, 0);

    // What Nexus learned
    const learn = h('button', { type: 'button', class: data.profile ? 'mini-button' : 'action-btn-primary', text: data.profile ? 'Learn again' : 'Learn my style', disabled: !data.samples.length });
    learn.addEventListener('click', busyButton(learn, 'Reading your writing…', async () => { await call('study:style-learn'); toast('Nexus learned your style.', 'ok'); redraw(); }));
    const profile = data.profile;
    const learned = profile ? h('div', { class: 'style-profile' },
        h('p', { text: profile.summary }),
        profile.traits.length ? h('ul', {}, ...profile.traits.map(trait => h('li', { text: trait }))) : null,
        h('p', { class: 'muted small', text: [profile.level ? `Level: ${profile.level}` : '', profile.stats ? `about ${profile.stats.averageSentence} words per sentence` : '', profile.mistakes.length ? `Fixes: ${profile.mistakes.join('; ')}` : ''].filter(Boolean).join(' · ') }))
        : h('p', { class: 'muted small', text: data.samples.length ? 'Press Learn my style once your samples are in. It takes about a minute.' : '' });

    // Writing
    const mode = selectBox([['write', 'Write something new'], ['polish', 'Polish my draft']], 'write', value => { draftBox.classList.toggle('hidden', value !== 'polish'); task.placeholder = value === 'polish' ? 'Anything to change? Such as: make the ending stronger (optional)' : 'What to write, with the details: the question or prompt, points to include, who it\'s for'; });
    const task = h('textarea', { class: 'field', rows: 3, placeholder: 'What to write, with the details: the question or prompt, points to include, who it\'s for', 'aria-label': 'What to write', style: 'width:100%' });
    const draft = h('textarea', { class: 'field', rows: 8, placeholder: 'Paste your draft here. Nexus keeps your ideas and words, and fixes the rest.', 'aria-label': 'Your draft', style: 'width:100%' });
    const draftBox = h('div', { class: 'hidden' }, draft);
    // The tone keeps their voice but changes how relaxed or formal it is.
    let savedTone = 'usual';
    try { savedTone = localStorage.getItem('nexus.writingTone') || 'usual'; } catch {}
    const tone = selectBox([['usual', 'My usual'], ['serious', 'Serious'], ['chill', 'Chill'], ['school', 'School'], ['formal', 'Formal']], savedTone, value => { try { localStorage.setItem('nexus.writingTone', value); } catch {} });
    tone.setAttribute('aria-label', 'Tone');
    const length = selectBox([['', 'Any length'], ['short', 'Short, about 200 words'], ['medium', 'Medium, about 400 words'], ['long', 'Long, about 850 words']], '', () => {});
    const output = h('div', { class: 'style-output hidden' });
    const writeButton = h('button', { type: 'button', class: 'action-btn-primary', text: 'Write it' });
    writeButton.addEventListener('click', busyButton(writeButton, 'Writing like you…', async () => {
        const polishing = mode.value === 'polish';
        if (polishing && !draft.value.trim()) throw new Error('Paste your draft first.');
        if (!polishing && !task.value.trim()) throw new Error('Say what to write first.');
        if (!data.samples.length && tone.value === 'usual') throw new Error('Add a writing sample first, or choose a tone such as School or Formal.');
        const requestId = `style-${Date.now()}`;
        const live = h('div', { class: 'style-text' });
        output.classList.remove('hidden');
        output.replaceChildren(live);
        styleTokenOff?.();
        let streamed = '';
        const listener = (_event, data) => { if (data.requestId !== requestId) return; streamed += data.text; live.textContent = streamed; };
        ipcRenderer.on('study:style-token', listener);
        styleTokenOff = () => ipcRenderer.removeListener('study:style-token', listener);
        try {
            const result = await call('study:style-write', { task: task.value, draft: polishing ? draft.value : '', length: length.value, tone: tone.value, requestId });
            live.textContent = result.text;
            if (!result.soundsLikeYou) output.append(h('p', { class: 'muted small', text: 'Add a sample of your writing above so this sounds like you.' }));
            if (result.usedNotes) output.append(h('p', { class: 'muted small', text: 'Facts came from your saved school notes on this topic.' }));
            const title = h('input', { class: 'field', type: 'text', placeholder: 'Document title', 'aria-label': 'Document title', value: task.value.split(/[.\n]/)[0].slice(0, 60) });
            output.append(h('div', { class: 'row wrap', style: 'margin-top:10px' },
                h('button', { type: 'button', class: 'mini-button', text: 'Copy', onclick: async () => { await navigator.clipboard.writeText(result.text).catch(() => {}); toast('Copied.', 'ok'); } }),
                title,
                h('button', { type: 'button', class: 'mini-button', text: 'Save as Word document', onclick: async () => { try { toast((await call('study:style-save', { title: title.value, text: result.text })).message, 'ok'); } catch (error) { toast(error.message, 'error'); } } }),
                h('button', { type: 'button', class: 'mini-button', text: 'Make a Google Doc', onclick: () => { go('chat'); const input = document.getElementById('chat-input'); input.value = `Make a Google Doc called "${title.value || 'My writing'}" with exactly this text, unchanged:\n\n${result.text}`; input.focus(); } })));
        } finally { styleTokenOff?.(); styleTokenOff = null; }
    }));

    panel.replaceChildren(
        h('section', { class: 'school-card' }, h('h3', { text: 'Your writing samples' }),
            h('p', { class: 'muted small', text: 'Nexus learns how you write from these: your words, how long your sentences are, how you explain things. Use writing that is really yours, not something already fixed up by AI. Samples stay on this computer.' }),
            samples, h('div', { class: 'study-form', style: 'margin-top:10px' }, pasteName, pasteText, h('div', { class: 'row wrap' }, addPaste, addFile, h('span', { class: 'muted small', text: totalWords ? `${totalWords} words so far${totalWords < 300 ? '; more helps' : ''}` : '' })))),
        h('section', { class: 'school-card' }, h('h3', { text: 'Your style' }), learned, h('div', { class: 'row' }, learn)),
        h('section', { class: 'school-card' }, h('h3', { text: 'Write like me' }),
            h('p', { class: 'muted small', text: 'Writes in your voice, with the spelling and grammar fixed. Pick a tone: Serious, Chill, School, or Formal changes how relaxed it is, but it still sounds like you. You can also ask in chat, such as "write my paragraph on invasive species in my style, school tone". It uses facts from your saved school notes when it finds some on the topic, but check the facts anyway, and your teacher\'s rules on AI help before handing anything in.' }),
            h('div', { class: 'study-form' }, h('div', { class: 'row wrap' }, mode, h('label', { class: 'muted small hub-inline' }, 'Tone', tone), length), task, draftBox, h('div', { class: 'row' }, writeButton)), output),
        status);
}
