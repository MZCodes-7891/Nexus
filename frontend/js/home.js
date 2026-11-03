// Home dashboard. Every card reads real saved data; an empty card says so instead of showing sample content.
function openD2LPractice() { go('school'); openStudyTab('d2l'); }
const QUICK_ACTIONS = [['Plan my day', 'Look at my tasks, reminders, and calendar and help me plan today.'], ['What should I study?', 'Based on my progress, what should I study next?'], ['Research a topic', 'Help me research: '], ['Organize my downloads', 'Preview how you would organize my Downloads folder.']];

function askNexus(text, send = true) {
    go('chat');
    const input = document.getElementById('chat-input');
    input.value = text;
    input.focus();
    if (send && !aiBusy) sendMessage();
}

function homeCard(title, lines, emptyText, footer) {
    return h('section', { class: 'home-card' }, h('h3', { text: title }), lines.length ? lines : h('p', { class: 'muted small', text: emptyText }), footer || null);
}
function line(left, right) { return h('div', { class: 'line' }, left, right ? h('span', { class: 'when', text: right }) : null); }
function linkLine(text, action, right) { return line(h('button', { type: 'button', class: 'link-like', text, title: text, onclick: action }), right); }

function openSuggestion(action) {
    if (action.app) { launchApp(action.app); return; }
    go(action.view);
    if (action.tab) openStudyTab(action.tab, action);
}
// Weather asks for a city first, and news stays off until asked for, so Home sends nothing online by default.
function weatherCard() {
    const body = h('div', {}, h('p', { class: 'muted small', text: 'Loading…' }));
    const askCity = () => {
        const city = h('input', { class: 'field', type: 'text', placeholder: 'Your city', 'aria-label': 'City for weather' });
        const save = async () => { if (city.value.trim()) { await updateSettings({ general: { city: city.value.trim() } }); renderHome(); } };
        city.addEventListener('keydown', event => { if (event.key === 'Enter') save(); });
        body.replaceChildren(h('p', { class: 'muted small', text: 'Type a city to see its weather. Only the city name is sent, to Open-Meteo.' }), city, h('button', { type: 'button', class: 'mini-button', text: 'Save', onclick: save }));
    };
    if (!appSettings.general.city) askCity();
    else ipcRenderer.invoke('web:weather', appSettings.general.city).then(result => {
        if (!result.ok) { body.replaceChildren(h('p', { class: 'muted small', text: result.message }), h('button', { type: 'button', class: 'link-like', text: 'Change city', onclick: askCity })); return; }
        body.replaceChildren(h('div', { class: 'weather-now', text: `${Math.round(result.now.temperatureC)}°C, ${result.now.conditions}` }), h('div', { class: 'muted small', text: `${result.place} · feels like ${Math.round(result.now.feelsLikeC)}°C` }), ...result.forecast.slice(1).map(day => line(h('span', { text: new Date(`${day.date}T12:00`).toLocaleDateString([], { weekday: 'long' }) }), `${Math.round(day.lowC)}° to ${Math.round(day.highC)}°, ${day.conditions}`)), h('button', { type: 'button', class: 'link-like', text: 'Change city', onclick: askCity }));
    });
    return h('section', { class: 'home-card' }, h('h3', { text: 'Weather' }), body);
}
function newsCard() {
    const body = h('div', {});
    const topic = h('input', { class: 'field', type: 'text', value: appSettings.general.newsTopic, placeholder: 'Topic (optional)', 'aria-label': 'News topic' });
    const save = async on => { await updateSettings({ general: { newsOn: on, newsTopic: topic.value.trim() } }); renderHome(); };
    if (!appSettings.general.newsOn) body.replaceChildren(h('p', { class: 'muted small', text: 'Headlines come from Google News. Any topic you type is sent there.' }), topic, h('button', { type: 'button', class: 'mini-button', text: 'Show headlines', onclick: () => save(true) }));
    else {
        body.replaceChildren(h('p', { class: 'muted small', text: 'Loading…' }));
        ipcRenderer.invoke('web:news', appSettings.general.newsTopic).then(result => body.replaceChildren(...(result.ok ? result.headlines.slice(0, 5).map(item => linkLine(item.title, () => ipcRenderer.invoke('open-external-url', item.link), item.source)) : [h('p', { class: 'muted small', text: result.message })]), h('button', { type: 'button', class: 'link-like', text: 'Turn off headlines', onclick: () => save(false) })));
    }
    return h('section', { class: 'home-card' }, h('h3', { text: appSettings.general.newsTopic ? `News: ${appSettings.general.newsTopic}` : 'News' }), body);
}

