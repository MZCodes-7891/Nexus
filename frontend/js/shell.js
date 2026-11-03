// Sidebar, top bar, theme, status checks, notifications, and global search.
let appSettings = null;
const NAV_ITEMS = [['home', 'Home'], ['chat', 'AI Chat'], ['apps', 'My Apps'], ['docs', 'Documents'], ['school', 'Study Center'], ['research', 'Research'], ['tasks', 'Tasks'], ['calendar', 'Calendar'], ['automations', 'Automations'], ['composio-dash', 'Connected Apps'], ['hub', 'App Control'], ['memory', 'Memory'], ['settings', 'Settings']];

function navBtn(view) { return document.querySelector(`.nav-btn[data-view="${view}"]`); }
function go(view) { showView(view, navBtn(view)); try { localStorage.setItem('nexus.lastView', view); } catch {} }

function buildNavigation() {
    document.getElementById('nav-list').replaceChildren(...NAV_ITEMS.map(([view, label]) => h('button', { type: 'button', class: 'nav-btn', title: label, 'aria-label': label, dataset: { view, label }, onclick: () => go(view) }, icon(view), h('span', { text: label }))));
    const toggle = document.getElementById('sidebar-toggle');
    toggle.append(icon('chevron'));
    toggle.addEventListener('click', () => updateSettings({ appearance: { sidebarCollapsed: !document.body.classList.contains('sidebar-collapsed') } }));
    document.getElementById('notifications-button').prepend(icon('bell'));
    document.getElementById('settings-shortcut').append(icon('settings'));
    // Declarative navigation and external links, since the page's security policy forbids inline handlers.
    document.addEventListener('click', event => {
        const nav = event.target.closest('[data-nav]');
        if (nav) go(nav.dataset.nav);
        const external = event.target.closest('[data-external]');
        if (external) ipcRenderer.invoke('open-external-url', external.dataset.external);
    });
}

function applyAppearance(settings) {
    const root = document.documentElement;
    root.dataset.theme = settings.appearance.theme;
    root.dataset.animations = settings.appearance.animations ? 'on' : 'off';
    root.style.setProperty('--accent', settings.appearance.accent);
    root.style.setProperty('--font-size', `${settings.appearance.fontSize}px`);
    root.style.setProperty('--font-family', `'${settings.appearance.fontFamily.replace(/['"\\]/g, '')}',system-ui,sans-serif`);
    document.body.classList.toggle('sidebar-collapsed', settings.appearance.sidebarCollapsed);
    const toggle = document.getElementById('sidebar-toggle');
    toggle.title = settings.appearance.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
    toggle.setAttribute('aria-label', toggle.title);
    document.getElementById('profile-initial').textContent = (settings.general.userName || 'N')[0].toUpperCase();
    updateGreeting(settings);
    const spoken = document.getElementById('spoken-response-toggle');
    if (spoken) spoken.checked = settings.voice.spokenReplies;
    conversationMemoryEnabled = settings.privacy.memoryEnabled;
    setInterfaceLanguage(settings.general.language);
}
function updateGreeting(settings) {
    const hour = new Date().getHours();
    const greeting = `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}${settings.general.userName ? `, ${settings.general.userName}` : ''}`;
    document.getElementById('greeting').textContent = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    const home = document.getElementById('home-greeting');
    if (home) home.textContent = greeting;
}
async function updateSettings(changes) {
    const result = await call('settings:update', changes);
    appSettings = result.settings;
    applyAppearance(appSettings);
    return appSettings;
}

