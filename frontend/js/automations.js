// Automation center: build workflows by describing them or by hand, then run, schedule, enable, and review them.
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Ready-made starting points. Each opens for review; nothing runs until it is saved.
const AUTOMATION_PRESETS = [
    { label: 'When I start studying', draft: { name: 'Start studying', trigger: { type: 'study_start' }, condition: 'none', steps: [{ tool: 'apps_open', args: { name: 'D2L' } }, { tool: 'apps_open', args: { name: 'Spotify' } }, { tool: 'nexus_open_page', args: { page: 'school' } }] } },
    { label: 'Weekday assignment reminder', draft: { name: 'Check my assignments', trigger: { type: 'schedule', time: '16:00', days: [1, 2, 3, 4, 5] }, condition: 'none', steps: [{ tool: 'notify_user', args: { title: 'Check your assignments', body: 'Take a look at what is due.' } }] } },
    { label: 'File downloaded PDFs', draft: { name: 'Offer to file downloaded PDFs', trigger: { type: 'file_download', extensions: ['pdf'] }, condition: 'none', steps: [{ tool: 'files_offer_filing', args: { file: '{{file}}', folder: 'School' } }] } },
    { label: 'Open Study Center at startup', draft: { name: 'Open my study dashboard', trigger: { type: 'app_start' }, condition: 'none', steps: [{ tool: 'nexus_open_page', args: { page: 'school' } }] } }
];
const TRIGGER_LABELS = { manual: 'Run by hand', schedule: 'On a schedule', app_start: 'When Nexus starts', study_start: 'When I start Study Mode', file_download: 'When a file is downloaded' };
function describeTrigger(trigger) {
    if (trigger.type === 'schedule') return `${trigger.time} on ${trigger.days.length === 7 ? 'every day' : trigger.days.map(day => DAY_NAMES[day]).join(', ')}`;
    if (trigger.type === 'file_download') return `When a .${(trigger.extensions || []).join(' or .')} file is downloaded`;
    return TRIGGER_LABELS[trigger.type] || trigger.type;
}
async function automationDialog(existing) {
    const tools = (await ipcRenderer.invoke('ai:tools')).filter(tool => !tool.agentOnly && tool.category !== 'agent');
    const draft = existing || { name: '', trigger: { type: 'manual' }, condition: 'none', steps: [{ prompt: '' }] };
    const name = h('input', { type: 'text', value: draft.name, maxlength: 80 });
    const type = h('select', {}, Object.entries(TRIGGER_LABELS).map(([value, text]) => h('option', { value, text, selected: draft.trigger.type === value })));
    const time = h('input', { type: 'time', value: draft.trigger.time ? draft.trigger.time.padStart(5, '0') : '16:00' });
    const dayBoxes = DAY_NAMES.map((day, index) => { const box = h('input', { type: 'checkbox', checked: (draft.trigger.days || [0, 1, 2, 3, 4, 5, 6]).includes(index), style: 'width:auto' }); return { box, label: h('label', { class: 'row', style: 'margin:0' }, box, h('span', { text: day })) }; });
    const extensions = h('input', { type: 'text', value: (draft.trigger.extensions || ['pdf']).join(', ') });
    const scheduleBox = h('div', {}, h('label', { text: 'Time' }), time, h('label', { text: 'Days' }), h('div', { class: 'row wrap' }, dayBoxes.map(item => item.label)));
    const downloadBox = h('div', {}, h('label', { text: 'File types' }), extensions);
    const syncTrigger = () => { scheduleBox.classList.toggle('hidden', type.value !== 'schedule'); downloadBox.classList.toggle('hidden', type.value !== 'file_download'); };
    type.addEventListener('change', syncTrigger); syncTrigger();
    const condition = h('select', {}, [['none', 'Always'], ['weekdays', 'Only on weekdays'], ['weekends', 'Only on weekends']].map(([value, text]) => h('option', { value, text, selected: draft.condition === value })));
    const existingBetween = (draft.conditions || []).find(item => item.type === 'time_between');
    const fromTime = h('input', { type: 'time', value: existingBetween?.from?.padStart(5, '0') || '', 'aria-label': 'From' });
    const toTime = h('input', { type: 'time', value: existingBetween?.to?.padStart(5, '0') || '', 'aria-label': 'To' });
    const nameContains = h('input', { type: 'text', maxlength: 80, value: (draft.conditions || []).find(item => item.type === 'file_name_contains')?.text || '', placeholder: 'Such as science' });
    const stepsBox = h('div', {});
    const stepRows = [];
    const addStep = step => {
        const kind = h('select', { 'aria-label': 'Step type' }, h('option', { value: '', text: 'Ask the AI' }), tools.map(tool => h('option', { value: tool.name, text: tool.title || tool.name, selected: step.tool === tool.name })));
        const text = h('textarea', { rows: 2, placeholder: 'What should the AI do?' }); text.value = step.prompt || (step.tool ? JSON.stringify(step.args || {}) : '');
        const syncStep = () => { text.placeholder = kind.value ? `Details as JSON, such as ${JSON.stringify(Object.fromEntries(Object.keys(tools.find(tool => tool.name === kind.value)?.parameters?.properties || {}).map(key => [key, '…'])))}` : 'What should the AI do?'; };
        kind.addEventListener('change', () => { if (kind.value && !text.value.trim().startsWith('{')) text.value = '{}'; syncStep(); }); syncStep();
        const row = h('div', { class: 'test-question' }, kind, text, h('button', { type: 'button', class: 'mini-button danger', text: 'Remove step', style: 'margin-top:6px', onclick: () => { row.remove(); stepRows.splice(stepRows.findIndex(item => item.row === row), 1); } }));
        stepRows.push({ row, kind, text }); stepsBox.append(row);
    };
    draft.steps.forEach(addStep);
    const body = h('div', {}, h('label', { text: 'Name' }), name, h('label', { text: 'Starts' }), type, scheduleBox, downloadBox, h('label', { text: 'Only run' }), condition, h('label', { text: 'And only between these times (optional)' }), h('div', { class: 'row' }, fromTime, toTime), h('label', { text: 'And only if the downloaded file name contains (optional)' }), nameContains, h('label', { text: 'Steps, in order' }), stepsBox, h('button', { type: 'button', class: 'mini-button', text: 'Add step', onclick: () => addStep({ prompt: '' }) }));
    modal(existing?.id ? 'Edit automation' : 'New automation', body, [{ label: 'Cancel' }, { label: 'Save', primary: true, run: async () => {
        const steps = stepRows.map(({ kind, text }) => {
            if (!kind.value) return { prompt: text.value };
            let args;
            try { args = JSON.parse(text.value || '{}'); } catch { throw new Error(`The details for ${kind.value} are not valid JSON.`); }
            return { tool: kind.value, args };
        });
        const conditions = [];
        if (fromTime.value && toTime.value) conditions.push({ type: 'time_between', from: fromTime.value, to: toTime.value });
        if (nameContains.value.trim()) conditions.push({ type: 'file_name_contains', text: nameContains.value.trim() });
        const payload = { name: name.value, condition: condition.value, conditions, steps, trigger: { type: type.value, time: time.value, days: dayBoxes.map((item, index) => (item.box.checked ? index : -1)).filter(day => day >= 0), extensions: extensions.value.split(',').map(item => item.trim()).filter(Boolean) } };
        if (existing?.id) await call('automations:update', existing.id, payload); else await call('automations:create', payload);
        setLine('automation-status', 'Saved.', 'ok');
        renderAutomations();
    } }]);
}
async function renderAutomations() {
    const items = await ipcRenderer.invoke('automations:list');
    if (!Array.isArray(items)) return;
    document.getElementById('automation-list').replaceChildren(...(items.length ? items.map(item => h('div', { class: 'doc-row' },
        h('input', { type: 'checkbox', checked: item.enabled, title: 'Enabled', 'aria-label': `Enable ${item.name}`, onchange: async event => { await call('automations:update', item.id, { enabled: event.target.checked }); renderAutomations(); } }),
        h('div', { class: 'grow' }, h('div', { class: 'doc-title', text: item.name }), h('div', { class: 'doc-meta', text: `${describeTrigger(item.trigger)} · ${item.steps.length} step${item.steps.length === 1 ? '' : 's'}${item.condition !== 'none' ? ` · ${item.condition} only` : ''}${item.lastRunAt ? ` · last run ${formatWhen(item.lastRunAt)}: ${item.lastStatus}` : ''}` })),
        h('button', { type: 'button', class: 'mini-button', text: 'Run', onclick: async event => { event.target.disabled = true; setLine('automation-status', `Running ${item.name}…`); const result = await ipcRenderer.invoke('automations:run', item.id); event.target.disabled = false; setLine('automation-status', result.message || result.error, result.ok ? 'ok' : 'error'); renderAutomations(); } }),
        h('button', { type: 'button', class: 'mini-button', text: 'Edit', onclick: () => automationDialog(item).catch(error => toast(error.message, 'error')) }),
        h('button', { type: 'button', class: 'mini-button danger', text: 'Delete', onclick: async () => { if (await confirmModal('Delete automation', `Delete "${item.name}"?`, 'Delete')) { await call('automations:remove', item.id); renderAutomations(); } } })
    )) : [emptyState('No automations yet. Describe one above.')]));
}
async function renderAutomationHistory() {
    const items = await ipcRenderer.invoke('automations:history');
    document.getElementById('auto-tab-history').replaceChildren(...(items?.length ? items.slice(0, 60).map(item => h('div', { class: 'doc-row' }, h('div', { class: 'grow' }, h('div', { class: 'doc-title', text: `${item.name}: ${item.status}` }), h('div', { class: 'doc-meta', text: `${item.reason} · ${item.results.map(result => `${result.ok ? 'OK' : 'failed'} ${result.step}${result.error ? ` (${result.error})` : ''}`).join(' → ')}` })), h('span', { class: 'when', text: formatWhen(item.at) }))) : [emptyState('No automation has run yet.')]));
}
async function renderAgentRuns() {
    const runs = await ipcRenderer.invoke('agent:runs');
    document.getElementById('auto-tab-runs').replaceChildren(...(runs?.length ? runs.slice(0, 60).map(run => h('div', { class: 'doc-row' }, h('div', { class: 'grow' }, h('div', { class: 'doc-title', text: run.goal }), h('div', { class: 'doc-meta', text: `${run.status}${run.error ? `: ${run.error}` : ''} · ${(run.actions || []).map(action => `${action.ok ? 'OK' : action.cancelled ? 'declined' : 'failed'} ${action.tool}`).join(', ') || 'no tools used'}` })), h('span', { class: 'when', text: formatWhen(run.startedAt) }))) : [emptyState('Tasks Nexus carries out in chat are recorded here.')]));
}
function bindAutomations() {
    const PANELS = { list: 'Automations', history: 'History', runs: 'Agent task history', modes: 'Computer modes' };
    const select = tabs('automation-tabs', Object.entries(PANELS), id => {
        for (const key of Object.keys(PANELS)) document.getElementById(`auto-tab-${key}`).classList.toggle('hidden', key !== id);
        if (id === 'history') renderAutomationHistory();
        if (id === 'runs') renderAgentRuns();
        if (id === 'modes') refreshDndModeState();
    });
    select('list');
    document.getElementById('automation-draft-form').after(h('div', { class: 'chip-row', style: 'margin-bottom:10px' }, AUTOMATION_PRESETS.map(preset => h('button', { type: 'button', class: 'chip', text: preset.label, onclick: () => automationDialog(preset.draft).catch(error => toast(error.message, 'error')) }))));
    document.getElementById('automation-new').addEventListener('click', () => automationDialog().catch(error => toast(error.message, 'error')));
    document.getElementById('automation-draft-form').addEventListener('submit', async event => {
        event.preventDefault();
        const input = document.getElementById('automation-draft');
        if (!input.value.trim()) return;
        setLine('automation-status', 'Drafting. Nothing runs until you save it.');
        try { const result = await call('automations:draft', input.value); setLine('automation-status', 'Check the draft, then save it.'); input.value = ''; await automationDialog(result.draft); }
        catch (error) { setLine('automation-status', error.message, 'error'); }
    });
    PAGE_HOOKS.automations = renderAutomations;
}
