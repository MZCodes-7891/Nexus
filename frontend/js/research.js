// Research: runs the real search-read-write pipeline and keeps every report with its sources.
function showResearchProject(project) {
    const content = h('div', {});
    renderFormattedMessage(content, project.report);
    const sourceLines = project.sources.map(source => `[${source.id}] ${source.title} ${source.url}`).join('\n');
    const safeTitle = project.question.replace(/"/g, '');
    document.getElementById('research-report').replaceChildren(
        h('h3', { text: project.question }),
        h('p', { class: 'muted small', text: `${formatWhen(project.createdAt)} · searched with ${project.engine}${project.note ? ` · ${project.note}` : ''}` }),
        content,
        h('h4', { text: 'Sources' }),
        h('ol', {}, project.sources.map(source => h('li', {}, h('button', { type: 'button', class: 'link-like', style: 'white-space:normal', text: source.title || source.url, title: source.url, dataset: { external: source.url } })))),
        project.failures?.length ? h('p', { class: 'muted small', text: `Could not read ${project.failures.length} other result(s), so they were not used.` }) : null,
        h('div', { class: 'row wrap' },
            h('button', { type: 'button', class: 'mini-button', text: 'Turn into a presentation', onclick: () => askNexus(`Create a presentation titled "${safeTitle}" from this research report. Use only these facts and put each slide's source in its source field.\n\nReport:\n${project.report.slice(0, 4000)}\n\nSources:\n${sourceLines}`) }),
            h('button', { type: 'button', class: 'mini-button', text: 'Turn into a Word document', onclick: () => askNexus(`Create a Word document titled "${safeTitle}" from this research report, keeping the citations and adding a sources section.\n\nReport:\n${project.report.slice(0, 4000)}\n\nSources:\n${sourceLines}`) }))
    );
}
async function refreshResearch() {
    const list = document.getElementById('research-history');
    const projects = await ipcRenderer.invoke('research:projects');
    if (!Array.isArray(projects)) return;
    list.replaceChildren(...(projects.length ? projects.map(project => h('div', { class: 'doc-row' }, h('div', { class: 'grow' }, h('button', { type: 'button', class: 'link-like doc-title', text: project.question, onclick: () => showResearchProject(project) }), h('div', { class: 'doc-meta', text: `${project.sources.length} sources · ${formatWhen(project.createdAt)}` })), h('button', { type: 'button', class: 'mini-button danger', text: 'Delete', onclick: async () => { await call('research:remove', project.id); refreshResearch(); } }))) : [emptyState('No saved research yet.')]));
}
function bindResearch() {
    const form = document.getElementById('research-form');
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const input = document.getElementById('research-question');
        const question = input.value.trim();
        if (!question) return;
        const button = form.querySelector('button');
        button.disabled = true;
        const requestId = `research-${Date.now()}`;
        let streamed = '';
        const report = document.getElementById('research-report');
        const offProgress = bridge.on('research:progress', data => { if (data.requestId === requestId) setLine('research-status', data.status); });
        const offToken = bridge.on('research:token', data => { if (data.requestId === requestId) { streamed += data.text; report.replaceChildren(); renderFormattedMessage(report, streamed); } });
        setLine('research-status', 'Starting…');
        try {
            const result = await call('research:run', { question, requestId });
            setLine('research-status', `Done. Read ${result.project.sources.length} sources.`, 'ok');
            input.value = '';
            showResearchProject(result.project);
            refreshResearch();
        } catch (error) { setLine('research-status', error.message, 'error'); }
        finally { offProgress(); offToken(); button.disabled = false; }
    });
    PAGE_HOOKS.research = refreshResearch;
}