function setPill(id, state, text) {
    const pill = document.getElementById(id);
    pill.querySelector('.status-dot-new').dataset.state = state;
    pill.querySelector('span:last-child').textContent = text;
    pill.title = text;
}
let lastAiStatus = null;
// These show what the checks actually report. There is deliberately no fixed "online" label anywhere.
async function refreshTopbarStatus() {
    const ai = await ipcRenderer.invoke('ollama:test').catch(error => ({ ok: false, message: error.message }));
    lastAiStatus = ai;
    setPill('status-ai', ai.ready ? 'ok' : ai.ok && !ai.installed ? 'warn' : 'bad', ai.ready ? ai.model : ai.ok && !ai.installed ? 'Model missing' : ai.ok ? 'AI engine problem' : 'AI offline');
    document.getElementById('status-ai').title = ai.message || '';
    await refreshChatModelSelect(ai);
    const composio = await ipcRenderer.invoke('composio:status').catch(error => ({ verified: false, message: error.message }));
    if (!composio.verified) { setPill('status-apps', composio.configured ? 'bad' : 'warn', composio.configured ? 'Key problem' : 'No apps key'); document.getElementById('status-apps').title = composio.message; return; }
    const catalog = await ipcRenderer.invoke('composio:catalog');
    const active = (catalog.accounts || []).filter(account => account.status === 'ACTIVE').length;
    setPill('status-apps', catalog.ok ? 'ok' : 'bad', catalog.ok ? `${active} app${active === 1 ? '' : 's'} connected` : 'Apps error');
}
async function refreshChatModelSelect(status) {
    const select = document.getElementById('chat-model-select');
    if (!select) return;
    const names = (status.models || []).map(model => model.name);
    const current = appSettings?.ai.model || '';
    const all = names.includes(current) || !current ? names : [current, ...names];
    if (select.dataset.options !== all.join('|')) { select.replaceChildren(...all.map(name => h('option', { value: name, text: name }))); select.dataset.options = all.join('|'); }
    select.value = current;
    const mode = document.getElementById('chat-tool-mode');
    if (mode) mode.textContent = !status.ready ? status.message : status.capabilities?.tools ? 'Native tools' : 'Text-based tools';
}

async function refreshNotifications() {
    const items = await ipcRenderer.invoke('notifications:list');
    const unread = (Array.isArray(items) ? items : []).filter(item => !item.read).length;
    const badge = document.getElementById('notifications-count');
    badge.textContent = String(unread);
    badge.classList.toggle('hidden', !unread);
    return Array.isArray(items) ? items : [];
}
async function toggleNotifications() {
    const panel = document.getElementById('notifications-panel');
    if (!panel.classList.contains('hidden')) { panel.classList.add('hidden'); return; }
    const items = await refreshNotifications();
    panel.replaceChildren(
        h('div', { class: 'row' }, h('strong', { text: 'Notifications' }), h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'mini-button', text: 'Clear', onclick: async () => { await call('notifications:clear'); await refreshNotifications(); panel.classList.add('hidden'); } })),
        ...(items.length ? items.map(item => h('div', { class: 'notice' }, h('strong', { text: item.title }), item.body, h('div', { class: 'when', text: formatWhen(item.at) }))) : [h('p', { class: 'muted small', text: 'Nothing yet. Reminders and automation problems appear here.' })])
    );
    panel.classList.remove('hidden');
    await call('notifications:read-all');
    await refreshNotifications();
}

