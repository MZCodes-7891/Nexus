const featuredApps = [
  { name: 'Google Docs', aliases: ['googledocs', 'google_docs', 'google-docs'], icon: '📄', description: 'Create and work with documents', category: 'Google', url: 'https://docs.google.com' },
  { name: 'Google Slides', aliases: ['googleslides', 'google_slides', 'google-slides'], icon: '📊', description: 'Build and organize presentations', category: 'Google', url: 'https://slides.google.com' },
  { name: 'Google Drive', aliases: ['googledrive', 'google_drive', 'google-drive'], icon: '📁', description: 'Find and manage authorized files', category: 'Google', url: 'https://drive.google.com' },
  { name: 'Gmail', aliases: ['gmail'], icon: '✉️', description: 'Search and summarize email', category: 'Google', url: 'https://mail.google.com' },
  { name: 'Google Calendar', aliases: ['googlecalendar', 'google_calendar', 'google-calendar'], icon: '🗓️', description: 'View and manage events', category: 'Google', url: 'https://calendar.google.com' },
  { name: 'YouTube', aliases: ['youtube'], icon: '▶️', description: 'Search videos and study content', category: 'Media', url: 'https://www.youtube.com' },
  { name: 'Spotify', aliases: ['spotify'], icon: '🎵', description: 'Open Spotify and use supported actions', category: 'Media', url: 'https://open.spotify.com' },
  { name: 'D2L / Brightspace', aliases: ['d2l', 'brightspace'], icon: '🎓', description: 'Connect with your school link in Nexus School Hub', category: 'Education', url: 'https://www.d2l.com' },
  { name: 'Discord', aliases: ['discord'], icon: '🎮', description: 'Access supported servers and messages', category: 'Communication', url: 'https://discord.com/app' },
  { name: 'Notion', aliases: ['notion'], icon: '📝', description: 'Search and organize workspace pages', category: 'Productivity', url: 'https://www.notion.so' },
  { name: 'GitHub', aliases: ['github'], icon: '⌘', description: 'Work with repositories and issues', category: 'Developer', url: 'https://github.com' },
  { name: 'Slack', aliases: ['slack'], icon: '💬', description: 'Search and work with conversations', category: 'Communication', url: 'https://slack.com' },
  { name: 'Microsoft Word', aliases: ['microsoftword', 'word', 'msword'], icon: 'W', description: 'Work with supported Word files', category: 'Microsoft', url: 'https://www.microsoft365.com/launch/word' },
  { name: 'Microsoft PowerPoint', aliases: ['microsoftpowerpoint', 'powerpoint', 'mspowerpoint'], icon: 'P', description: 'Work with supported presentations', category: 'Microsoft', url: 'https://www.microsoft365.com/launch/powerpoint' },
  { name: 'Trello', aliases: ['trello'], icon: '▦', description: 'Manage boards and cards', category: 'Productivity', url: 'https://trello.com' }
];

let liveCatalog = [];
let connectedAccounts = [];
let keyVerified = false;
let showAllIntegrations = false;
let integrationErrors = new Map();
let attachedDocumentText = '';
let attachedDocumentNames = [];
let attachedPictures = [];
// Pictures are shown straight from the file on this PC.
const pictureUrl = file => `file:///${encodeURI(String(file).replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F')}`;
const pictureStrip = files => (files?.length ? h('div', { class: 'chat-pictures' }, ...files.map(file => h('img', { class: 'chat-picture', src: pictureUrl(file), alt: 'Picture', loading: 'lazy', onclick: () => ipcRenderer.invoke('documents:open-picture', file) }))) : null);
let studyTimerInterval = null;
let studyTimerEndsAt = 0;
let studyModeOwnsDnd = false;
let busyIntegrations = new Set();
let localTasks = [];
try { localTasks = JSON.parse(localStorage.getItem('nexus.tasks') || '[]'); if (!Array.isArray(localTasks)) localTasks = []; }
catch { localTasks = []; }
const PROJECTS_STORAGE_KEY = 'nexus.projects.v1';
let nexusProjects = [];
let activeProjectId = '';
let conversationMemoryEnabled = true;
let savedMemories = [];
async function loadConversations() {
    const saved = await ipcRenderer.invoke('conversations:load');
    if (saved && Array.isArray(saved.projects)) { nexusProjects = saved.projects; activeProjectId = saved.activeProjectId || ''; return; }
    // First start after the move from page storage: bring existing conversations across.
    try {
        const stored = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY) || '[]');
        if (Array.isArray(stored)) nexusProjects = stored.filter(project => project && typeof project.id === 'string' && Array.isArray(project.messages));
        activeProjectId = localStorage.getItem('nexus.activeProject') || '';
    } catch { nexusProjects = []; }
    await ipcRenderer.invoke('conversations:save', { projects: nexusProjects, activeProjectId });
}

function currentProject() { return nexusProjects.find(project => project.id === activeProjectId) || null; }

function buildConversationMemory(query, activeId, facts = savedMemories) {
    if (!conversationMemoryEnabled) return '';
    const stopWords = new Set(['about','after','again','also','been','before','being','could','does','doing','from','have','help','here','into','just','make','more','most','need','please','same','some','that','their','them','then','there','these','they','this','want','were','what','when','where','which','while','with','would','your','nexus','asked','asking','tell','show','know','remember']);
    const terms = [...new Set((String(query).toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter(word => !stopWords.has(word)))].slice(0, 30);
    const exchanges = [];
    for (const project of nexusProjects) {
        if (project.id === activeId) continue;
        const history = Array.isArray(project.messages) ? project.messages : [];
        for (let i = 0; i < history.length; i++) {
            if (history[i]?.role !== 'user') continue;
            const userText = String(history[i].content || '').slice(0, 2600);
            const assistant = history[i + 1]?.role === 'assistant' ? String(history[i + 1].content || '').slice(0, 2000) : '';
            const haystack = `${project.title || ''} ${userText} ${assistant}`.toLowerCase();
            const hits = terms.reduce((score, term) => score + (haystack.includes(term) ? 1 + (userText.toLowerCase().includes(term) ? 0.7 : 0) : 0), 0);
            const timestamp = Date.parse(project.updatedAt || project.createdAt || '') || 0;
            exchanges.push({ title: project.title || 'Saved task', userText, assistant, hits, timestamp, index: i });
        }
    }
    const best = exchanges.filter(item => item.hits > 0).sort((a, b) => b.hits - a.hits || b.timestamp - a.timestamp).slice(0, 6);
    const selected = new Set(best.map(item => `${item.title}\u0000${item.index}`));
    const recent = exchanges.slice().sort((a, b) => b.timestamp - a.timestamp || b.index - a.index).filter(item => !selected.has(`${item.title}\u0000${item.index}`)).slice(0, best.length ? 2 : 5);
    const chosen = [...best, ...recent].sort((a, b) => b.timestamp - a.timestamp || b.index - a.index).slice(0, 8);
    let remaining = 3500;
    const sections = [];
    const rankedFacts = facts.map(fact => {
        const text = String(fact?.text || '').slice(0, 800);
        const lower = text.toLowerCase();
        const hits = terms.reduce((score, term) => score + (lower.includes(term) ? 1 : 0), 0);
        return { text, hits, createdAt: Date.parse(fact?.createdAt || '') || 0 };
    }).filter(fact => fact.text).sort((a, b) => b.hits - a.hits || b.createdAt - a.createdAt).slice(0, 8);
    if (rankedFacts.length) {
        const factBlock = `Facts Nexus has saved about the user:\n${rankedFacts.map(fact => `- ${fact.text}`).join('\n')}`;
        const clippedFacts = factBlock.slice(0, Math.min(1800, remaining));
        sections.push(clippedFacts); remaining -= clippedFacts.length;
    }
    for (const item of chosen) {
        const entry = `Saved task: ${item.title}\nYou asked: ${item.userText}\nNexus replied: ${item.assistant || '(no saved reply)'}`;
        if (remaining <= 0) break;
        const excerpt = entry.slice(0, remaining);
        sections.push(excerpt); remaining -= excerpt.length;
    }
    return sections.join('\n\n');
}

async function processMemoryCommand(text) {
    const remember = String(text || '').match(/^\s*(?:please\s+)?remember(?:\s+that)?\s*[:,]?\s+([\s\S]{2,800})$/i);
    if (remember) {
        if (!conversationMemoryEnabled) return `Memory is turned off, so this was not saved: ${remember[1].trim()}`;
        const result = await ipcRenderer.invoke('memory:remember', remember[1].trim());
        savedMemories = await ipcRenderer.invoke('memory:list');
        updateMemorySettings();
        if (!result.ok) return `Not saved: ${result.message}`;
        return result.added ? `Saved this memory: ${result.item.text}` : `This memory was already saved: ${result.item.text}`;
    }
    const forget = String(text || '').match(/^\s*(?:please\s+)?forget(?:\s+that)?\s*[:,]?\s+([\s\S]{2,800})$/i);
    if (forget) {
        const removed = await ipcRenderer.invoke('memory:forget', forget[1].trim());
        savedMemories = await ipcRenderer.invoke('memory:list');
        updateMemorySettings();
        return removed ? `Forgot this saved memory: ${forget[1].trim()}` : `No saved memory matched: ${forget[1].trim()}`;
    }
    return '';
}
function updateMemorySettings() { PAGE_HOOKS.memoryChanged?.(); }
ipcRenderer.on('memory:learned', async (_event, facts) => {
    savedMemories = await ipcRenderer.invoke('memory:list');
    updateMemorySettings();
    for (const fact of Array.isArray(facts) ? facts : []) toast(`Remembered: ${String(fact).replace(/^The user\s+/i, 'you ')}`);
});

let projectsSaveTimer = null;
function saveProjects() {
    clearTimeout(projectsSaveTimer);
    projectsSaveTimer = setTimeout(async () => {
        const result = await ipcRenderer.invoke('conversations:save', { projects: nexusProjects, activeProjectId });
        const status = document.getElementById('projects-empty');
        if (status) status.textContent = result.ok ? (nexusProjects.length ? 'Saved on this computer' : 'Your saved conversations appear here.') : `Could not save conversations: ${result.message}`;
    }, 250);
    return true;
}

function appendFormattedInline(parent, value) {
    const pattern = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\n]+\*)/g;
    const source = String(value);
    let cursor = 0;
    for (const match of source.matchAll(pattern)) {
        parent.appendChild(document.createTextNode(source.slice(cursor, match.index)));
        const token = match[0];
        const element = token.startsWith('`') ? document.createElement('code')
            : token.startsWith('**') || token.startsWith('__') ? document.createElement('strong') : document.createElement('em');
        element.textContent = token.startsWith('`') ? token.slice(1, -1) : token.slice(token.startsWith('__') ? 2 : token.startsWith('**') ? 2 : 1, token.startsWith('__') || token.startsWith('**') ? -2 : -1);
        parent.appendChild(element); cursor = match.index + token.length;
    }
    parent.appendChild(document.createTextNode(source.slice(cursor)));
}

