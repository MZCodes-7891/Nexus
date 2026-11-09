// First-run setup: gets the AI working with buttons only. It appears whenever the AI can't run and hasn't been dismissed.
function formatProgress(data) {
    if (!data.total) return data.status || data.phase || '';
    const percent = Math.floor(data.received / data.total * 100);
    return `${data.phase}: ${percent}% of ${formatSize(data.total)}`;
}
async function showSetup({ force = false } = {}) {
    const root = document.getElementById('setup-screen');
    const status = await ipcRenderer.invoke('setup:status');
    if (status.ok === false) { toast(status.message, 'error'); return; }
    if (status.provider !== 'ollama' || (!force && (status.setupDone || status.ready))) { root.classList.add('hidden'); return; }
    const name = h('input', { class: 'field', type: 'text', maxlength: 60, value: appSettings.general.userName, placeholder: 'Your name (optional)', 'aria-label': 'Your name' });
    const line = h('div', { class: 'muted small status-line', role: 'status' });
    const bar = h('i', { style: 'width:0%' });
    const barBox = h('div', { class: 'bar hidden', role: 'img', 'aria-label': 'Progress' }, bar);
    const stepsBox = h('div', { class: 'setup-steps' });
    const actions = h('div', { class: 'row wrap' });
    let busy = false;
    const off = bridge.on('setup:progress', data => {
        line.textContent = formatProgress(data); line.dataset.kind = '';
        if (data.total) { barBox.classList.remove('hidden'); bar.style.width = `${Math.floor(data.received / data.total * 100)}%`; }
    });
    const close = async () => { off(); await call('setup:finish', name.value); appSettings = (await ipcRenderer.invoke('settings:get')).settings; applyAppearance(appSettings); root.classList.add('hidden'); refreshTopbarStatus().catch(() => {}); PAGE_HOOKS.home?.(); };
    const run = async (channel, ...args) => {
        busy = true; draw(await ipcRenderer.invoke('setup:status'));
        try {
            const result = await call(channel, ...args);
            line.textContent = result.message || ''; line.dataset.kind = result.canceled ? '' : 'ok';
        } catch (error) { line.textContent = error.message; line.dataset.kind = 'error'; }
        busy = false; barBox.classList.add('hidden');
        await draw(await ipcRenderer.invoke('setup:status'));
    };
    const step = (done, title, detail) => h('div', { class: 'setup-step', dataset: { done: String(done) } }, h('span', { class: 'setup-mark', text: done ? '✓' : '' }), h('div', {}, h('strong', { text: title }), h('div', { class: 'muted small', text: detail })));
    const draw = async current => {
        const engineOk = current.serverRunning && !current.engineProblem;
        stepsBox.replaceChildren(
            step(engineOk, 'AI engine', engineOk ? 'Ollama is installed and running.' : current.engineProblem ? 'Ollama is damaged and needs reinstalling.' : 'Ollama runs AI privately on this computer. About a 1.6 GB download.'),
            step(current.ready, 'AI model', current.ready ? `${current.model} is ready.` : current.modelInstalled && !current.engineProblem ? current.message : `${current.recommendedModel}, ${current.recommendedSize || 'a few GB to download'}. It was picked to fit your graphics card.`)
        );
        const buttons = [];
        if (busy) buttons.push(h('button', { type: 'button', class: 'integration-button secondary', text: 'Cancel', onclick: () => call('setup:cancel') }));
        else if (!engineOk) buttons.push(h('button', { type: 'button', class: 'action-btn-primary', text: current.engineProblem || current.ollamaInstalled ? 'Repair the AI engine' : 'Install the AI engine', onclick: () => run('setup:install-ollama') }));
        else if (!current.ready) buttons.push(h('button', { type: 'button', class: 'action-btn-primary', text: 'Download the AI model', onclick: () => run('setup:pull-model', current.recommendedModel) }));
        else buttons.push(h('button', { type: 'button', class: 'action-btn-primary', text: 'Start using Nexus', onclick: close }));
        if (!busy && !current.ready) buttons.push(h('button', { type: 'button', class: 'integration-button secondary', text: 'Skip for now', title: 'Nexus opens, but the AI won\'t answer until this is done. You can return from Settings → AI.', onclick: close }));
        if (!busy && !current.ready) buttons.push(h('button', { type: 'button', class: 'integration-button secondary', text: 'Check again', onclick: async () => draw(await ipcRenderer.invoke('setup:status')) }));
        actions.replaceChildren(...buttons);
    };
    root.replaceChildren(h('div', { class: 'setup-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Set up NEXUS' }, h('div', { class: 'logo-icon' }), h('h2', { text: 'Welcome to NEXUS' }), h('p', { class: 'muted', text: 'Two downloads get the AI running on this computer. Nothing you ask it leaves your PC unless you connect an online app or use web search or voice.' }), name, stepsBox, barBox, line, actions));
    root.classList.remove('hidden');
    await draw(status);
}