function bindGlobalSearch() {
    const input = document.getElementById('global-search');
    const box = document.getElementById('global-search-results');
    const item = (label, action) => h('button', { type: 'button', class: 'search-item', text: label, onclick: () => { box.classList.add('hidden'); input.value = ''; action(); } });
    let kind = '';
    const FILTERS = [['', 'All'], ['documents', 'Documents'], ['tasks', 'Tasks'], ['events', 'Events'], ['conversations', 'Chats'], ['memories', 'Memories']];
    const run = debounce(async () => {
        const term = input.value.trim();
        if (!term) { box.classList.add('hidden'); return; }
        const found = await ipcRenderer.invoke('dashboard:search', term, { kind });
        const pages = NAV_ITEMS.filter(([, label]) => label.toLowerCase().includes(term.toLowerCase()));
        const groups = [
            ['Pages', pages.map(([view, label]) => item(label, () => go(view)))],
            ['Apps', (found.apps || []).map(app => item(app.name, () => launchApp(app.id)))],
            ['Documents', (found.documents || []).map(doc => item(`${doc.name}${doc.location ? `, ${doc.location}` : ''}`, () => { go('docs'); if (doc.id) previewDocument(doc.id); }))],
            ['Conversations', (found.conversations || []).map(project => item(project.title, () => openProject(project.id)))],
            ['Tasks', (found.tasks || []).map(task => item(`${task.text}${task.dueDate ? ` · due ${formatWhen(task.dueDate)}` : ''}`, () => go('tasks')))],
            ['Events', (found.events || []).map(event => item(`${event.title} · ${formatWhen(event.start)}`, () => go('calendar')))],
            ['Memories', (found.memories || []).map(memory => item(memory.text.slice(0, 80), () => go('memory')))]
        ].filter(([, list]) => list.length);
        const filters = h('div', { class: 'search-filters' }, FILTERS.map(([value, label]) => h('button', { type: 'button', class: `chip${kind === value ? ' active' : ''}`, text: label, dataset: { filter: value }, onclick: () => { kind = value; run(); input.focus(); } })));
        const understood = found.understood?.length ? h('div', { class: 'search-understood', text: `Looking for: ${found.understood.join(', ')}` }) : null;
        box.replaceChildren(filters, ...(understood ? [understood] : []), ...(groups.length ? groups.flatMap(([title, list]) => [h('div', { class: 'search-group', text: title }), ...list]) : [h('div', { class: 'search-group', text: 'No matches' })]));
        box.classList.remove('hidden');
    }, 180);
    input.addEventListener('input', run);
    input.addEventListener('keydown', event => { if (event.key === 'Escape') { box.classList.add('hidden'); input.blur(); } });
    document.addEventListener('mousedown', event => { if (!event.target.closest('.topbar-search')) box.classList.add('hidden'); if (!event.target.closest('#notifications-panel,#notifications-button')) document.getElementById('notifications-panel').classList.add('hidden'); });
    document.addEventListener('keydown', event => { if (event.ctrlKey && event.key.toLowerCase() === 'k') { event.preventDefault(); input.focus(); } });
}

// A box on every page for telling Nexus what to do. AI Chat has its own, so it hides there.
function bindAskBar() {
    const input = h('input', { type: 'text', placeholder: 'Tell Nexus what to do…', 'aria-label': 'Tell Nexus what to do', autocomplete: 'off', maxlength: 4000 });
    const bar = h('form', { id: 'ask-bar', class: 'ask-bar', onsubmit: event => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        askNexus(text);
    } }, input, h('button', { type: 'submit', class: 'action-btn-primary', text: 'Ask' }));
    document.body.append(bar);
}
function updateAskBar(view) { document.getElementById('ask-bar')?.classList.toggle('hidden', view === 'chat'); }

function bindShell() {
    buildNavigation();
    bindAskBar();
    bindGlobalSearch();
    document.getElementById('notifications-button').addEventListener('click', toggleNotifications);
    document.getElementById('chat-model-select')?.addEventListener('change', async event => { await updateSettings({ ai: { model: event.target.value } }); refreshTopbarStatus(); toast(`Model set to ${event.target.value}.`); });
    document.getElementById('spoken-response-toggle')?.addEventListener('change', event => updateSettings({ voice: { spokenReplies: event.target.checked } }));
    ipcRenderer.on('notifications:new', (_event, entry) => { toast(`${entry.title}: ${entry.body}`); refreshNotifications(); PAGE_HOOKS.calendarChanged?.(); });
    ipcRenderer.on('nav:go', (_event, view, extra) => { go(view); if (view === 'school' && extra?.tab) openStudyTab(extra.tab, extra); });
    ipcRenderer.on('apps:changed', () => { PAGE_HOOKS.appsChanged?.(); });
}