function renderFormattedMessage(node, value) {
    const lines = String(value || '').split(/\r?\n/);
    let paragraph = [];
    let list = null;
    let listType = '';
    const flushParagraph = () => {
        if (!paragraph.length) return;
        const p = document.createElement('p'); appendFormattedInline(p, paragraph.join(' ')); node.appendChild(p); paragraph = [];
    };
    const flushList = () => { list = null; listType = ''; };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*```/.test(line)) {
            flushParagraph(); flushList();
            const code = [];
            while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
            const pre = document.createElement('pre'); const codeNode = document.createElement('code'); codeNode.textContent = code.join('\n'); pre.appendChild(codeNode); node.appendChild(pre); continue;
        }
        const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+)$/);
        if (heading) {
            flushParagraph(); flushList();
            const h = document.createElement(heading[1].length === 1 ? 'h3' : 'h4'); appendFormattedInline(h, heading[2]); node.appendChild(h); continue;
        }
        const item = line.match(/^\s*(?:[-*•]\s+|\d+[.)]\s+)(.*)$/);
        if (item) {
            flushParagraph();
            const type = /^\s*\d+[.)]/.test(line) ? 'ol' : 'ul';
            if (!list || listType !== type) { flushList(); listType = type; list = document.createElement(type); node.appendChild(list); }
            const li = document.createElement('li'); appendFormattedInline(li, item[1]); list.appendChild(li); continue;
        }
        if (!line.trim()) { flushParagraph(); flushList(); continue; }
        if (/^\s*(?:---+|___+)\s*$/.test(line)) { flushParagraph(); flushList(); node.appendChild(document.createElement('hr')); continue; }
        const quote = line.match(/^\s*>\s?(.*)$/);
        if (quote) { flushParagraph(); flushList(); const q = document.createElement('blockquote'); appendFormattedInline(q, quote[1]); node.appendChild(q); continue; }
        flushList(); paragraph.push(line.trim());
    }
    flushParagraph();
}

function parsePracticeTestResponse(value) {
    let source = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const first = source.indexOf('{'), last = source.lastIndexOf('}');
    if (first < 0 || last < first) return null;
    try { source = JSON.parse(source.slice(first, last + 1)); } catch { return null; }
    if (!source || !Array.isArray(source.questions) || source.questions.length !== 10) return null;
    const questions = [];
    for (const item of source.questions) {
        const correct = String(item?.correct || '').toUpperCase();
        const choices = item?.choices || {};
        if (!String(item?.question || '').trim() || !['A', 'B', 'C', 'D'].includes(correct) || ['A', 'B', 'C', 'D'].some(key => !String(choices[key] || '').trim())) return null;
        questions.push({ question: String(item.question), choices: Object.fromEntries(['A', 'B', 'C', 'D'].map(key => [key, String(choices[key])])), correct, explanation: String(item.explanation || ''), source: String(item.source || 'D2L study source') });
    }
    return { title: String(source.title || 'D2L Practice Test'), subject: String(source.subject || 'Practice'), objectives: Array.isArray(source.objectives) ? source.objectives.map(String) : [], questions };
}

function renderPracticeTest(node, quiz, project, message) {
    node.replaceChildren(); node.classList.add('practice-test-message');
    const heading = document.createElement('h3'); heading.className = 'practice-test-title'; heading.textContent = quiz.title; node.appendChild(heading);
    const meta = document.createElement('div'); meta.className = 'practice-test-meta';
    meta.textContent = [quiz.subject, quiz.objectives.join(', '), `${quiz.questions.length} questions`].filter(Boolean).join(' · '); node.appendChild(meta);
    const form = document.createElement('form');
    const answers = message.practiceAnswers || {};
    quiz.questions.forEach((item, index) => {
        const fieldset = document.createElement('fieldset'); fieldset.className = 'practice-question';
        const legend = document.createElement('legend'); legend.textContent = `${index + 1}. ${item.question}`; fieldset.appendChild(legend);
        for (const letter of ['A', 'B', 'C', 'D']) {
            const label = document.createElement('label'); label.className = 'practice-choice';
            const input = document.createElement('input'); input.type = 'radio'; input.name = `practice-${project.id}-${index}`; input.value = letter;
            input.checked = answers[index] === letter; input.disabled = Boolean(message.practiceSubmitted);
            input.addEventListener('change', () => { message.practiceAnswers = { ...(message.practiceAnswers || {}), [index]: letter }; saveProjects(); });
            input.id = `practice-${project.id}-${index}-${letter}`;
            const choiceLetter = document.createElement('span'); choiceLetter.className = 'practice-choice-letter'; choiceLetter.textContent = letter;
            const choice = document.createElement('span'); choice.className = 'practice-choice-text'; choice.textContent = item.choices[letter];
            label.htmlFor = input.id;
            label.append(input, choiceLetter, choice); fieldset.appendChild(label);
        }
        if (message.practiceSubmitted) {
            const chosen = message.practiceAnswers?.[index];
            const review = document.createElement('div'); review.className = 'practice-result';
            review.textContent = `${chosen === item.correct ? 'Correct' : `Not quite. Correct answer: ${item.correct}.`} ${item.explanation}${item.source ? ` Source: ${item.source}` : ''}`;
            fieldset.appendChild(review);
        }
        form.appendChild(fieldset);
    });
    if (message.practiceSubmitted) {
        const score = document.createElement('div'); score.className = 'practice-result';
        score.textContent = `Final score: ${message.practiceScore ?? 0} / ${quiz.questions.length} (${Math.round((message.practiceScore || 0) / quiz.questions.length * 100)}%).`;
        node.appendChild(score);
    } else {
        const status = document.createElement('div'); status.className = 'practice-test-meta'; status.setAttribute('aria-live', 'polite');
        const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'integration-button practice-submit'; submit.textContent = 'Submit practice test';
        submit.addEventListener('click', event => {
            event.preventDefault();
            const selected = {};
            for (const [index, item] of quiz.questions.entries()) {
                const expectedName = `practice-${project.id}-${index}`;
                const choice = Array.from(form.querySelectorAll('input[type="radio"]')).find(input => input.name === expectedName && input.checked);
                if (choice) selected[index] = choice.value;
            }
            const unanswered = quiz.questions.length - Object.keys(selected).length;
            if (unanswered) { status.textContent = `Answer all questions before submitting (${unanswered} unanswered).`; return; }
            const score = quiz.questions.reduce((sum, item, index) => sum + (selected[index] === item.correct ? 1 : 0), 0);
            message.practiceAnswers = selected; message.practiceSubmitted = true; message.practiceScore = score;
            message.practiceSubmittedAt = new Date().toISOString();
            quiz.questions.forEach((item, index) => recordD2LQuizResult(selected[index] === item.correct));
            project.updatedAt = new Date().toISOString(); saveProjects(); renderProjectList();
            renderPracticeTest(node, quiz, project, message);
        });
        form.append(status, submit);
    }
    node.appendChild(form);
}

function renderProjectMessages() {
    const box = document.getElementById('chat-box');
    if (!box) return;
    box.replaceChildren();
    const project = currentProject();
    const messages = project?.messages || [];
    if (!messages.length) {
        const intro = document.createElement('div'); intro.className = 'message ai-msg';
        intro.textContent = 'Start your task here. Nexus saves this conversation in the selected project so you can continue later.';
        box.appendChild(intro);
        return;
    }
    for (const message of messages) {
        const node = document.createElement('div');
        node.className = `message ${message.role === 'user' ? 'user-msg' : 'ai-msg'}`;
        // What Nexus actually did stays visible when a saved conversation is reopened.
        if (message.actions?.length || message.plan?.steps?.length) { const panel = h('div', { class: 'run-panel' }); renderRunPanel(panel, { plan: message.plan || { steps: [] }, actions: message.actions || [] }); node.append(panel); }
        if (message.practiceTest && message.role === 'assistant') { const holder = h('div', {}); node.append(holder); renderPracticeTest(holder, message.practiceTest, project, message); }
        else { const holder = h('div', {}); node.append(holder); renderFormattedMessage(holder, message.displayContent || message.content); }
        if (message.role === 'user' && message.imagePaths?.length) node.append(pictureStrip(message.imagePaths));
        box.appendChild(node);
    }
    box.scrollTop = box.scrollHeight;
}

function renderProjectList() {
    const list = document.getElementById('project-list');
    const empty = document.getElementById('projects-empty');
    if (!list || !empty) return;
    const query = normalize(document.getElementById('projects-search')?.value || '');
    const sorted = [...nexusProjects].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    const filtered = sorted.filter(project => !query || normalize(project.title).includes(query));
    list.replaceChildren();
    for (const project of filtered) {
        const row = document.createElement('div'); row.className = `project-row${project.id === activeProjectId ? ' selected' : ''}`;
        const open = document.createElement('button'); open.type = 'button'; open.className = 'project-open';
        open.textContent = project.title || 'Untitled project'; open.title = project.title || 'Untitled project';
        open.setAttribute('aria-current', project.id === activeProjectId ? 'page' : 'false');
        open.addEventListener('click', () => openProject(project.id));
        const rename = document.createElement('button'); rename.type = 'button'; rename.className = 'project-action'; rename.textContent = '✎'; rename.title = 'Rename project'; rename.setAttribute('aria-label', `Rename ${project.title}`);
        rename.addEventListener('click', () => renameProject(project.id));
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'project-action delete'; remove.textContent = '×'; remove.title = 'Delete project'; remove.setAttribute('aria-label', `Delete ${project.title}`);
        remove.addEventListener('click', () => deleteProject(project.id));
        row.append(open, rename, remove); list.appendChild(row);
    }
    empty.textContent = nexusProjects.length === 0 ? 'Your saved Nexus tasks will appear here.' : filtered.length === 0 ? 'No projects match your search.' : 'Saved on this computer';
    empty.classList.toggle('hidden', filtered.length > 0 && nexusProjects.length > 0);
}

function createProject(navigate = true) {
    const now = new Date().toISOString();
    const project = { id: crypto.randomUUID(), title: 'New project', createdAt: now, updatedAt: now, messages: [] };
    nexusProjects.unshift(project);
    activeProjectId = project.id;
    saveProjects(); renderProjectList(); renderProjectMessages();
    if (navigate) showView('chat', navBtn('chat'));
    return project;
}

function openProject(projectId) {
    if (!nexusProjects.some(project => project.id === projectId)) return;
    activeProjectId = projectId;
    saveProjects(); renderProjectList(); renderProjectMessages();
    showView('chat', navBtn('chat'));
}

async function renameProject(projectId) {
    const project = nexusProjects.find(item => item.id === projectId);
    if (!project) return;
    const title = await promptModal('Rename conversation', { value: project.title || '' });
    if (title === null || !title.trim()) return;
    project.title = title.trim().slice(0, 60); project.updatedAt = new Date().toISOString();
    saveProjects(); renderProjectList();
}

async function deleteProject(projectId) {
    const project = nexusProjects.find(item => item.id === projectId);
    if (!project || !await confirmModal('Delete conversation', `Delete “${project.title}” and its saved messages? This cannot be undone.`, 'Delete')) return;
    nexusProjects = nexusProjects.filter(item => item.id !== projectId);
    if (activeProjectId === projectId) activeProjectId = nexusProjects[0]?.id || '';
    if (!activeProjectId) createProject(false);
    else { saveProjects(); renderProjectList(); renderProjectMessages(); }
}

function initializeProjects() {
    if (!nexusProjects.length) createProject(false);
    else if (!nexusProjects.some(project => project.id === activeProjectId)) activeProjectId = nexusProjects[0].id;
    saveProjects(); renderProjectList(); renderProjectMessages();
}

function setStatus(elementId, text, kind = '') {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = text;
    el.dataset.state = kind;
}

async function saveComposioKey() {
    const input = document.getElementById('composio-key-input');
    const button = document.getElementById('composio-key-save');
    const key = input?.value.trim();
    if (!key) return setStatus('composio-key-status', 'Enter your Composio project API key.', 'error');
    if (button) { button.disabled = true; button.textContent = 'Verifying…'; }
    setStatus('composio-key-status', 'Verifying key with Composio…', 'busy');
    try {
        const result = await ipcRenderer.invoke('composio:save-key', key);
        setStatus('composio-key-status', result.message, result.ok ? 'success' : 'error');
        keyVerified = Boolean(result.verified);
        if (result.ok) { input.value = ''; await loadIntegrations(); }
        else { input.focus(); input.select(); renderIntegrations(result.message); }
    } catch (error) {
        keyVerified = false;
        setStatus('composio-key-status', `Could not verify the key: ${error.message}`, 'error');
    } finally {
        if (button) { button.disabled = false; button.textContent = 'Verify & Save'; }
    }
}

const PAGE_HOOKS = {};
function showView(viewId, btn) {
    if (!document.getElementById(`view-${viewId}`)) return;
    document.querySelectorAll('.view').forEach(view => view.classList.add('hidden'));
    document.getElementById(`view-${viewId}`).classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(item => { item.classList.remove('active'); item.removeAttribute('aria-current'); });
    const target = btn || navBtn(viewId);
    if (target) { target.classList.add('active'); target.setAttribute('aria-current', 'page'); }
    const title = document.getElementById('page-title');
    if (title) title.textContent = target?.dataset.label || NAV_ITEMS.find(([view]) => view === viewId)?.[1] || 'NEXUS';
    if (viewId === 'composio-dash') loadIntegrations();
    if (viewId === 'school') refreshSchoolData();
    if (viewId === 'tasks') ipcRenderer.invoke('tasks:list').then(tasks => { localTasks = tasks; renderTasks(); }).catch(() => renderTasks());
    updateAskBar(viewId);
    PAGE_HOOKS[viewId]?.();
}

function openChatPrompt(placeholder) {
    showView('chat', navBtn('chat'));
    const input = document.getElementById('chat-input');
    if (input) { input.placeholder = placeholder; input.focus(); }
}

function refreshDashboardStatus() { return refreshTopbarStatus(); }

async function persistTasks() { localTasks = await ipcRenderer.invoke('tasks:list'); }

function renderTasks() {
    const list = document.getElementById('task-list');
    if (!list) return;
    list.replaceChildren();
    if (!localTasks.length) {
        const empty = document.createElement('div'); empty.className = 'task-empty';
        empty.textContent = 'Your list is clear. Add a task to get started.'; list.appendChild(empty); return;
    }
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const ordered = [...localTasks].sort((a, b) => String(a.projectTitle || 'General').localeCompare(String(b.projectTitle || 'General'))
        || Number(a.done) - Number(b.done)
        || (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1)
        || String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));
    let lastProject = null;
    for (const task of ordered) {
        const projectName = task.projectTitle || 'General';
        if (projectName !== lastProject) {
            const heading = document.createElement('h3'); heading.className = 'task-group-heading'; heading.textContent = projectName;
            list.appendChild(heading); lastProject = projectName;
        }
        const row = document.createElement('div'); row.className = 'task-row';
        const label = document.createElement('span'); label.textContent = task.text; label.className = task.status === 'complete' || task.done ? 'task-done' : '';
        if (task.description) label.append(h('small', { class: 'task-desc', text: task.description }));
        const status = document.createElement('select'); status.className = 'task-status'; status.setAttribute('aria-label', `Status for ${task.text}`);
        for (const [value, text] of [['todo', 'To do'], ['in_progress', 'In progress'], ['complete', 'Complete']]) {
            const option = document.createElement('option'); option.value = value; option.textContent = text; status.appendChild(option);
        }
        status.value = task.status || (task.done ? 'complete' : 'todo');
        status.addEventListener('change', async () => { await ipcRenderer.invoke('tasks:update', { taskId: task.id, status: status.value }); await persistTasks(); renderTasks(); });
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'task-remove'; remove.textContent = '×'; remove.title = 'Remove task';
        remove.addEventListener('click', async () => { localTasks = await ipcRenderer.invoke('tasks:delete', task.id); renderTasks(); });
        row.append(label, status);
        const details = [task.category, task.priority && task.priority !== 'medium' ? `${task.priority} priority` : '', task.dueDate ? `Due ${formatWhen(task.dueDate)}` : ''].filter(Boolean);
        const meta = document.createElement('small'); meta.textContent = details.join(' · '); meta.className = `task-meta${task.dueDate && task.status !== 'complete' && new Date(task.dueDate) < new Date() ? ' task-overdue' : ''}`; row.appendChild(meta);
        row.append(h('button', { type: 'button', class: 'mini-button', text: 'Edit', onclick: () => editTask(task) }), remove); list.appendChild(row);
    }
}

function editTask(task) {
    const title = h('input', { type: 'text', value: task.text, maxlength: 180 });
    const description = h('textarea', { rows: 3, maxlength: 2000 }); description.value = task.description || '';
    const originalDue = task.dueDate ? new Date(task.dueDate).toLocaleString() : '';
    const due = h('input', { type: 'text', value: originalDue, placeholder: 'e.g. Friday at 5 PM' });
    const priority = h('select', {}, ['high', 'medium', 'low'].map(value => h('option', { value, text: value[0].toUpperCase() + value.slice(1), selected: task.priority === value })));
    const category = h('input', { type: 'text', value: task.category || '', maxlength: 40 });
    modal('Edit task', h('div', {}, h('label', { text: 'Title' }), title, h('label', { text: 'Description' }), description, h('label', { text: 'Due' }), due, h('label', { text: 'Priority' }), priority, h('label', { text: 'Category' }), category), [{ label: 'Cancel' }, { label: 'Save', primary: true, run: async () => {
        const dueValue = due.value.trim();
        await call('tasks:update', { taskId: task.id, title: title.value, description: description.value, priority: priority.value, category: category.value, ...(dueValue !== originalDue ? { dueDate: dueValue } : {}) });
        await persistTasks(); renderTasks();
    } }]);
}

async function attachLocalDocuments(showChatNotice = false) {
    const result = await ipcRenderer.invoke('documents:pick');
    if (result.canceled) return;
    if (result.pictures?.length) {
        attachedPictures = result.pictures.map(item => item.path);
        if (showChatNotice) addAssistantMessage(`${result.pictures.length} picture${result.pictures.length === 1 ? '' : 's'} attached: ${result.pictures.map(item => item.name).join(', ')}. Ask Nexus anything about ${result.pictures.length === 1 ? 'it' : 'them'}.`);
        if (!result.documents?.length) return;
    }
    if (!result.documents?.length) {
        const errors = (result.errors || []).map(item => `${item.name}: ${item.message}`).join(' ');
        const message = errors || 'No readable documents were selected.';
        const status = document.getElementById('docs-selection-status'); if (status) status.textContent = message;
        if (showChatNotice) addAssistantMessage(message);
        return;
    }
    attachedDocumentText = result.documents.map(doc => {
        const pdfInfo = doc.pageCount
            ? `PDF pages: ${doc.pageCount}; pages with selectable text: ${doc.textPages ?? 'unknown'}${doc.blankPages?.length ? `; pages with no extracted text: ${doc.blankPages.join(', ')}` : ''}${doc.notProcessedPages?.length ? `; pages not processed after the import limit: ${doc.notProcessedPages.join(', ')}` : ''}${doc.truncated ? '; extraction truncated at the import limit' : ''}`
            : (doc.truncated ? 'Document text truncated at the import limit' : '');
        return `FILE: ${doc.name}${doc.truncated ? ' (truncated)' : ''}${pdfInfo ? `\n[${pdfInfo}]` : ''}\n${doc.content}`;
    }).join('\n\n');
    const names = result.documents.map(doc => doc.name).join(', ');
    attachedDocumentNames = result.documents.map(doc => doc.name);
    const errorText = (result.errors || []).map(item => `${item.name}: ${item.message}`).join(' ');
    const pdfPages = result.documents.filter(doc => doc.pageCount).map(doc => `${doc.name}: ${doc.textPages ?? '?'} of ${doc.pageCount} pages had selectable text${doc.blankPages?.length ? `; no text extracted on pages ${doc.blankPages.join(', ')}` : ''}${doc.notProcessedPages?.length ? `; pages not processed ${doc.notProcessedPages.join(', ')}` : ''}${doc.truncated ? '; import limit reached' : ''}`).join('; ');
    const status = document.getElementById('docs-selection-status');
    if (status) status.textContent = `${result.documents.length} document(s) ready: ${names}${pdfPages ? ` (${pdfPages})` : ''}${errorText ? ` Some files could not be read: ${errorText}` : ''}`;
    if (showChatNotice) addAssistantMessage(`${result.documents.length} document(s) attached for your next prompt. Nexus keeps PDF page numbers with extracted text and can focus on the sections you request. Pages with no selectable text may contain scans or figures that the local text model cannot read; the attachment status lists those pages.${errorText ? ` Some files were skipped: ${errorText}` : ''}`);
}

async function refreshComposioStatus() {
    const status = await ipcRenderer.invoke('composio:status');
    keyVerified = Boolean(status.verified);
    setStatus('composio-key-status', status.message, status.verified ? 'success' : (status.configured ? 'error' : ''));
    if (status.verified) loadIntegrations();
}

function normalize(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function integrationMatch(app) {
    const aliases = [normalize(app.name), ...app.aliases.map(normalize)];
    return liveCatalog.find(toolkit => aliases.includes(normalize(toolkit.slug)) || aliases.includes(normalize(toolkit.name))) ||
        liveCatalog.find(toolkit => aliases.some(alias => alias.length > 4 && (normalize(toolkit.slug).includes(alias) || normalize(toolkit.name).includes(alias))));
}
function accountFor(slug) {
    const matches = connectedAccounts.filter(account => normalize(account.toolkit) === normalize(slug));
    return matches.find(account => account.status === 'ACTIVE') || matches[0] || null;
}

async function loadIntegrations() {
    const status = document.getElementById('integrations-load-status');
    if (status) status.textContent = 'Loading the live Composio catalog…';
    try {
        const result = await ipcRenderer.invoke('composio:catalog');
        keyVerified = Boolean(result.verified);
        if (!result.ok) {
            liveCatalog = [];
            connectedAccounts = [];
            renderIntegrations(result.message || 'Add and verify a Composio API key in Settings to check app support.');
            return;
        }
        liveCatalog = result.apps || [];
        connectedAccounts = result.accounts || [];
        if (status) status.textContent = `${liveCatalog.length} integrations loaded from Composio.`;
        renderIntegrations();
    } catch (error) {
        liveCatalog = [];
        connectedAccounts = [];
        renderIntegrations(`Could not load Composio’s catalog: ${error.message}`);
    }
}

function makeIntegrationCard(app, toolkit, extra = false) {
    const slug = toolkit?.slug || '';
    const account = slug ? accountFor(slug) : null;
    const isConnected = account?.status === 'ACTIVE';
    const isConnecting = account?.status === 'INITIATED' || busyIntegrations.has(slug);
    const isExpired = account && ['EXPIRED', 'FAILED', 'INACTIVE', 'REVOKED'].includes(account.status);
    const isSupported = Boolean(toolkit);
    const card = document.createElement('article');
    card.className = 'integration-card';
    const head = document.createElement('div');
    head.className = 'integration-card-head';
    const icon = document.createElement('div');
    icon.className = 'integration-icon';
    if (toolkit?.logo && /^https:\/\//i.test(toolkit.logo)) {
        const image = document.createElement('img');
        image.src = toolkit.logo;
        image.alt = '';
        image.referrerPolicy = 'no-referrer';
        image.onerror = () => { image.remove(); icon.textContent = app.icon; };
        icon.appendChild(image);
    } else icon.textContent = app.icon;
    const status = document.createElement('span');
    status.className = `integration-status ${isConnected ? 'is-connected' : isExpired ? 'is-expired' : isConnecting ? 'is-connecting' : (!keyVerified ? 'is-unverified' : isSupported ? 'is-available' : 'is-unsupported')}`;
    status.textContent = isConnected ? 'Connected' : isExpired ? 'Expired: connect again' : isConnecting ? 'Connecting' : !keyVerified ? 'Verify key' : isSupported ? (toolkit.noAuth ? 'No sign-in' : 'Not connected') : 'Not in Composio';
    head.append(icon, status);
    const title = document.createElement('h4');
    title.textContent = extra ? (toolkit?.name || app.name) : app.name;
    const desc = document.createElement('p');
    desc.textContent = toolkit?.description || app.description || 'Supported actions depend on the live Composio toolkit.';
    const error = integrationErrors.get(slug);
    if (error) {
        const errorEl = document.createElement('p'); errorEl.className = 'integration-error'; errorEl.textContent = error;
        card.append(head, title, desc, errorEl);
    } else card.append(head, title, desc);
    if (account?.displayName) card.append(h('div', { class: 'account-line', text: account.displayName, title: account.displayName }));
    const actions = document.createElement('div');
    actions.className = 'integration-actions';
    if (/d2l|brightspace/i.test(app.name) && !isConnected) {
        const connect = document.createElement('button'); connect.className = 'integration-button'; connect.textContent = 'Enter school link in School Hub';
        connect.addEventListener('click', () => showView('school', navBtn('school'))); actions.appendChild(connect);
    } else if (isConnected) {
        const disconnect = document.createElement('button');
        disconnect.className = 'integration-button secondary'; disconnect.textContent = 'Disconnect';
        disconnect.textContent = 'Disconnect';
        disconnect.addEventListener('click', () => disconnectIntegration(account)); actions.appendChild(disconnect);
        actions.appendChild(h('button', { type: 'button', class: 'integration-button secondary', text: 'Reconnect', onclick: () => reconnectIntegration(account) }));
    } else if (isExpired) {
        actions.appendChild(h('button', { type: 'button', class: 'integration-button', text: 'Reconnect', onclick: () => reconnectIntegration(account) }));
    } else if (isSupported && !toolkit.noAuth) {
        const connect = document.createElement('button');
        connect.className = 'integration-button';
        connect.textContent = isConnecting ? 'Waiting for authorization…' : 'Connect';
        connect.disabled = isConnecting || !keyVerified;
        connect.addEventListener('click', () => connectIntegration(toolkit)); actions.appendChild(connect);
    } else if (toolkit?.noAuth) {
        const open = document.createElement('button'); open.className = 'integration-button secondary';
        open.textContent = 'Open website';
        open.addEventListener('click', () => ipcRenderer.invoke('open-external-url', app.url || toolkit.appUrl)); actions.appendChild(open);
    } else {
        const unavailable = document.createElement('button'); unavailable.className = 'integration-button secondary';
        unavailable.textContent = keyVerified ? 'Not offered by Composio' : 'Verify key to check'; unavailable.disabled = true; actions.appendChild(unavailable);
    }
    if (isSupported && keyVerified) actions.appendChild(h('button', { type: 'button', class: 'integration-button secondary', text: 'Actions', onclick: () => showToolkitActions(toolkit) }));
    card.appendChild(actions);
    return card;
}

function renderIntegrations(loadMessage = '') {
    const availableGrid = document.getElementById('available-integrations-grid');
    const connectedGrid = document.getElementById('connected-integrations-grid');
    const moreGrid = document.getElementById('more-integrations-grid');
    const search = normalize(document.getElementById('integration-search')?.value);
    const category = document.getElementById('integration-category')?.value || 'all';
    if (!availableGrid || !connectedGrid || !moreGrid) return;
    availableGrid.replaceChildren(); connectedGrid.replaceChildren(); moreGrid.replaceChildren();
    const selected = featuredApps.map(app => ({ app, toolkit: integrationMatch(app) }));
    const connected = selected.filter(({ toolkit }) => toolkit && accountFor(toolkit.slug)?.status === 'ACTIVE');
    const available = selected.filter(({ toolkit }) => !toolkit || accountFor(toolkit.slug)?.status !== 'ACTIVE');
    const extras = keyVerified ? liveCatalog.filter(toolkit => !selected.some(({ toolkit: chosen }) => chosen?.slug === toolkit.slug)).map(toolkit => ({
        app: { name: toolkit.name, aliases: [toolkit.slug], icon: '◈', description: toolkit.description, category: toolkit.categories?.[0] || 'Other', url: toolkit.appUrl }, toolkit
    })) : [];
    const filterItem = ({ app, toolkit }) => {
        const name = normalize(`${app.name} ${toolkit?.name || ''} ${toolkit?.slug || ''} ${app.description} ${(toolkit?.categories || []).join(' ')}`);
        const cats = [...(toolkit?.categories || []), app.category].map(normalize);
        return (!search || name.includes(search)) && (category === 'all' || cats.includes(normalize(category)));
    };
    const filteredConnected = connected.filter(filterItem);
    const filteredAvailable = available.filter(filterItem);
    const filteredExtras = extras.filter(filterItem);
    filteredConnected.forEach(item => connectedGrid.appendChild(makeIntegrationCard(item.app, item.toolkit)));
    filteredAvailable.forEach(item => availableGrid.appendChild(makeIntegrationCard(item.app, item.toolkit)));
    if (showAllIntegrations) filteredExtras.forEach(item => moreGrid.appendChild(makeIntegrationCard(item.app, item.toolkit, true)));
    const connectedSection = document.getElementById('connected-integrations-section');
    if (connectedSection) connectedSection.classList.toggle('hidden', filteredConnected.length === 0);
    const msg = document.getElementById('integrations-load-status');
    if (loadMessage && msg) msg.textContent = loadMessage;
    const moreSection = document.getElementById('more-integrations-section');
    if (moreSection) moreSection.classList.toggle('hidden', !showAllIntegrations);
    const moreButton = document.getElementById('browse-more-integrations');
    if (moreButton) {
        moreButton.classList.toggle('hidden', !keyVerified || extras.length === 0);
        moreButton.textContent = showAllIntegrations ? 'Show featured apps' : `Browse all ${extras.length} more`;
    }
    const noResults = document.getElementById('integrations-no-results');
    if (noResults) noResults.classList.toggle('hidden', filteredConnected.length + filteredAvailable.length + (showAllIntegrations ? filteredExtras.length : 0) > 0);
}

async function connectIntegration(toolkit) {
    const slug = toolkit.slug;
    busyIntegrations.add(slug); integrationErrors.delete(slug); renderIntegrations();
    try {
        const result = await ipcRenderer.invoke('composio:connect', slug);
        if (!result.ok) integrationErrors.set(slug, result.message || 'Could not start authorization.');
        else if (result.status === 'connecting') monitorConnection(slug);
    } catch (error) { integrationErrors.set(slug, error.message); }
    busyIntegrations.delete(slug); renderIntegrations();
}

async function monitorConnection(slug) {
    const started = Date.now();
    while (Date.now() - started < 120000) {
        await new Promise(resolve => setTimeout(resolve, 4000));
        try {
            const result = await ipcRenderer.invoke('composio:catalog');
            if (!result.ok) { integrationErrors.set(slug, result.message); break; }
            connectedAccounts = result.accounts || [];
            const account = accountFor(slug);
            if (account?.status === 'ACTIVE') { integrationErrors.delete(slug); break; }
            if (account && ['FAILED', 'EXPIRED', 'REVOKED'].includes(account.status)) {
                integrationErrors.set(slug, `Composio connection status: ${account.status}. Retry Connect to start a new authorization.`); break;
            }
        } catch (error) { integrationErrors.set(slug, error.message); break; }
        renderIntegrations();
    }
    if (Date.now() - started >= 120000 && accountFor(slug)?.status !== 'ACTIVE') integrationErrors.set(slug, 'Authorization is still pending. Refresh after completing sign-in, or retry if you cancelled it.');
    await loadIntegrations();
}

async function disconnectIntegration(account) {
    if (!await confirmModal('Disconnect', `Disconnect ${account.toolkit}? Nexus will no longer be able to use this account.`, 'Disconnect')) return;
    try {
        const result = await ipcRenderer.invoke('composio:disconnect', account.id);
        if (!result.ok) integrationErrors.set(account.toolkit, result.message);
        await loadIntegrations();
    } catch (error) { integrationErrors.set(account.toolkit, error.message); renderIntegrations(); }
}

async function reconnectIntegration(account) {
    try {
        const result = await call('composio:reconnect', account.id);
        toast(result.message, 'ok');
        if (result.status === 'connecting') monitorConnection(account.toolkit); else await loadIntegrations();
    } catch (error) { integrationErrors.set(account.toolkit, error.message); renderIntegrations(); }
}
async function showToolkitActions(toolkit) {
    const list = h('ul', { class: 'action-list', style: 'max-height:50vh' }, h('li', { text: 'Loading from Composio…' }));
    modal(`${toolkit.name} actions`, h('div', {}, h('p', { class: 'muted small', text: toolkit.description }), list));
    try {
        const result = await call('composio:actions', toolkit.slug);
        list.replaceChildren(...(result.actions.length ? result.actions.map(action => h('li', { title: action.description, text: `${action.name}: ${action.description}` })) : [h('li', { text: 'Composio lists no actions for this app.' })]));
    } catch (error) { list.replaceChildren(h('li', { class: 'error-text', text: error.message })); }
}

let wakeWordActive = false;
let voiceListening = false;
let activeVoiceHandler = null;
let activeVoiceVolumeHandler = null;

let activeVoiceStateHandler = null;
let voiceBackground = false;
let voiceLevelTarget = 0;
let voiceLevelShown = 0;
let voiceLevelFrame = null;

// Levels arrive ten times a second. Easing between them makes the orb jump up with the voice and settle gently.
function animateVoiceLevel() {
    voiceLevelShown += (voiceLevelTarget - voiceLevelShown) * (voiceLevelTarget > voiceLevelShown ? 0.45 : 0.12);
    document.querySelectorAll('[data-voice-orb]').forEach(orb => orb.style.setProperty('--voice-level', voiceLevelShown.toFixed(3)));
    voiceLevelFrame = requestAnimationFrame(animateVoiceLevel);
}

function setVoiceVisualLevel(value) { voiceLevelTarget = Math.min(1, Math.max(0, Number(value) || 0)); }

const VOICE_LABELS = { starting: 'STARTING MIC…', listening: 'LISTENING', transcribing: 'WORKING IT OUT…' };
const VOICE_HINTS = { starting: 'Starting the microphone…', listening: 'Listening… Speak naturally, then pause for about a second. Nexus will send your prompt automatically.', transcribing: 'Working out what you said…' };
const HOLD_LABELS = { ...VOICE_LABELS, listening: 'LET GO TO SEND' };
const HOLD_HINTS = { ...VOICE_HINTS, listening: 'Listening… Keep holding while you talk, then let go to send.' };
let voiceHold = false;

function setVoiceState(state) {
    const listening = state === 'starting' || state === 'listening';
    if (!listening) setVoiceVisualLevel(0);
    if (listening && voiceLevelFrame === null) voiceLevelFrame = requestAnimationFrame(animateVoiceLevel);
    if (!listening && voiceLevelFrame !== null) { cancelAnimationFrame(voiceLevelFrame); voiceLevelFrame = null; voiceLevelShown = 0; }
    document.querySelectorAll('[data-voice-orb]').forEach(orb => {
        orb.classList.toggle('orb-listening', listening);
        orb.classList.toggle('orb-transcribing', state === 'transcribing');
        if (!listening) orb.style.removeProperty('--voice-level');
        const explicit = state && !voiceBackground;
        if (explicit) orb.dataset.voiceLabel = (voiceHold ? HOLD_LABELS : VOICE_LABELS)[state]; else delete orb.dataset.voiceLabel;
        const label = explicit ? 'Let go to send' : 'Hold to speak, then let go to send';
        orb.setAttribute('aria-label', label);
        orb.title = label;
    });
    const indicator = document.querySelector('.voice-listening-indicator');
    if (indicator && VOICE_HINTS[state]) indicator.textContent = (voiceHold ? HOLD_HINTS : VOICE_HINTS)[state];
    if (!state) indicator?.remove();
}

function chatIsOpen() { return !document.getElementById('view-chat')?.classList.contains('hidden'); }

function removeVoiceListeners() {
    if (activeVoiceHandler) ipcRenderer.removeListener('voice-text-result', activeVoiceHandler);
    if (activeVoiceVolumeHandler) ipcRenderer.removeListener('voice-volume-level', activeVoiceVolumeHandler);
    if (activeVoiceStateHandler) ipcRenderer.removeListener('voice-state', activeVoiceStateHandler);
    activeVoiceHandler = null;
    activeVoiceVolumeHandler = null;
    activeVoiceStateHandler = null;
    voiceListening = false;
}

// Background listening runs only while switched on in Settings → Voice. Each phrase is sent for transcription, which the setting discloses.
let wakeTimer = null;
const FOLLOW_UP_SECONDS = 7;
let voiceTurn = false;
let followUpPending = false;
let nexusSpeaking = false;
let speechTimer = null;
// Speech recognition often hears "hey Nexus" as something close, like "hey Lexus" or "a Nexus".
function findWakePhrase(spoken, wakeWord = 'hey nexus') {
    const wake = String(wakeWord || 'hey nexus').toLowerCase().trim();
    const exact = spoken.indexOf(wake);
    if (exact >= 0) return { end: exact + wake.length };
    if (wake !== 'hey nexus') return null;
    const near = /\b(?:hey|hi|hay|a|ok|okay)\s+(?:nexus|nexis|nexxus|nexuses|lexus|nexus's|next us)\b/.exec(spoken);
    return near ? { end: near.index + near[0].length } : null;
}
function scheduleWakeListen() { clearTimeout(wakeTimer); wakeTimer = setTimeout(() => { if (!wakeWordActive) return; if (aiBusy || voiceListening || nexusSpeaking || followUpPending) return scheduleWakeListen(); startVoiceCommand({ background: true }); }, 600); }
function setWakeWordListening(enabled) { wakeWordActive = Boolean(enabled); clearTimeout(wakeTimer); updateWakePill(); if (wakeWordActive) scheduleWakeListen(); else if (voiceListening) stopVoiceCommand(); }
function updateWakePill() {
    let pill = document.getElementById('wake-pill');
    if (!pill) { pill = h('button', { type: 'button', id: 'wake-pill', class: 'status-pill', title: 'Nexus is listening for its wake phrase. Press to stop.', onclick: async () => { await updateSettings({ voice: { wakeWordEnabled: false } }); setWakeWordListening(false); toast('Stopped listening for the wake phrase.'); } }, h('span', { class: 'status-dot-new', dataset: { state: 'ok' } }), h('span', { id: 'wake-pill-text' })); document.getElementById('status-apps')?.before(pill); }
    pill.classList.toggle('hidden', !wakeWordActive);
    const text = document.getElementById('wake-pill-text');
    if (text) text.textContent = `Say "${appSettings?.voice?.wakeWord || 'hey nexus'}"`;
}
// After a spoken request, Nexus answers, waits until it has finished talking, then listens for a follow-up.
function afterReply(response, speak) {
    const fromVoice = voiceTurn;
    voiceTurn = false;
    followUpPending = fromVoice && wakeWordActive && appSettings?.voice?.followUp !== false;
    if (speak && response) {
        nexusSpeaking = true;
        clearTimeout(speechTimer);
        speechTimer = setTimeout(() => { nexusSpeaking = false; continueConversation(); }, 120000);
        ipcRenderer.send('speak-response', response);
    } else continueConversation();
}
function continueConversation() {
    if (!followUpPending || nexusSpeaking) return;
    followUpPending = false;
    if (!wakeWordActive) return;
    if (voiceListening) stopVoiceCommand();
    startVoiceCommand({ followUp: true });
}
ipcRenderer.on('voice-speech-done', () => { nexusSpeaking = false; clearTimeout(speechTimer); continueConversation(); });

// A press this short wasn't speech, so it is treated as a slip rather than sent.
const SHORTEST_HOLD_MS = 350;
let voicePressedAt = 0;
function pressVoiceOrb() {
    if (voicePressedAt || (voiceListening && !voiceBackground)) return;
    voicePressedAt = Date.now();
    startVoiceCommand({ hold: true });
    if (!voiceListening) voicePressedAt = 0;
}
function releaseVoiceOrb() {
    if (!voicePressedAt) return;
    const heldFor = Date.now() - voicePressedAt;
    voicePressedAt = 0;
    if (!voiceListening) return;
    if (heldFor < SHORTEST_HOLD_MS) { stopVoiceCommand(); toast('Hold the button while you talk, then let go.'); return; }
    ipcRenderer.send('finish-voice-recognition');
    setVoiceState('transcribing');
}
function bindVoiceOrbs() {
    document.querySelectorAll('[data-voice-orb]').forEach(orb => {
        orb.addEventListener('pointerdown', event => {
            if (event.button !== 0 && event.pointerType !== 'touch') return;
            event.preventDefault();
            // Capture keeps the release ours even if the pointer drifts off the orb while talking.
            orb.setPointerCapture?.(event.pointerId);
            pressVoiceOrb();
        });
        orb.addEventListener('pointerup', releaseVoiceOrb);
        orb.addEventListener('pointercancel', releaseVoiceOrb);
        orb.addEventListener('keydown', event => {
            if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) { event.preventDefault(); pressVoiceOrb(); }
        });
        orb.addEventListener('keyup', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); releaseVoiceOrb(); } });
        orb.addEventListener('blur', releaseVoiceOrb);
    });
    // Switching windows mid-hold can swallow the release, which would leave the mic on.
    window.addEventListener('blur', releaseVoiceOrb);
}

function stopVoiceCommand() {
    if (!voiceListening) return;
    ipcRenderer.send('stop-voice-recognition');
    removeVoiceListeners();
    setVoiceState('');
    if (wakeWordActive) scheduleWakeListen();
}

// The page stays where it is while the person talks. The prompt only moves to Chat once there is one to send.
function startVoiceCommand({ background = false, hold = false, followUp = false } = {}) {
    if (voiceListening) {
        const wasBackground = voiceBackground;
        stopVoiceCommand();
        if (!wasBackground || background) return;
    }
    if (aiBusy) { const notice = 'Nexus is still answering. Please wait before starting another voice request.'; if (chatIsOpen()) addAssistantMessage(notice); else toast(notice); return; }
    const input = document.getElementById('chat-input');
    voiceBackground = background;
    voiceHold = hold;
    voiceListening = true;
    if (!background && chatIsOpen()) {
        const indicator = document.createElement('div');
        indicator.className = 'message ai-msg voice-listening-indicator';
        document.getElementById('chat-box').appendChild(indicator);
    }
    setVoiceState('starting');
    const handler = (_event, text) => {
        removeVoiceListeners();
        setVoiceState('');
        if (String(text).startsWith('ERROR:')) {
            // A follow-up that hears nothing just ends quietly, back to waiting for the wake phrase.
            if (!background && !followUp) { const message = String(text).slice(6).trim(); if (chatIsOpen()) addAssistantMessage(message); else toast(message); }
            if (wakeWordActive) scheduleWakeListen();
        } else if (String(text).trim()) {
            if (background) {
                const spoken = String(text).toLowerCase().replace(/[,.!?]/g, '');
                const found = findWakePhrase(spoken, appSettings?.voice?.wakeWord);
                if (!found) { scheduleWakeListen(); return; }
                text = spoken.slice(found.end).trim();
                if (!text) { toast('Listening for your request…'); clearTimeout(wakeTimer); setTimeout(() => startVoiceCommand({ followUp: true }), 200); return; }
            }
            go('chat');
            voiceTurn = true;
            input.value = text; sendMessage();
            if (wakeWordActive) scheduleWakeListen();
        } else if (wakeWordActive) scheduleWakeListen();
    };
    activeVoiceVolumeHandler = (_event, level) => setVoiceVisualLevel(level);
    // The button can be let go while the mic is still opening, and that must not turn listening back on.
    activeVoiceStateHandler = (_event, state) => { if (VOICE_LABELS[state] && !(voiceHold && !voicePressedAt && state === 'listening')) setVoiceState(state); };
    activeVoiceHandler = handler;
    ipcRenderer.on('voice-volume-level', activeVoiceVolumeHandler);
    ipcRenderer.on('voice-state', activeVoiceStateHandler);
    ipcRenderer.on('voice-text-result', handler);
    ipcRenderer.send('start-voice-recognition', { hold, wait: followUp ? FOLLOW_UP_SECONDS : undefined });
}

let aiBusy = false;
const CLAIMED_ACTION = /\b(?:i(?:'ve| have)?\s+(?:just\s+|now\s+|successfully\s+)?(?:opened|launched|created|made|organi[sz]ed|moved|renamed|removed|deleted|saved|sent|posted|scheduled|added|set up|cleaned up|tidied)|(?:has|have) been (?:created|made|organi[sz]ed|moved|renamed|removed|deleted|sent|posted|added|set up)|is now (?:organi[sz]ed|set up|tidy))\b/i;
let activeRunId = '';
let chatDocumentIds = [];
let chatDocumentNames = [];

const RUN_LABELS = { completed: 'DONE', in_progress: 'RUNNING', pending: 'PENDING', failed: 'FAILED', declined: 'DECLINED', not_run: 'NOT RUN' };
function renderRunPanel(panel, run) {
    panel.replaceChildren();
    if (!run.plan?.steps?.length && !run.actions?.length && !run.status) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    if (run.plan?.goal) panel.append(h('div', { class: 'run-goal', text: `Task: ${run.plan.goal}` }));
    for (const step of run.plan?.steps || []) panel.append(h('div', { class: 'run-row', dataset: { state: step.status } }, h('span', { class: 'run-mark', text: RUN_LABELS[step.status] || step.status }), h('span', { text: step.title })));
    if (run.plan?.steps?.length && run.actions?.length) panel.append(h('hr', { style: 'border:0;border-top:1px solid var(--border-color);margin:6px 0' }));
    for (const action of run.actions || []) {
        const state = action.running ? 'in_progress' : action.cancelled ? 'declined' : action.ok ? 'completed' : 'failed';
        panel.append(h('div', { class: 'run-row', dataset: { state } }, h('span', { class: 'run-mark', text: RUN_LABELS[state] }), h('span', {}, action.title || action.tool, action.summary ? h('div', { class: 'run-detail', text: action.summary }) : null)));
        if (action.image) panel.append(pictureStrip([action.image]));
    }
    if (run.status) panel.append(h('div', { class: 'run-status', text: run.status }));
}
function setRunning(running) {
    aiBusy = running;
    const button = document.getElementById('send-button');
    if (!button) return;
    button.classList.toggle('is-stop', running);
    button.title = running ? 'Stop generating' : 'Send';
    button.setAttribute('aria-label', button.title);
    button.querySelector('path')?.setAttribute('d', running ? 'M7 7h10v10H7z' : 'M12 19V5m-6 6 6-6 6 6');
}
async function cancelRun() { if (activeRunId) await ipcRenderer.invoke('agent:cancel', activeRunId); }
function setChatDocuments(ids, names) {
    chatDocumentIds = ids; chatDocumentNames = names;
    const scope = document.getElementById('chat-document-scope');
    if (!scope) return;
    scope.classList.toggle('hidden', !ids.length);
    scope.textContent = ids.length ? `Answering from ${ids.length} document${ids.length === 1 ? '' : 's'} ×` : '';
    scope.title = names.join(', ');
    scope.onclick = () => setChatDocuments([], []);
}

async function sendMessage() {
    const input = document.getElementById('chat-input');
    const typed = input?.value.trim();
    const pictures = attachedPictures.slice();
    const text = typed || (pictures.length ? 'What is in this picture?' : '');
    if (!text || aiBusy) return;
    const project = currentProject() || createProject(false);
    setRunning(true);
    const chatBox = document.getElementById('chat-box');
    const documentText = attachedDocumentText;
    const documentNames = attachedDocumentNames.slice();
    const isPracticeTest = /^\s*NEXUS_FULL_PRACTICE_TEST\b/i.test(text);
    const displayContent = isPracticeTest ? `Build a practice test (${text.match(/Subject:\s*([^\r\n]+)/i)?.[1] || 'selected sources'})` : documentNames.length ? `${text}\n\n[Attached: ${documentNames.join(', ')}]` : chatDocumentNames.length ? `${text}\n\n[Using: ${chatDocumentNames.join(', ')}]` : text;
    chatBox.querySelector('.chat-intro')?.remove();
    chatBox.append(h('div', { class: 'message user-msg' }, h('div', { text: displayContent }), pictureStrip(pictures)));
    input.value = ''; input.style.height = 'auto';
    const panel = h('div', { class: 'run-panel hidden' });
    const body = h('div', { class: 'typing-cursor' });
    const thinking = h('div', { class: 'message ai-msg' }, panel, body);
    chatBox.append(thinking); chatBox.scrollTop = chatBox.scrollHeight;
    attachedDocumentText = '';
    attachedDocumentNames = [];
    attachedPictures = [];
    const userMessage = { role: 'user', content: text, displayContent };
    if (pictures.length) userMessage.imagePaths = pictures;
    if (documentText) { userMessage.documentText = documentText; userMessage.documentNames = documentNames; }
    project.messages.push(userMessage);
    if (project.title === 'New project') {
        const practiceSubject = text.match(/^\s*NEXUS_FULL_PRACTICE_TEST\s+Subject:\s*([^\r\n]+)/i);
        project.title = practiceSubject ? `${practiceSubject[1]} practice test` : (text.replace(/\s+/g, ' ').slice(0, 42) || 'New project');
    }
    project.updatedAt = new Date().toISOString();
    saveProjects(); renderProjectList();

    const run = { plan: { steps: [] }, actions: [], status: isPracticeTest ? 'Writing the practice test…' : 'Thinking…' };
    let streamed = '';
    renderRunPanel(panel, run);
    const repaint = () => { body.replaceChildren(); renderFormattedMessage(body, streamed); if (chatBox.scrollHeight - chatBox.scrollTop - chatBox.clientHeight < 200) chatBox.scrollTop = chatBox.scrollHeight; };
    const scheduleRepaint = debounce(repaint, 40);
    const finish = assistantMessage => {
        ipcRenderer.removeListener('agent:event', onEvent);
        body.classList.remove('typing-cursor');
        run.status = '';
        renderRunPanel(panel, run);
        if (run.plan.steps.length || run.actions.length) { assistantMessage.plan = run.plan; assistantMessage.actions = run.actions.map(({ running, ...action }) => action); }
        project.messages.push(assistantMessage);
        project.updatedAt = new Date().toISOString();
        saveProjects(); renderProjectList();
        activeRunId = '';
        setRunning(false);
        chatBox.scrollTop = chatBox.scrollHeight;
    };
    const onEvent = (_event, data) => {
        if (activeRunId && data.runId !== activeRunId) return;
        if (data.type === 'token') { run.status = ''; streamed += data.text; scheduleRepaint(); renderRunPanel(panel, run); }
        else if (data.type === 'reset') { streamed = ''; repaint(); }
        else if (data.type === 'status') { run.status = data.text; renderRunPanel(panel, run); }
        else if (data.type === 'images_seen') { userMessage.imageNotes = data.notes; saveProjects(); }
        else if (data.type === 'plan') { run.plan = { goal: data.goal, steps: data.steps }; renderRunPanel(panel, run); }
        else if (data.type === 'tool_start') { run.status = ''; run.actions.push({ id: data.id, tool: data.name, title: data.title, running: true }); renderRunPanel(panel, run); }
        else if (data.type === 'tool_end') {
            const action = run.actions.find(item => item.id === data.id);
            if (action) Object.assign(action, { running: false, ok: data.ok, cancelled: data.cancelled, summary: data.summary, ...(data.ok && data.card?.kind === 'image' ? { image: data.card.path } : {}) });
            renderRunPanel(panel, run);
            if (data.card?.kind === 'study-guide') PAGE_HOOKS.studyChanged?.();
        } else if (data.type === 'done') {
            const response = data.answer;
            let assistantMessage;
            if (isPracticeTest) {
                const practiceTest = parsePracticeTestResponse(response);
                if (practiceTest) { assistantMessage = { role: 'assistant', content: `Practice test: ${practiceTest.title}`, practiceTest, practiceAnswers: {} }; body.replaceChildren(); renderPracticeTest(body, practiceTest, project, assistantMessage); }
                else { const failure = 'Nexus could not format the full practice test. Try selecting fewer readings or files, then build the test again.'; streamed = failure; repaint(); assistantMessage = { role: 'assistant', content: failure }; }
            } else { streamed = response; repaint(); assistantMessage = { role: 'assistant', content: String(response) }; }
            finish(assistantMessage);
            PAGE_HOOKS.agentFinished?.();
            afterReply(isPracticeTest ? '' : response, !isPracticeTest && document.getElementById('spoken-response-toggle')?.checked);
        } else if (data.type === 'cancelled') {
            streamed = streamed ? `${streamed}\n\n> Stopped.` : 'Stopped before finishing.'; repaint();
            finish({ role: 'assistant', content: streamed });
        } else if (data.type === 'error') {
            streamed = data.message; repaint();
            finish({ role: 'assistant', content: data.message, failed: true });
        }
    };
    ipcRenderer.on('agent:event', onEvent);
    let memoryAction = '';
    try { memoryAction = await processMemoryCommand(text); savedMemories = await ipcRenderer.invoke('memory:list'); }
    catch (error) { memoryAction = `Memory update could not be saved: ${error.message}`; }
    const memory = buildConversationMemory(text, project.id, savedMemories);
    // Failed turns aren't replayed to the model, and bulky practice-test payloads stay out of normal history.
    // An old reply that claimed an action with nothing behind it is marked, or the AI reads it later as something it really did.
    const history = project.messages.slice(-24).filter(message => !message.failed).map(({ role, content, actions, documentText: attached, documentNames: names, imagePaths, imageNotes }, index, list) => ({ ...(index === list.length - 1 && imagePaths?.length ? { imagePaths } : {}), role, content: role === 'user' && imageNotes && index !== list.length - 1 ? `${content}

${imageNotes}` : role === 'assistant' && !(actions || []).some(action => action.ok) && CLAIMED_ACTION.test(String(content || '')) ? `${content}\n\n[Note from Nexus: no action actually ran for this reply, so nothing it describes was done.]` : content, ...(attached ? { documentText: attached, documentNames: names } : {}) }));
    const started = await ipcRenderer.invoke('agent:send', { messages: history, memory, memoryAction, documentIds: chatDocumentIds, workProject: { projectId: project.id, projectTitle: project.title } });
    if (started?.ok === false) { ipcRenderer.removeListener('agent:event', onEvent); streamed = started.message; repaint(); finish({ role: 'assistant', content: started.message, failed: true }); return; }
    activeRunId = started.runId;
}

function addAssistantMessage(text) {
    const box = document.getElementById('chat-box'); if (!box) return;
    const node = document.createElement('div'); node.className = 'message ai-msg'; renderFormattedMessage(node, text); box.appendChild(node); box.scrollTop = box.scrollHeight;
}

async function testConnection() {
    const result = await ipcRenderer.invoke('ollama:test');
    addAssistantMessage(result.ok && !result.installed ? `${result.message} Installed: ${(result.models || []).join(', ') || 'none'}.` : result.message);
}

async function refreshSchoolData() {
    const result = await ipcRenderer.invoke('school:status');
    const input = document.getElementById('d2l-school-url'); if (input && result.url) input.value = result.url;
    const connectionStatus = document.getElementById('d2l-connection-status'); if (connectionStatus) connectionStatus.textContent = result.message;
    await refreshD2LLibrary();
}

async function refreshD2LLibrary(selectIds = []) {
    const select = document.getElementById('d2l-topic-select');
    const status = document.getElementById('d2l-library-status');
    if (!select) return;
    const allItems = await ipcRenderer.invoke('school:library:list');
    const subject = document.getElementById('d2l-subject-select')?.value || 'Science';
    const items = allItems.filter(item => !item.subject || item.subject === subject);
    select.replaceChildren();
    for (const item of items) {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = `${item.kind} · ${item.title}${item.truncated ? ' · excerpt' : ''}`;
        option.title = item.url;
        option.selected = selectIds.includes(item.id);
        select.appendChild(option);
    }
    const filters = document.getElementById('d2l-objective-filters');
    if (filters) {
        filters.replaceChildren();
        const groups = new Map();
        for (const item of items) for (const code of item.objectives || []) {
            const match = String(code).match(/^(\d+)([A-C])$/i);
            if (!match) continue;
            const number = String(Number(match[1]));
            if (!groups.has(number)) groups.set(number, new Set());
            groups.get(number).add(`${number}${match[2].toUpperCase()}`);
        }
        for (const [number, codes] of Array.from(groups.entries()).sort((a, b) => Number(a[0]) - Number(b[0]))) {
            const group = document.createElement('div'); group.className = 'd2l-objective-group';
            const allLabel = document.createElement('label');
            const all = document.createElement('input'); all.type = 'checkbox'; all.dataset.objectiveAll = number;
            const title = document.createElement('strong'); title.textContent = `Objective ${number} (all)`;
            allLabel.append(all, title); group.appendChild(allLabel);
            const children = [];
            for (const code of Array.from(codes).sort()) {
                const label = document.createElement('label');
                const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = code; checkbox.dataset.d2lObjective = 'true';
                const text = document.createElement('span'); text.textContent = code;
                label.append(checkbox, text); group.appendChild(label); children.push(checkbox);
            }
            all.addEventListener('change', () => { children.forEach(child => { child.checked = all.checked; }); });
            children.forEach(child => child.addEventListener('change', () => {
                all.checked = children.every(item => item.checked);
                all.indeterminate = !all.checked && children.some(item => item.checked);
            }));
            filters.appendChild(group);
        }
        if (!groups.size) { const note = document.createElement('span'); note.className = 'update-item'; note.textContent = 'No numbered objectives detected yet. Select course pages/files below, or scan a reading with headings such as 2A, 2B, and 2C.'; filters.appendChild(note); }
    }
    if (status) status.textContent = items.length
        ? `${items.length} ${subject} source(s) saved here (${allItems.length} total across classes). A test can include up to 12 selected sources.`
        : `No ${subject} sources saved yet. Add D2L course content or computer files to this class.`;
}

const D2L_PROGRESS_KEY = 'nexus.d2l.quiz-progress.v1';
function readD2LProgress() {
    try { const value = JSON.parse(localStorage.getItem(D2L_PROGRESS_KEY) || '[]'); return Array.isArray(value) ? value.filter(item => item && (item.correct === true || item.correct === false)).slice(-20) : []; }
    catch { return []; }
}
function renderD2LProgress() {
    const chart = document.getElementById('d2l-progress-chart');
    const status = document.getElementById('d2l-study-status');
    if (!chart) return;
    const entries = readD2LProgress();
    if (!entries.length) {
        chart.replaceChildren();
        if (status) status.textContent = 'No quiz results yet. After answering a question in chat, record whether you got it right or want to review it.';
        return;
    }
    const width = 520, height = 150, pad = 28;
    const points = entries.map((entry, index) => ({
        x: entries.length === 1 ? width / 2 : pad + index * (width - 2 * pad) / (entries.length - 1),
        y: height - pad - (entries.slice(0, index + 1).filter(item => item.correct).length / (index + 1)) * (height - 2 * pad)
    }));
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Running quiz accuracy, from zero to one hundred percent'); svg.style.cssText = 'width:100%;max-width:560px;height:auto;display:block';
    const line = document.createElementNS(ns, 'path');
    line.setAttribute('d', `M ${pad} ${pad} H ${width - pad} M ${pad} ${height - pad} H ${width - pad} M ${pad} ${height / 2} H ${width - pad}`);
    line.setAttribute('stroke', 'rgba(169,182,255,.22)'); line.setAttribute('fill', 'none'); svg.appendChild(line);
    const labels = [['100%', pad + 4], ['50%', height / 2 + 4], ['0%', height - pad + 4]];
    for (const [text, y] of labels) { const t = document.createElementNS(ns, 'text'); t.setAttribute('x', '2'); t.setAttribute('y', String(y)); t.setAttribute('fill', '#9ea9c8'); t.setAttribute('font-size', '11'); t.textContent = text; svg.appendChild(t); }
    const graph = document.createElementNS(ns, 'polyline'); graph.setAttribute('points', points.map(point => `${point.x},${point.y}`).join(' ')); graph.setAttribute('fill', 'none'); graph.setAttribute('stroke', '#8c83ff'); graph.setAttribute('stroke-width', '3'); svg.appendChild(graph);
    points.forEach((point, index) => { const dot = document.createElementNS(ns, 'circle'); dot.setAttribute('cx', String(point.x)); dot.setAttribute('cy', String(point.y)); dot.setAttribute('r', '4'); dot.setAttribute('fill', entries[index].correct ? '#58d6b0' : '#ff8b9b'); svg.appendChild(dot); });
    chart.replaceChildren(svg);
    if (status) { const correct = entries.filter(item => item.correct).length; status.textContent = `${correct} correct out of ${entries.length} recent answers (${Math.round(correct / entries.length * 100)}%).`; }
}
async function addD2LCourseToLibrary() {
    const status = document.getElementById('d2l-connection-status');
    const button = document.getElementById('d2l-read-content');
    if (button) button.disabled = true;
    if (status) status.textContent = 'Scanning the open D2L course and saving readable pages/files…';
    try {
        const subject = document.getElementById('d2l-subject-select')?.value || 'Science';
        const result = await ipcRenderer.invoke('school:read-content', { subject });
        if (!result.ok) { if (status) status.textContent = result.message; return; }
        await refreshD2LLibrary((result.items || []).map(item => item.id));
        if (status) status.textContent = result.message;
    } catch (error) { if (status) status.textContent = `D2L scan failed: ${error.message}`; }
    finally { if (button) button.disabled = false; }
}
async function sendD2LStudyPrompt() {
    if (aiBusy) {
        const busyStatus = document.getElementById('d2l-library-status');
        if (busyStatus) busyStatus.textContent = 'Nexus is finishing the current response. Try starting the quiz again when chat is ready.';
        return;
    }
    const status = document.getElementById('d2l-library-status');
    const select = document.getElementById('d2l-topic-select');
    let selectedIds = Array.from(select?.selectedOptions || []).map(option => option.value);
    const objectives = Array.from(document.querySelectorAll('[data-d2l-objective]:checked')).map(input => input.value);
    const subject = document.getElementById('d2l-subject-select')?.value || 'Science';
    const button = document.getElementById('d2l-start-quiz');
    if (button) button.disabled = true;
    try {
        if (objectives.length && selectedIds.length > 12) selectedIds = [];
        const result = await ipcRenderer.invoke('school:library:selected', { ids: selectedIds, objectives, subject });
        if (!result.ok) { if (status) status.textContent = result.message; return; }
        attachedDocumentText = result.text;
        attachedDocumentNames = [`Nexus study library — ${subject} (${result.count} selected)`];
        showView('chat', navBtn('chat'));
        const input = document.getElementById('chat-input');
        if (!input) return;
        const objectiveText = objectives.length ? objectives.join(', ') : `all selected ${subject} materials`;
        input.value = `NEXUS_FULL_PRACTICE_TEST\nSubject: ${subject}\nSelected objectives: ${objectiveText}\nCreate exactly 10 multiple-choice questions from the attached study source context. Show every question and A-D choices together in an interactive test. Do not reveal the correct answers or explanations before I submit. Every question must be answerable from the selected sources; cite the exact source title for each. Include a graph/data interpretation question only if the selected material supports one.${document.getElementById('d2l-test-instructions')?.value.trim() ? `\nMy instructions for this test: ${document.getElementById('d2l-test-instructions').value.trim().slice(0, 1000)}` : ''}`;
        input.focus(); sendMessage();
    } catch (error) { if (status) status.textContent = `Could not start the D2L quiz: ${error.message}`; }
    finally { if (button) button.disabled = false; }
}
async function clearD2LStudyLibrary() {
    if (!await confirmModal('Clear study library', 'Remove all saved study library items from this computer? Files on your computer and content in D2L are not affected.', 'Clear')) return;
    await ipcRenderer.invoke('school:library:clear');
    await refreshD2LLibrary();
}
async function addLocalFilesToStudyLibrary() {
    const status = document.getElementById('study-local-status');
    const result = await ipcRenderer.invoke('documents:pick');
    if (result.canceled) return;
    if (!result.documents?.length) {
        status.textContent = (result.errors || []).map(item => `${item.name}: ${item.message}`).join(' ') || 'No readable files were selected.';
        return;
    }
    const subject = document.getElementById('d2l-subject-select')?.value || 'Science';
    const saved = await ipcRenderer.invoke('study:library:add-local', { documents: result.documents, subject });
    const errors = (result.errors || []).map(item => `${item.name}: ${item.message}`).join(' ');
    status.textContent = `${saved.message}${errors ? ` Some files could not be read: ${errors}` : ''}`;
    if (saved.ok) await refreshD2LLibrary(saved.added.map(item => item.id));
}
function updateStudyTimer() {
    const status = document.getElementById('study-timer');
    const remaining = Math.max(0, Math.ceil((studyTimerEndsAt - Date.now()) / 1000));
    if (status) status.textContent = remaining
        ? `Study session: ${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')} remaining.`
        : 'Study session complete. Take a short break or start another session.';
    if (!remaining && studyTimerInterval) {
        clearInterval(studyTimerInterval); studyTimerInterval = null;
        finishStudyMode(true);
    }
}
function setDndModeState(enabled) {
    const indicator = document.getElementById('mode-dnd-state');
    const button = document.getElementById('mode-dnd-button');
    if (enabled !== true && enabled !== false) {
        if (indicator) { indicator.className = 'mode-state mode-state-unknown'; indicator.textContent = 'Windows Do Not Disturb: State not confirmed'; }
        if (button) button.textContent = 'Check / change Do Not Disturb';
        return;
    }
    if (indicator) {
        indicator.className = `mode-state ${enabled ? 'mode-state-on' : 'mode-state-off'}`;
        indicator.textContent = `Windows Do Not Disturb: ${enabled ? 'ON' : 'OFF'}`;
    }
    if (button) button.textContent = enabled ? 'Turn Do Not Disturb off' : 'Turn Do Not Disturb on';
}
async function refreshDndModeState() {
    const status = document.getElementById('computer-mode-status');
    const indicator = document.getElementById('mode-dnd-state');
    if (indicator) { indicator.className = 'mode-state mode-state-unknown'; indicator.textContent = 'Windows Do Not Disturb: Checking…'; }
    try {
        const result = await ipcRenderer.invoke('computer-mode:status');
        setDndModeState(result.ok ? result.enabled : null);
        if (status) status.textContent = result.message;
    } catch (error) {
        setDndModeState(null);
        if (status) status.textContent = `Could not read Windows Do Not Disturb state: ${error.message}`;
    }
}
async function finishStudyMode(completed) {
    const status = document.getElementById('study-timer');
    const stop = document.getElementById('study-timer-stop');
    if (completed && status) status.textContent = 'Study session complete. Take a short break or start another session.';
    if (stop) stop.disabled = true;
    if (studyModeOwnsDnd) {
        const result = await ipcRenderer.invoke('computer-mode:end-study', true);
        const modeStatus = document.getElementById('computer-mode-status');
        if (modeStatus) modeStatus.textContent = result.message;
        setDndModeState(result.enabled);
    }
    studyModeOwnsDnd = false;
}
function endStudyTimer() {
    if (studyTimerInterval) clearInterval(studyTimerInterval);
    studyTimerInterval = null; studyTimerEndsAt = 0;
    const status = document.getElementById('study-timer');
    if (status) status.textContent = 'No study session running.';
    finishStudyMode(false);
}
async function activateComputerMode(mode) {
    const status = document.getElementById('computer-mode-status');
    const button = document.getElementById(mode === 'dnd' ? 'mode-dnd-button' : mode === 'study' ? 'mode-study-button' : 'mode-youtube-button');
    if (button) button.disabled = true;
    try {
        const result = await ipcRenderer.invoke('computer-mode:activate', mode);
        if (status) status.textContent = result.message || (result.ok ? 'Mode ready.' : 'Nexus could not start that mode.');
        if (mode === 'dnd') setDndModeState(result.ok ? result.enabled : null);
        if (mode === 'study' && result.ok) {
            if (studyTimerInterval) clearInterval(studyTimerInterval);
            studyModeOwnsDnd = studyModeOwnsDnd || result.dndChanged;
            setDndModeState(result.enabled);
            studyTimerEndsAt = Date.now() + 25 * 60 * 1000;
            studyTimerInterval = setInterval(updateStudyTimer, 1000);
            document.getElementById('study-timer-stop').disabled = false;
            updateStudyTimer();
        }
    } catch (error) {
        if (status) status.textContent = `Could not start this mode: ${error.message}`;
    } finally { if (button) button.disabled = false; }
}
async function saveD2LSchoolUrl() {
    const input = document.getElementById('d2l-school-url');
    const status = document.getElementById('d2l-connection-status');
    const save = document.getElementById('d2l-save-url');
    if (save) save.disabled = true;
    const result = await ipcRenderer.invoke('school:save-url', input?.value || '');
    if (save) save.disabled = false;
    if (status) status.textContent = result.message;
    if (result.ok && input) input.value = result.url;
}
async function openD2LLogin() {
    const status = document.getElementById('d2l-connection-status');
    const result = await ipcRenderer.invoke('school:open');
    if (status) status.textContent = result.message;
}
function recordD2LQuizResult(correct) {
    const entries = readD2LProgress(); entries.push({ correct, at: new Date().toISOString() });
    localStorage.setItem(D2L_PROGRESS_KEY, JSON.stringify(entries.slice(-20)));
    renderD2LProgress();
}
async function clearCurrentChat() {
    if (aiBusy) { toast('Wait for Nexus to finish its current response first.'); return; }
    const project = currentProject();
    if (!project || (!project.messages?.length && !attachedDocumentText)) return;
    if (!await confirmModal('Clear chat', 'Clear the messages in this chat? The conversation stays in your list.', 'Clear')) return;
    project.messages = [];
    project.updatedAt = new Date().toISOString();
    attachedDocumentText = ''; attachedDocumentNames = [];
    saveProjects(); renderProjectList(); renderProjectMessages(); updateMemorySettings();
}

function bindIntegrationControls() {
    document.getElementById('d2l-save-url')?.addEventListener('click', saveD2LSchoolUrl);
    document.getElementById('d2l-open-login')?.addEventListener('click', openD2LLogin);
    document.getElementById('d2l-school-url')?.addEventListener('keydown', event => { if (event.key === 'Enter') saveD2LSchoolUrl(); });
    document.getElementById('d2l-read-content')?.addEventListener('click', addD2LCourseToLibrary);
    document.getElementById('study-add-local-files')?.addEventListener('click', addLocalFilesToStudyLibrary);
    document.getElementById('d2l-subject-select')?.addEventListener('change', () => refreshD2LLibrary());
    document.getElementById('d2l-start-quiz')?.addEventListener('click', sendD2LStudyPrompt);
    document.getElementById('d2l-clear-library')?.addEventListener('click', clearD2LStudyLibrary);
    document.getElementById('d2l-record-correct')?.addEventListener('click', () => recordD2LQuizResult(true));
    document.getElementById('d2l-record-review')?.addEventListener('click', () => recordD2LQuizResult(false));
    document.getElementById('mode-dnd-button')?.addEventListener('click', () => activateComputerMode('dnd'));
    document.getElementById('mode-study-button')?.addEventListener('click', () => activateComputerMode('study'));
    document.getElementById('mode-youtube-button')?.addEventListener('click', () => activateComputerMode('youtube'));
    document.getElementById('study-timer-stop')?.addEventListener('click', endStudyTimer);
    document.getElementById('clear-current-chat-button')?.addEventListener('click', clearCurrentChat);
    renderD2LProgress();
    const browserOpen = document.getElementById('nexus-browser-open');
    browserOpen?.addEventListener('click', async () => {
        const status = document.getElementById('nexus-browser-status');
        browserOpen.disabled = true;
        if (status) status.textContent = 'Starting hidden Opera GX research…';
        const result = await ipcRenderer.invoke('browser:open', document.getElementById('nexus-browser-url')?.value);
        browserOpen.disabled = false;
        if (status) status.textContent = result.ok ? `Research page ready · ${result.title || result.url}` : result.message;
    });
    document.getElementById('nexus-browser-url')?.addEventListener('keydown', event => { if (event.key === 'Enter') browserOpen?.click(); });
    document.getElementById('nexus-browser-chat')?.addEventListener('click', () => showView('chat', navBtn('chat')));
    bindVoiceOrbs();
    document.getElementById('integration-search')?.addEventListener('input', () => renderIntegrations());
    document.getElementById('integration-category')?.addEventListener('change', () => renderIntegrations());
    document.getElementById('integrations-refresh')?.addEventListener('click', () => loadIntegrations());
    document.getElementById('browse-more-integrations')?.addEventListener('click', () => { showAllIntegrations = !showAllIntegrations; renderIntegrations(); });
    document.getElementById('composio-key-save')?.addEventListener('click', saveComposioKey);
    document.getElementById('composio-key-reveal')?.addEventListener('click', () => {
        const input = document.getElementById('composio-key-input');
        const button = document.getElementById('composio-key-reveal');
        if (!input || !button) return;
        const reveal = input.type === 'password';
        input.type = reveal ? 'text' : 'password';
        button.setAttribute('aria-label', reveal ? 'Hide API key' : 'Show API key');
        button.title = reveal ? 'Hide API key' : 'Show API key';
        input.focus();
    });
    document.getElementById('composio-key-input')?.addEventListener('keydown', event => { if (event.key === 'Enter') saveComposioKey(); });
    document.getElementById('composio-key-remove')?.addEventListener('click', async () => { if (!await confirmModal('Remove key', 'Remove the saved Composio key from this computer?', 'Remove')) return; const result = await call('composio:remove-key'); setStatus('composio-key-status', result.message); keyVerified = false; liveCatalog = []; connectedAccounts = []; renderIntegrations(); });
    const chatInput = document.getElementById('chat-input');
    chatInput?.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } });
    chatInput?.addEventListener('input', () => { chatInput.style.height = 'auto'; chatInput.style.height = `${Math.min(150, chatInput.scrollHeight)}px`; });
    document.getElementById('send-button')?.addEventListener('click', () => { if (aiBusy) cancelRun(); else sendMessage(); });
    document.getElementById('document-access-button')?.addEventListener('click', async () => {
        await attachLocalDocuments(true);
    });
    document.getElementById('stop-speaking-button')?.addEventListener('click', () => ipcRenderer.send('stop-speaking'));
    document.getElementById('new-project-button')?.addEventListener('click', () => createProject(true));
    document.getElementById('projects-search')?.addEventListener('input', () => renderProjectList());
    document.getElementById('task-add-form')?.addEventListener('submit', async event => {
        event.preventDefault();
        const input = document.getElementById('task-input');
        const text = input?.value.trim();
        if (!text) return;
        const project = currentProject();
        const due = document.getElementById('task-due'); const priority = document.getElementById('task-priority'); const category = document.getElementById('task-category');
        await ipcRenderer.invoke('tasks:create', { title: text, projectId: project?.id, projectTitle: project?.title || 'General', dueDate: due?.value || '', priority: priority?.value, category: category?.value || '' });
        await persistTasks(); renderTasks(); input.value = ''; if (due) due.value = ''; if (category) category.value = ''; input.focus();
    });
    document.getElementById('organize-project-button')?.addEventListener('click', () => {
        showView('chat', navBtn('chat'));
        const input = document.getElementById('chat-input');
        if (input) {
            input.value = 'Organize this project for me. Review our conversation and existing tasks, propose clear milestones in the right order, add or update the project checklist without duplicates, and mark the first real next step in progress. Then summarize the goal, plan, and next action in a clear format.';
            input.focus();
            sendMessage();
        }
    });
}