async function renderHome() {
    const grid = document.getElementById('home-grid');
    const data = await ipcRenderer.invoke('dashboard:data');
    if (data?.ok === false) { grid.replaceChildren(emptyState(`Could not load the dashboard: ${data.message}`)); return; }
    const ai = lastAiStatus || await ipcRenderer.invoke('ollama:test');
    const apps = data.recentApps.length ? data.recentApps : data.favoriteApps;
    const accounts = await ipcRenderer.invoke('composio:catalog').catch(() => ({ ok: false, accounts: [] }));
    const activeAccounts = (accounts.accounts || []).filter(account => account.status === 'ACTIVE');
    grid.replaceChildren(
        homeCard('Suggested for you', (data.suggestions || []).map(item => linkLine(item.text, () => openSuggestion(item.action))), 'Suggestions appear as you add tasks, files, and study sets. They stay on this computer.'),
        weatherCard(),
        newsCard(),
        homeCard('System', [
            line(h('span', { text: 'AI model' }), ai.ready ? ai.model : ai.ok && !ai.installed ? 'not installed' : ai.ok ? 'engine problem' : 'offline'),
            line(h('span', { text: 'Tool calling' }), ai.capabilities ? (ai.capabilities.tools ? 'native' : 'text-based') : 'unknown'),
            line(h('span', { text: 'Connected apps' }), accounts.ok ? String(activeAccounts.length) : 'not verified'),
            line(h('span', { text: 'Flashcards due' }), String(data.dueCards))
        ], '', ai.ready ? null : h('p', { class: 'error-text small', text: ai.message })),
        homeCard(data.recentApps.length ? 'Recent apps' : 'Favorite apps', apps.map(app => linkLine(`${app.icon || ''} ${app.name}`.trim(), () => launchApp(app.id), app.lastOpenedAt ? formatWhen(app.lastOpenedAt) : '')), 'Add apps in My Apps.'),
        homeCard('Connected services', activeAccounts.slice(0, 5).map(account => linkLine(account.displayName ? `${account.toolkit}: ${account.displayName}` : account.toolkit, () => go('composio-dash'))), accounts.ok ? 'No apps connected yet.' : 'Add a Composio key in Settings to connect apps.'),
        homeCard('Upcoming tasks', data.tasks.map(task => linkLine(task.text, () => go('tasks'), task.dueDate ? formatWhen(task.dueDate) : task.priority === 'high' ? 'high priority' : '')), 'No open tasks.'),
        homeCard('Coming up', [...data.events.map(event => linkLine(event.title, () => go('calendar'), formatWhen(event.start))), ...data.reminders.map(item => linkLine(`Reminder: ${item.text}`, () => go('calendar'), formatWhen(item.at)))].slice(0, 6), 'Nothing scheduled in the next two weeks.'),
        homeCard('Recent documents', data.recentDocuments.map(doc => linkLine(doc.name, () => { go('docs'); previewDocument(doc.id); }, formatWhen(doc.lastOpenedAt || doc.addedAt))), 'Add files in Documents.'),
        homeCard('Recent conversations', data.conversations.map(project => linkLine(project.title, () => openProject(project.id), formatWhen(project.updatedAt))), 'No conversations yet.'),
        homeCard('Recent agent tasks', data.recentRuns.map(run => line(h('span', { class: 'link-like', text: run.goal, title: run.goal }), run.status)), 'Multi-step work Nexus carries out appears here.')
    );
}

function bindHome() {
    document.getElementById('home-actions').replaceChildren(h('button', { type: 'button', class: 'chip', text: 'D2L practice test', onclick: openD2LPractice }), ...QUICK_ACTIONS.map(([label, prompt]) => h('button', { type: 'button', class: 'chip', text: label, onclick: () => askNexus(prompt, !prompt.endsWith(': ')) })));
    document.getElementById('quick-command-form').addEventListener('submit', event => {
        event.preventDefault();
        const input = document.getElementById('quick-command');
        if (input.value.trim()) { askNexus(input.value.trim()); input.value = ''; }
    });
    PAGE_HOOKS.home = renderHome;
    PAGE_HOOKS.agentFinished = () => { if (!document.getElementById('view-home').classList.contains('hidden')) renderHome(); };
}
