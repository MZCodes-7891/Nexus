const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, Notification, Tray, Menu, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

if (process.env.NEXUS_USER_DATA) app.setPath('userData', process.env.NEXUS_USER_DATA);
// Automated tests must never write into the real Documents or Downloads folders.
if (process.env.NEXUS_TEST) { app.setPath('documents', path.join(os.homedir(), 'Documents')); app.setPath('downloads', path.join(os.homedir(), 'Downloads')); app.setPath('desktop', path.join(os.homedir(), 'Desktop')); }
const dataDir = app.getPath('userData');
const rootDir = __dirname;

const { JsonStore, CollectionStore } = require('./backend/core/store');
const { Settings } = require('./backend/core/settings');
const { createLogger, redact } = require('./backend/core/logger');
const { createPermissions, createFileGuard } = require('./backend/core/permissions');
const { runPythonJson, checkHelpers } = require('./backend/core/python');
const { parseWhen } = require('./backend/core/when');
const { createModelManager } = require('./backend/ai/providers');
const { ToolRegistry } = require('./backend/ai/toolRegistry');
const { createChat } = require('./backend/ai/chat');
const { createLauncher } = require('./backend/apps/launcher');
const { createFiles } = require('./backend/computer/files');
const { createWindowsDnd } = require('./backend/computer/windowsDnd');
const { createBrowser, detectBrowsers } = require('./backend/browser/browser');
const { createComposio } = require('./backend/integrations/composio');
const { createDocumentLibrary, SUPPORTED } = require('./backend/documents/library');
const { readDocument } = require('./backend/documents/reader');
const { createMemory, createTasks, createCalendar } = require('./backend/productivity/productivity');
const { createHub } = require('./backend/integrations/hub');
const { createPhoneController } = require('./backend/integrations/phone');
const { createImages, isImagePath, IMAGE_TYPES } = require('./backend/ai/images');
const { createUpdater } = require('./backend/core/updater');
const { findTopics, materialFor } = require('./backend/study/topics');
const curriculum = require('./backend/study/curriculum');
const { createWritingStyle } = require('./backend/productivity/writingStyle');
const { createDiscordBot } = require('./backend/integrations/discordBot');
const { createSpotify } = require('./backend/integrations/spotify');
const { createSuggestionInbox } = require('./backend/integrations/suggestions');
const { createClaudeRunner } = require('./backend/integrations/claudeRunner');
const { createWebInfo } = require('./backend/integrations/webinfo');
const { createSmartHome } = require('./backend/integrations/smarthome');
const { parseSearch, matchesWords, inDates } = require('./backend/core/search');
const { buildSuggestions } = require('./backend/productivity/suggestions');
const { createAutoMemory } = require('./backend/productivity/autoMemory');
const { createStudy, d2lReadingLength, cleanD2LText, sourcesInMaterial } = require('./backend/study/study');
const { createResearch } = require('./backend/research/research');
const { createAutomations } = require('./backend/automations/automations');
const { createVoice } = require('./backend/voice/voice');
const { createD2L, courseNameFrom } = require('./backend/school/d2l');
const { buildTools } = require('./backend/tools');
const { createSetup } = require('./backend/system/setup');

let mainWindow = null;
let tray = null;
let quitting = false;
let studyDndOwned = false;

const settings = new Settings(path.join(dataDir, 'settings.json'));
const getSettings = () => settings.get();
const logger = createLogger({ logDir: path.join(dataDir, 'logs'), isDebug: () => getSettings().advanced.debug });
const send = (channel, ...args) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args); };
const secretFile = name => path.join(dataDir, `${name}.enc`);

const setup = () => setupService;
// The endpoint API key is kept encrypted by Windows and is never sent back to the page.
let aiApiKey = '';
async function loadAiKey() {
  try { aiApiKey = (await safeStorage.decryptStringAsync(await fs.promises.readFile(secretFile('ai-api-key')))).result; } catch { aiApiKey = ''; }
}
const models = createModelManager({ getConfig: () => ({ ...getSettings().ai, apiKey: aiApiKey }) });

async function confirmAction({ title, message, detail }) {
  // A request sent from the phone is approved from the phone, since nobody may be at the PC.
  if (phone?.isRunning()) return phone.confirm({ message: [message, /^\s*[{[]/.test(detail || '') ? '' : detail].filter(Boolean).join(' ') || title });
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (!mainWindow.isVisible()) mainWindow.show();
  const choice = await dialog.showMessageBox(mainWindow, { type: 'question', title, message, detail, buttons: ['Cancel', 'Allow'], defaultId: 0, cancelId: 0, noLink: true });
  return choice.response === 1;
}
const setupService = createSetup({ models, getSettings, updateSettings: changes => settings.update(changes), send });
let phone = null;
const permissions = createPermissions({ getSettings, confirm: confirmAction, logger });
const guard = createFileGuard({ getSettings, dataDir });
const files = createFiles({ guard });
const setWindowsDoNotDisturb = createWindowsDnd({ dataDir });
const openExternal = url => shell.openExternal(url);
const openPath = target => shell.openPath(target);
const standardFolder = name => app.getPath(String(name).toLowerCase());

const browser = createBrowser({ dataDir, getPreferred: () => getSettings().browser.preferred, downloadsDir: path.join(app.getPath('downloads'), 'Nexus') });
const composio = createComposio({ dataDir, safeStorage, openExternal, logger, blockChanges: Boolean(process.env.NEXUS_TEST) });
const documents = createDocumentLibrary({ dataDir, rootDir, guard, embed: (model, input, signal) => models.embed(model, input, signal), getEmbeddingModel: () => getSettings().ai.embeddingModel, logger });
const extractPdfText = (filePath, limit) => readDocument(rootDir, filePath, limit);
const school = createD2L({ dataDir, ipcMain, getBrowserExecutables: () => browser.order(), extractPdfText, extractOffice: extractPdfText });
const launcher = createLauncher({ dataDir, openExternal, openPath, getSchoolUrl: async () => (await school.readD2LSettings()).url, emitChange: () => send('apps:changed') });
const memory = createMemory({ dataDir });
const tasks = createTasks({ dataDir });
const notifications = new CollectionStore(path.join(dataDir, 'notifications.json'));
async function notify({ title, body, kind = 'info', id = '' }) {
  const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title: String(title).slice(0, 140), body: String(body || '').slice(0, 400), kind, sourceId: id, at: new Date().toISOString(), read: false };
  await notifications.update(items => [entry, ...items].slice(0, 100));
  if (getSettings().general.notifications && Notification.isSupported()) {
    const notice = new Notification({ title: entry.title, body: entry.body });
    notice.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
    notice.show();
  }
  send('notifications:new', entry);
  return entry;
}
const calendar = createCalendar({ dataDir, notify });
const updater = createUpdater({ app, getSettings, notify, send, logger });
const study = createStudy({ dataDir, models });
const writingStyle = createWritingStyle({ dataDir, models });
const research = createResearch({ dataDir, models });
const voice = createVoice({ rootDir, getSettings, logger });
const registry = new ToolRegistry();

// Gathers what the user saved on a topic from both the study library and the document library.
async function findStudyMaterial(topic, subject) {
  const items = (await school.readLibraryForTopic(topic, subject)).filter(item => item.provider === 'local' || d2lReadingLength(item.text) >= 200).map(item => (item.provider === 'local' ? item : { ...item, text: cleanD2LText(item.text) })).slice(0, 12);
  const hits = await documents.search(`${topic} ${subject || ''}`, { limit: 24 });
  const names = [...items.map(item => item.title), ...new Set(hits.map(hit => hit.name))];
  const parts = [...items.map(item => `SOURCE: ${item.title}\n${item.text}`), ...hits.map(hit => `SOURCE: ${hit.name}${hit.location ? `, ${hit.location}` : ''}\n${hit.text}`)];
  return { names, text: parts.join('\n\n') };
}
async function materialFromSelection({ documentIds = [], libraryIds = [] } = {}) {
  const names = [];
  const parts = [];
  for (const id of documentIds.slice(0, 20)) {
    const doc = await documents.get(id);
    if (!doc) continue;
    const { text } = await documents.readText(id, 400000);
    names.push(doc.name); parts.push(`SOURCE: ${doc.name}\n${text}`);
  }
  const library = await school.readD2LLibrary();
  for (const id of libraryIds.slice(0, 20)) {
    const item = library.find(entry => entry.id === id);
    // Menus and viewer controls saved with a D2L page must not reach the model, or it writes questions about them.
    if (item && (item.provider === 'local' || d2lReadingLength(item.text) >= 200)) { names.push(item.title); parts.push(`SOURCE: ${item.title}\n${item.provider === 'local' ? item.text : cleanD2LText(item.text)}`); }
  }
  return { names, text: parts.join('\n\n') };
}

const images = createImages({ models, getSettings, outDir: path.join(app.getPath('documents'), 'Nexus', 'Images') });
// Pictures picked in the file window may come from anywhere; any other picture path must be inside the allowed folders.
const pickedPictures = new Set();
const chatImages = { ...images, readImage: file => { if (!pickedPictures.has(path.resolve(String(file || '')))) guard.resolve(file); return images.readImage(file); } };
const chat = createChat({ models, registry, permissions, logger, getSettings, dataDir, path, images: chatImages, retrieveForChat: (query, ids) => documents.retrieveContext(query, ids) });

// Automations' prompt steps run the same agent as chat and wait for its final answer.
function runPromptHeadless(prompt) {
  return new Promise((resolve, reject) => {
    chat.start({ messages: [{ role: 'user', content: prompt }], workProject: { projectTitle: 'Automation' } }, event => {
      if (event.type === 'done') resolve(event.answer);
      else if (event.type === 'error') reject(new Error(event.message));
      else if (event.type === 'cancelled') reject(new Error('Cancelled.'));
    }).catch(reject);
  });
}
const automations = createAutomations({ dataDir, registry, permissions, models, runPrompt: runPromptHeadless, notify, logger, getDownloadsDir: () => app.getPath('downloads'), confirm: confirmAction });

const webInfo = createWebInfo();
const smartHome = createSmartHome({ dataDir, safeStorage, getUrl: () => getSettings().smartHome.url, setUrl: url => settings.update({ smartHome: { url } }) });
// These are created further down, once the app's handlers exist, and are only used when a tool actually runs.
const lateHub = { run: (...args) => hub.run(...args) };
const lateSuggestions = { check: () => suggestionInbox.check(), status: () => suggestionInbox.status(), addRequest: async request => { const result = await suggestionInbox.addRequest(request); if (result.ok) claudeRunner.drain(); return result; } };
registry.registerAll(buildTools({ images, writingStyle, hub: lateHub, suggestions: lateSuggestions, webInfo, smartHome, composio, notify, importAssignments: () => importD2LAssignments(), launcher, files, browser, documents, tasks, calendar, memory, research, study, automations, school, guard, getSettings, openExternal, openPath, rootDir, findStudyMaterial, documentsFolder: standardFolder, navigate: (view, extra) => send('nav:go', view, extra) }));
registry.addDynamicProvider(context => composio.sessionTools(context));
// Lets automated tests call a tool directly. Never set in normal use.
if (process.env.NEXUS_TEST) globalThis.__nexus = { registry, composio, get phone() { return phone; }, chat };

// Every handler returns { ok:false, message } on failure rather than rejecting, so the page can always show a reason.
function handle(channel, handler) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try { return await handler(...args); }
    catch (error) { logger.warn(`${channel} failed: ${error.message}`); return { ok: false, message: redact(String(error.message || error)).slice(0, 600) }; }
  });
}

// Settings
handle('settings:get', async () => ({ settings: getSettings(), hasAiKey: Boolean(aiApiKey), dataDir, version: app.getVersion() }));
handle('settings:update', async changes => {
  const next = await settings.update(changes);
  applyStartupSetting(next);
  return { ok: true, settings: next };
});
handle('settings:save-ai-key', async key => {
  const value = String(key || '').trim();
  if (!value) { await fs.promises.unlink(secretFile('ai-api-key')).catch(() => {}); aiApiKey = ''; return { ok: true, hasAiKey: false, message: 'The API key was removed.' }; }
  if (!await safeStorage.isAsyncEncryptionAvailable()) return { ok: false, message: 'Windows secure storage is unavailable, so the key was not saved.' };
  await fs.promises.writeFile(secretFile('ai-api-key'), await safeStorage.encryptStringAsync(value), { mode: 0o600 });
  aiApiKey = value;
  return { ok: true, hasAiKey: true, message: 'The API key was saved securely.' };
});
handle('settings:pick-folder', async () => { const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] }); return result.canceled ? { canceled: true } : { canceled: false, path: result.filePaths[0] }; });
handle('settings:pick-script', async () => { const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Scripts', extensions: ['ps1', 'py', 'bat', 'cmd'] }] }); return result.canceled ? { canceled: true } : { canceled: false, path: result.filePaths[0] }; });
function applyStartupSetting(next) {
  if (app.isPackaged || process.env.NEXUS_ALLOW_LOGIN_ITEM) app.setLoginItemSettings({ openAtLogin: next.general.launchAtLogin, args: next.general.startMinimized ? ['--minimized'] : [] });
}

// First-run setup
handle('setup:status', () => setup().status());
handle('setup:install-ollama', () => setup().installOllama());
handle('setup:pull-model', name => setup().pullModel(name));
handle('setup:cancel', () => setup().cancel());
handle('setup:finish', async name => { await setup().finish(name); return { ok: true }; });

// AI
ipcMain.handle('ollama:test', () => models.test());
handle('ai:models', async () => ({ ok: true, models: await models.listModels(), current: getSettings().ai.model }));
handle('ai:capabilities', async model => models.capabilities(model || getSettings().ai.model));
const autoMemory = createAutoMemory({ models, memory, getSettings, logger });
// Once a reply is done, anything lasting the person said is saved in the background, and the page is told what.
handle('agent:send', async payload => chat.start(payload, event => {
  send('agent:event', event);
  if (event.type !== 'done') return;
  const said = [...(Array.isArray(payload?.messages) ? payload.messages : [])].reverse().find(message => message?.role === 'user')?.content;
  autoMemory.fromMessage(said).then(saved => { if (saved.length) send('memory:learned', saved); }).catch(error => logger.warn(`auto memory failed: ${error.message}`));
}));
handle('agent:cancel', async runId => ({ ok: chat.cancel(runId) }));
handle('agent:runs', async () => chat.runs.list());
// Lets the Study Center and others stream plain model replies without going through the tool agent.
handle('ai:tools', async () => registry.list().map(tool => ({ name: tool.name, title: tool.title || tool.name, category: tool.category, risk: tool.risk, description: tool.description, parameters: tool.parameters, agentOnly: Boolean(tool.agentOnly) })));

// Starts Ollama if it is installed but not running, and only when the setting allows it.
let ollamaStartTried = false;
async function ensureOllama() {
  const ai = getSettings().ai;
  if (ai.provider !== 'ollama' || !ai.autoStartOllama || ollamaStartTried || !/127\.0\.0\.1|localhost/.test(ai.baseUrl)) return;
  const status = await models.test();
  if (status.ok) return;
  ollamaStartTried = true;
  const candidate = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe');
  const child = spawn(fs.existsSync(candidate) ? candidate : 'ollama', ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', error => logger.info(`Ollama could not be started automatically: ${error.message}`));
  child.unref();
}

// Conversations move from page storage to a file: page storage has a small quota, and large attachments were silently failing to save.
const conversations = new JsonStore(path.join(dataDir, 'conversations.json'), null);
handle('conversations:load', async () => conversations.read());
handle('conversations:save', async data => { await conversations.write({ projects: Array.isArray(data?.projects) ? data.projects : [], activeProjectId: String(data?.activeProjectId || '') }); return { ok: true }; });

// Tasks
handle('tasks:initialize', legacy => tasks.initialize(legacy));
handle('tasks:list', () => tasks.list());
handle('tasks:create', input => tasks.create(input));
handle('tasks:update', input => tasks.update(input));
handle('tasks:delete', id => tasks.remove(id));

// Memory
handle('memory:list', () => memory.list());
handle('memory:remember', (text, category) => memory.remember(text, category));
handle('memory:forget', text => memory.forget(text));
handle('memory:edit', (id, changes) => memory.edit(id, changes));
handle('memory:remove', id => memory.remove(id));
handle('memory:search', query => memory.search(query));
handle('memory:clear', async () => { await memory.clear(); return { ok: true }; });

// Composio
ipcMain.handle('composio:status', () => composio.status());
ipcMain.handle('composio:save-key', (_event, key) => composio.saveKey(key));
handle('composio:remove-key', () => composio.removeKey());
ipcMain.handle('composio:catalog', (_event, options) => composio.catalog(options));
ipcMain.handle('composio:connect', (_event, slug) => composio.connect(slug));
ipcMain.handle('composio:disconnect', (_event, id) => composio.disconnect(id));
ipcMain.handle('composio:reconnect', (_event, id) => composio.reconnect(id));
ipcMain.handle('composio:actions', (_event, slug) => composio.toolkitActions(slug));
const discordBot = createDiscordBot({ dataDir, safeStorage, ...(process.env.NEXUS_TEST && process.env.NEXUS_DISCORD_API ? { apiBase: process.env.NEXUS_DISCORD_API } : {}) });
const spotify = createSpotify({ dataDir, safeStorage, openExternal: url => openExternal(url), ...(process.env.NEXUS_TEST && process.env.NEXUS_SPOTIFY_ACCOUNTS ? { accountsBase: process.env.NEXUS_SPOTIFY_ACCOUNTS, apiBase: process.env.NEXUS_SPOTIFY_API, port: Number(process.env.NEXUS_SPOTIFY_PORT) } : {}) });
const hub = createHub({ composio, confirm: details => confirmAction(details), discord: discordBot, spotify });
handle('hub:spotify-status', () => spotify.status());
handle('hub:spotify-connect', clientId => spotify.connect(clientId));
handle('hub:spotify-disconnect', () => spotify.disconnect());
handle('hub:discord-status', () => discordBot.status());
handle('hub:discord-connect', token => discordBot.connect(token));
handle('hub:discord-disconnect', () => discordBot.disconnect());
handle('hub:accounts', () => hub.accounts());
handle('hub:run', (id, args) => hub.run(id, args));
handle('hub:run-any', input => hub.runAny(input));
handle('hub:action-list', () => hub.actionList());
const suggestionsFolder = (process.env.NEXUS_TEST && process.env.NEXUS_SUGGESTIONS_FOLDER) || path.join(app.getPath('documents'), 'Nexus', 'Game Suggestions');
const suggestionInbox = createSuggestionInbox({ hub, folder: suggestionsFolder });
handle('hub:suggestions', () => suggestionInbox.status());
const claudeRunner = createClaudeRunner({ inbox: suggestionInbox, hub, folder: suggestionsFolder, notify, logger });
handle('hub:suggestions-check', async () => { const result = await suggestionInbox.check(); claudeRunner.drain(); return result; });
handle('hub:suggestions-retry', async (id, options) => { const result = await suggestionInbox.retry(id, { approved: Boolean(options?.approved) }); if (result.ok) claudeRunner.drain(); return result; });
handle('hub:suggestions-folder', () => shell.openPath(suggestionsFolder));
// Looks for pings once a minute while Nexus runs. With no bot set up this does nothing.
async function pollSuggestions() {
  await suggestionInbox.check().catch(() => null);
  claudeRunner.drain();
}
if (!process.env.NEXUS_TEST) { setTimeout(pollSuggestions, 15000); setInterval(pollSuggestions, 60000); }
// Phone control: the linked person's direct messages to the bot run through the same agent, and the answer goes back in the DM.
function runPhoneRequest(messages) {
  return new Promise(resolve => {
    const made = [];
    let test = '';
    chat.start({ messages, workProject: { projectTitle: 'Phone' } }, event => {
      if (event.type === 'tool_end' && event.ok && event.card?.kind === 'image') made.push(event.card.path);
      if (event.type === 'tool_end' && event.ok && event.card?.kind === 'practice-test') test = event.card.id;
      if (event.type === 'done') {
        resolve({ answer: event.answer, images: made, test });
        autoMemory.fromMessage(messages.at(-1)?.content).then(saved => { if (saved.length) send('memory:learned', saved); }).catch(() => {});
      } else if (event.type === 'error') resolve({ answer: `That didn't work: ${event.message}` });
      else if (event.type === 'cancelled') resolve({ answer: 'That was stopped on the PC.' });
    }).then(started => { if (started?.ok === false) resolve({ answer: started.message || 'Nexus could not start that.' }); }).catch(error => resolve({ answer: `That didn't work: ${error.message}` }));
  });
}
phone = createPhoneController({ hub, runAgent: runPhoneRequest, dataDir, logger, study });
handle('hub:phone-status', () => phone.status());
handle('hub:phone-link', (userId, name) => phone.link(userId, name));
handle('hub:phone-unlink', () => phone.unlink());
// People the bot can see in its servers, so the right account can be picked from a list.
handle('hub:phone-people', async () => {
  const servers = await hub.run('discord.servers');
  if (!servers.ok) return servers;
  const people = new Map();
  for (const server of (servers.data || []).slice(0, 10)) {
    const members = await hub.run('discord.members', { serverId: server.id });
    for (const member of (members.ok ? members.data : [])) if (member.user && !member.user.bot) people.set(member.user.id, member.nick || member.user.global_name || member.user.username || member.user.id);
  }
  return { ok: true, people: [...people].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)) };
});
if (!process.env.NEXUS_TEST) setInterval(() => phone.poll(), 8000);
handle('calendar:google-sync', async () => {
  const accounts = await composio.activeAccounts();
  if (!accounts.some(account => /googlecalendar/i.test(account.toolkit))) return { ok: false, message: 'Connect Google Calendar in Connected Apps first.' };
  const result = await composio.execute('GOOGLECALENDAR_EVENTS_LIST', { timeMin: new Date().toISOString(), timeMax: new Date(Date.now() + 60 * 86400000).toISOString(), maxResults: 100, singleEvents: true, orderBy: 'startTime' });
  const items = result?.data?.items || result?.data?.response_data?.items || [];
  return { ok: true, events: items.map(event => ({ id: event.id, title: event.summary || '(no title)', start: event.start?.dateTime || event.start?.date, end: event.end?.dateTime || event.end?.date, kind: 'event', source: 'google' })).filter(event => event.start) };
});

// Browser
handle('browser:open', async (url, visible) => browser.open(url || 'https://www.google.com', Boolean(visible)));
handle('browser:status', async () => ({ ...browser.status(), browsers: detectBrowsers() }));

// Computer modes (kept from the original app)
ipcMain.handle('computer-mode:activate', async (_event, mode) => {
  if (mode === 'dnd') {
    const result = await setWindowsDoNotDisturb('toggle');
    return result.ok ? { ...result, message: `Do Not Disturb is ${result.enabled ? 'on' : 'off'} for Windows notifications.` } : result;
  }
  if (mode === 'study') {
    const result = await setWindowsDoNotDisturb(true);
    if (!result.ok) return result;
    studyDndOwned = studyDndOwned || result.changed;
    automations.fireTrigger('study_start').catch(() => {});
    return { ok: true, enabled: result.enabled, dndChanged: result.changed, message: 'Study Mode started: Windows Do Not Disturb is on and your 25-minute timer is running.' };
  }
  if (mode === 'youtube') {
    try { await openExternal('https://www.youtube.com/'); return { ok: true, message: 'YouTube is open in your default browser.' }; }
    catch (error) { return { ok: false, message: String(error.message || error).slice(0, 300) }; }
  }
  return { ok: false, message: 'Choose Do Not Disturb, Study, or YouTube.' };
});
ipcMain.handle('computer-mode:end-study', async (_event, restoreDnd) => {
  if (!restoreDnd || !studyDndOwned) return { ok: true, enabled: true, message: 'Your previous Do Not Disturb setting is unchanged.' };
  const result = await setWindowsDoNotDisturb(false);
  if (result.ok) studyDndOwned = false;
  return result.ok ? { ...result, message: 'Study session ended; Windows Do Not Disturb is off again.' } : result;
});
ipcMain.handle('computer-mode:status', async () => {
  const result = await setWindowsDoNotDisturb(null);
  return result.ok ? { ok: true, enabled: result.enabled, message: `Windows Do Not Disturb is ${result.enabled ? 'on' : 'off'}.` } : result;
});

// Documents
async function pickDocumentPaths(withPictures = false) {
  const documentTypes = SUPPORTED.map(item => item.slice(1));
  const pictureTypes = Object.keys(IMAGE_TYPES).map(item => item.slice(1));
  const filters = withPictures ? [{ name: 'Documents and pictures', extensions: [...documentTypes, ...pictureTypes] }, { name: 'Pictures', extensions: pictureTypes }, { name: 'Documents', extensions: documentTypes }] : [{ name: 'Documents', extensions: documentTypes }];
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'], filters });
  return result.canceled ? [] : result.filePaths;
}
// Chat attachment and study-library file picking, using the richer extractor for every format.
ipcMain.handle('documents:pick', async () => {
  const picked = await pickDocumentPaths(true);
  if (!picked.length) return { canceled: true, documents: [] };
  // Pictures go to the vision model with the message instead of being read as text.
  const pictures = picked.filter(isImagePath).slice(0, 4).map(file => { pickedPictures.add(path.resolve(file)); return { name: path.basename(file), path: file }; });
  const paths = picked.filter(file => !isImagePath(file));
  const output = [];
  const errors = [];
  let remaining = 600000;
  for (const filePath of paths) {
    if (remaining <= 0) break;
    const name = path.basename(filePath);
    try {
      if ((await fs.promises.stat(filePath)).size > 75 * 1024 * 1024) throw new Error('This file is over the 75 MB import limit.');
      // A fair share per file, so the first big file can't use up the whole limit.
      const share = Math.ceil(remaining / (paths.length - paths.indexOf(filePath)));
      const result = await readDocument(rootDir, filePath, share);
      remaining -= result.text.length;
      output.push({ name, content: result.text, truncated: Boolean(result.truncated), pageCount: result.pages, blankPages: result.blankPages || [], textPages: result.textPages ?? (result.pages ? result.pages - (result.blankPages || []).length : undefined), notProcessedPages: result.notProcessedPages || [] });
    } catch (error) { errors.push({ name, message: String(error.message || 'Could not read this file.').slice(0, 500) }); }
  }
  return { canceled: false, documents: output, pictures, errors };
});
handle('documents:list', () => documents.list());
handle('documents:add', async (folder = '') => {
  const paths = await pickDocumentPaths();
  if (!paths.length) return { canceled: true };
  const added = [];
  const errors = [];
  for (const filePath of paths) {
    try { added.push(await documents.add(filePath, { folder, fromPicker: true })); }
    catch (error) { errors.push({ name: path.basename(filePath), message: String(error.message).slice(0, 300) }); }
  }
  return { ok: added.length > 0 || !errors.length, added, errors };
});
handle('documents:add-folder', async (folder = '') => {
  const pick = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (pick.canceled) return { canceled: true };
  const root = pick.filePaths[0];
  const found = [];
  const walk = async (current, depth) => {
    for (const entry of await fs.promises.readdir(current, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && depth < 6 && !entry.name.startsWith('.') && entry.name !== 'node_modules') await walk(full, depth + 1);
      else if (SUPPORTED.includes(path.extname(entry.name).toLowerCase()) && found.length < 300) found.push(full);
    }
  };
  await walk(root, 0);
  const added = [];
  const errors = [];
  for (const [index, filePath] of found.entries()) {
    send('documents:progress', { index: index + 1, total: found.length, name: path.basename(filePath) });
    try { added.push(await documents.add(filePath, { folder: folder || path.basename(root), fromPicker: true })); }
    catch (error) { errors.push({ name: path.basename(filePath), message: String(error.message).slice(0, 200) }); }
  }
  return { ok: true, added, errors, total: found.length };
});
handle('documents:remove', id => documents.remove(id));
handle('documents:patch', (id, changes) => documents.patch(id, changes));
handle('documents:preview', async id => documents.readText(id, 30000));
handle('documents:search', (query, options) => documents.search(query, { ids: options?.ids || null, limit: 20 }));
handle('documents:open', async id => { const doc = await documents.get(id); if (!doc) throw new Error('That document is no longer in the library.'); if (!fs.existsSync(doc.path)) throw new Error(`The file has moved or been deleted: ${doc.path}`); await documents.patch(id, { opened: true }); const failure = await openPath(doc.path); return failure ? { ok: false, message: failure } : { ok: true }; });
handle('documents:reindex', async () => ({ ok: true, count: await documents.reindexAllEmbeddings() }));
handle('documents:browse', async folder => ({ ok: true, folder: folder || app.getPath('documents'), roots: guard.roots().filter(root => fs.existsSync(root)), items: await files.list(folder || app.getPath('documents')) }));
handle('documents:add-path', filePath => documents.add(filePath));

// My Apps
handle('apps:list', () => launcher.list());
handle('apps:add', input => launcher.add(input));
handle('apps:update', (id, input) => launcher.update(id, input));
handle('apps:remove', id => launcher.remove(id));
handle('apps:reorder', ids => launcher.reorder(ids));
handle('apps:launch', id => launcher.launch(id));
handle('apps:detect', refresh => launcher.detectInstalled(refresh));
handle('apps:pick-exe', async () => { const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Applications', extensions: ['exe', 'lnk', 'bat', 'cmd'] }] }); return result.canceled ? { canceled: true } : { canceled: false, path: result.filePaths[0] }; });
handle('apps:pick-icon', async () => { const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'ico', 'svg', 'webp'] }] }); return result.canceled ? { canceled: true } : { canceled: false, path: result.filePaths[0] }; });

// Opens a picture shown in chat in the normal Windows viewer: only picture files Nexus made, or that were picked or are in allowed folders.
handle('documents:open-picture', async file => {
  const full = path.resolve(String(file || ''));
  if (!isImagePath(full)) return { ok: false, message: 'That is not a picture.' };
  if (!pickedPictures.has(full) && !full.toLowerCase().startsWith(path.join(app.getPath('documents'), 'Nexus', 'Images').toLowerCase())) guard.resolve(full);
  const problem = await shell.openPath(full);
  return problem ? { ok: false, message: problem } : { ok: true };
});
ipcMain.handle('open-external-url', async (_event, value) => {
  try {
    const url = new URL(String(value));
    if (!['https:', 'http:'].includes(url.protocol)) return { ok: false, message: 'Only website links can be opened.' };
    await openExternal(url.toString());
    return { ok: true };
  } catch (error) { return { ok: false, message: error.message }; }
});

// Voice
ipcMain.on('start-voice-recognition', (_event, options) => voice.listen(send, { hold: Boolean(options?.hold), wait: Number(options?.wait) || undefined }));
ipcMain.on('finish-voice-recognition', () => voice.finishListening());
ipcMain.on('stop-voice-recognition', () => voice.stopListening());
ipcMain.on('speak-response', (_event, text) => voice.speak(text, () => send('voice-speech-done')));
ipcMain.on('stop-speaking', () => voice.stopSpeaking());
handle('voice:voices', () => voice.listVoices());
handle('voice:devices', () => voice.listDevices());

// Calendar and reminders
handle('calendar:list', range => calendar.listEvents(range));
handle('calendar:suggest-times', options => calendar.suggestTimes(options));
handle('calendar:week-summary', () => calendar.weekSummary());
handle('web:weather', place => webInfo.weather(place));
handle('web:news', topic => webInfo.news(topic));
handle('smarthome:status', () => smartHome.status());
handle('smarthome:connect', input => smartHome.connect(input));
handle('smarthome:disconnect', () => smartHome.disconnect());
handle('smarthome:devices', async () => ({ ok: true, devices: await smartHome.devices() }));
handle('smarthome:control', (id, action) => smartHome.control(id, action));
handle('calendar:add', async input => {
  const event = await calendar.addEvent(input);
  if (!input?.google) return event;
  // Writing to a real account always asks first, and its result is reported separately from the Nexus event.
  const accounts = await composio.activeAccounts();
  if (!accounts.some(account => /googlecalendar/i.test(account.toolkit))) return { ...event, google: { ok: false, message: 'Saved in Nexus only. Connect Google Calendar in Connected Apps to add it there too.' } };
  if (!await confirmAction({ title: 'Add to Google Calendar?', message: `Add "${event.title}" to your Google Calendar?`, detail: new Date(event.start).toLocaleString() })) return { ...event, google: { ok: false, message: 'Saved in Nexus only.' } };
  try {
    const result = await composio.execute('GOOGLECALENDAR_CREATE_EVENT', { summary: event.title, start_datetime: event.start, end_datetime: event.end, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, description: event.notes || undefined });
    if (result?.error || result?.successful === false) throw new Error(String(result.error || 'Google Calendar refused the event.').slice(0, 200));
    return { ...event, google: { ok: true, message: 'Added to Google Calendar too.' } };
  } catch (error) { return { ...event, google: { ok: false, message: `Saved in Nexus, but Google Calendar failed: ${String(error.message).slice(0, 200)}` } }; }
});
handle('calendar:update', (id, input) => calendar.updateEvent(id, input));
handle('calendar:remove', id => calendar.removeEvent(id));
handle('reminders:list', () => calendar.listReminders());
handle('reminders:add', input => calendar.addReminder(input));
handle('reminders:remove', id => calendar.removeReminder(id));
handle('reminders:snooze', (id, minutes) => calendar.snoozeReminder(id, minutes));
handle('reminders:parse', text => { const date = parseWhen(text); return { ok: Boolean(date), at: date?.toISOString() || '' }; });
handle('notifications:list', () => notifications.list());
handle('notifications:read-all', async () => { await notifications.update(items => items.map(item => ({ ...item, read: true }))); return { ok: true }; });
handle('notifications:clear', async () => { await notifications.write([]); return { ok: true }; });

// Study Center
const streamTo = (channel, requestId) => text => send(channel, { requestId, text });
handle('study:material', selection => materialFromSelection(selection));
handle('study:sets', () => study.listSets());
handle('study:set-hard-test', async (id, { count = 10 } = {}) => {
  const set = await study.getSet(id);
  if (!set?.selection) throw new Error('This set does not remember its files. Make it again to get a hard test.');
  const { text, names } = await materialFromSelection(set.selection);
  const written = Math.max(1, Math.round(Number(count) * 0.3));
  return { ok: true, test: await study.createTest({ title: `${set.title} hard test`, subject: set.subject, material: text, names, counts: { multiple_choice: Math.max(1, Number(count) - written), application: Math.ceil(written / 2), scenario: Math.floor(written / 2) } }) };
});
handle('study:set-create', async ({ selection, title, subject, count, instructions, requestId }) => { const { text } = await materialFromSelection(selection); return { ok: true, set: await study.createStudySet({ title, subject, count, instructions, selection, sources: sourcesInMaterial(text), onProgress: status => send('study:progress', { requestId, status }) }) }; });
handle('study:set-remove', id => study.removeSet(id));
handle('study:set-answer', (id, cardId, correct) => study.recordSetAnswer(id, cardId, correct));
handle('study:set-mark', (id, cardId, known) => study.markSetCard(id, cardId, known));
handle('study:set-reset', id => study.resetSet(id));
handle('study:set-edit-card', (id, cardId, changes) => study.editSetCard(id, cardId, changes));
handle('study:set-remove-card', (id, cardId) => study.removeSetCard(id, cardId));
handle('study:set-match-time', (id, seconds) => study.recordMatchTime(id, seconds));
handle('study:set-test', async (id, options) => ({ ok: true, test: await study.createSetTest(id, options) }));
handle('study:guide', async ({ selection, title, subject, requestId }) => { const { text, names } = await materialFromSelection(selection); return { ok: true, guide: await study.createGuide({ title, subject, material: text, names, onProgress: status => send('study:progress', { requestId, status }) }) }; });
handle('study:guides', () => study.listGuides());
handle('study:guide-remove', id => study.removeGuide(id));
handle('study:guide-export', async id => {
  const guide = await study.getGuide(id);
  if (!guide) throw new Error('That study guide no longer exists.');
  const result = await dialog.showSaveDialog(mainWindow, { defaultPath: path.join(app.getPath('documents'), `${guide.title.replace(/[\\/:*?"<>|]/g, ' ')}.md`), filters: [{ name: 'Markdown', extensions: ['md'] }] });
  if (result.canceled) return { canceled: true };
  await fs.promises.writeFile(result.filePath, `# ${guide.title}\n\n${guide.content}\n`);
  return { ok: true, path: result.filePath };
});
handle('study:flashcards-generate', async ({ selection, topic, subject, count }) => { const { text } = await materialFromSelection(selection); return { ok: true, cards: await study.createFlashcards({ topic, subject, material: text, count }) }; });
handle('study:cards', () => study.listCards());
handle('study:cards-due', filter => study.dueCards(filter));
handle('study:card-review', (id, grade) => study.review(id, grade));
handle('study:card-add', input => study.addCard(input));
handle('study:card-remove', id => study.removeCard(id));
// Topics found in the chosen files are kept briefly, so the test uses exactly the text that was shown.
const topicCache = new Map();
const askJson = async (system, user) => JSON.parse((await models.chat({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], format: 'json', maxTokens: 900 })).content);
handle('study:find-topics', async selection => {
  const { text, names } = await materialFromSelection(selection);
  if (!text.trim()) return { ok: false, message: 'Those files have no readable text.' };
  const { topics, method } = await findTopics(text, askJson);
  const token = require('crypto').randomUUID();
  topicCache.set(token, { topics, names });
  for (const key of [...topicCache.keys()].slice(0, -10)) topicCache.delete(key);
  const course = getSettings().study.curriculum;
  const unit = course ? curriculum.matchUnit(course, text) : null;
  return { ok: true, token, method, topics: topics.map(({ id, title, source, text: body }) => ({ id, title, source, chars: body.length, preview: body.slice(0, 160) })), unit: unit ? { code: unit.code, title: unit.title } : null, course: course ? curriculum.COURSES[course].name : '' };
});
// My writing: samples in, a learned style, and writing or polishing in that style.
handle('study:style-status', () => writingStyle.status());
handle('study:style-add', input => writingStyle.addSample(input));
handle('study:style-remove', id => writingStyle.removeSample(id));
handle('study:style-learn', () => writingStyle.learn());
handle('study:style-pick', async () => {
  const picked = (await pickDocumentPaths()).slice(0, 6);
  const added = [];
  const errors = [];
  for (const file of picked) {
    try { const result = await readDocument(rootDir, file, MAX_STYLE_TEXT); added.push(await writingStyle.addSample({ name: path.basename(file), text: result.text })); }
    catch (error) { errors.push(`${path.basename(file)}: ${error.message}`); }
  }
  return { ok: !errors.length || added.length > 0, added: added.length, message: errors.join(' ') };
});
const MAX_STYLE_TEXT = 20000;
const styleRuns = new Map();
handle('study:style-write', async ({ task, draft, length, kind, tone, requestId }) => {
  const controller = new AbortController();
  styleRuns.set(requestId, controller);
  const notes = String(draft || '').trim() ? '' : (await findStudyMaterial(String(task || '')).catch(() => ({ text: '' }))).text;
  try { return { ok: true, ...(await writingStyle.write({ task, draft, length, kind, tone, facts: notes, signal: controller.signal, onToken: text => send('study:style-token', { requestId, text }) })) }; }
  finally { styleRuns.delete(requestId); }
});
handle('study:style-cancel', requestId => { styleRuns.get(requestId)?.abort(); return { ok: true }; });
handle('study:style-save', async ({ title, text }) => {
  const result = await registry.get?.('create_word_document')?.handler?.({ title: title || 'My writing', sections: [{ heading: '', text }] });
  if (!result?.ok) return { ok: false, message: 'Nexus could not save the document.' };
  shell.showItemInFolder(result.path);
  return { ok: true, path: result.path, message: `Saved ${path.basename(result.path)} in Documents\\Nexus.` };
});
handle('study:curriculum', () => ({ current: getSettings().study.curriculum, courses: curriculum.courseList() }));
handle('study:test-generate', async ({ selection, title, subject, counts, instructions, topicToken, topicIds, unitCode }) => {
  const cached = topicToken ? topicCache.get(topicToken) : null;
  const picked = cached ? materialFor(cached.topics, topicIds) : null;
  const { text, names } = picked ? { text: picked.text, names: cached.names } : await materialFromSelection(selection);
  const topics = picked && topicIds?.length && topicIds.length < cached.topics.length ? picked.titles : [];
  const course = getSettings().study.curriculum;
  const unit = course ? (curriculum.COURSES[course].units.find(item => item.code === unitCode) || curriculum.matchUnit(course, text)) : null;
  const standards = unit ? curriculum.standardsPrompt(course, unit.code, topics.join(' ')) : '';
  return { ok: true, test: await study.createTest({ title, subject, material: text, names, counts, instructions, standards, topics }) };
});
handle('study:d2l-sources', async subject => (await school.readD2LLibrary()).filter(item => (item.provider || 'd2l') === 'd2l' && (!subject || !item.subject || item.subject === subject)).map(({ id, title, kind, url, subject: itemSubject, updatedAt, truncated, text, course }) => ({ id, title, kind, url, subject: itemSubject, updatedAt, truncated, course: course || courseNameFrom(title), usable: d2lReadingLength(text) >= 200 })));
handle('study:d2l-test', async ({ ids, subject, count, title, instructions }) => {
  const chosen = new Set(Array.isArray(ids) ? ids : []);
  // Only items that came from D2L can reach this test; files added from the computer are excluded.
  const items = (await school.readD2LLibrary()).filter(item => (item.provider || 'd2l') === 'd2l' && chosen.has(item.id));
  return { ok: true, test: await study.createGroundedTest({ title, subject, items, count, instructions }) };
});
// Assignments and due dates from D2L go into the planner and calendar. Importing again doesn't duplicate them.
async function importD2LAssignments() {
  const found = await school.listAssignments();
  if (!found.ok) return found;
  const planner = await study.listPlanner();
  let added = 0;
  for (const item of found.assignments) {
    const externalId = `d2l-${item.courseId}-${item.id}`;
    if (planner.some(entry => entry.externalId === externalId)) continue;
    await study.addPlannerItem({ kind: 'assignment', title: item.title, when: item.due || '', subject: item.course, externalId });
    if (item.due) await calendar.addEvent({ title: item.title, start: item.due, minutes: 30, kind: 'assignment', course: item.course });
    added++;
  }
  return { ok: true, added, total: found.assignments.length, failedCourses: found.failedCourses, assignments: found.assignments, message: `Found ${found.assignments.length} assignment(s) in D2L; ${added} new.${found.failedCourses.length ? ` Could not read: ${found.failedCourses.join(', ')}.` : ''}` };
}
handle('school:import-assignments', importD2LAssignments);
handle('study:tests', () => study.listTests());
handle('study:test-submit', (id, answers) => study.submitTest(id, answers));
handle('study:test-remove', id => study.removeTest(id));
handle('study:quiz-next', async ({ selection, topic, subject, history, instructions }) => {
  const hasSelection = selection && ((selection.documentIds || []).length || (selection.libraryIds || []).length);
  const { text } = hasSelection ? await materialFromSelection(selection) : await findStudyMaterial(topic, subject);
  if (!text) return { ok: false, message: `No saved material was found for "${topic}". Select sources or add files first.` };
  return { ok: true, question: await study.nextQuizQuestion({ material: text, subject, topic, history, instructions }) };
});
handle('study:quiz-answer', async (question, answer) => ({ ok: true, result: await study.answerQuiz(question, answer) }));
handle('study:explain', async ({ concept, selection, requestId }) => { const { text } = await materialFromSelection(selection); return { ok: true, text: await study.explain({ concept, material: text, onToken: streamTo('study:token', requestId) }) }; });
handle('study:planner', () => study.listPlanner());
handle('study:planner-add', async input => {
  const item = await study.addPlannerItem(input);
  // Dated planner items also appear on the calendar, so there is one schedule to look at.
  if (item.when) await calendar.addEvent({ title: item.title, start: new Date(item.when).toISOString(), minutes: item.minutes || 60, kind: item.kind === 'session' ? 'study' : item.kind === 'goal' ? 'event' : item.kind, course: item.subject });
  return item;
});
handle('study:planner-update', (id, changes) => study.updatePlanner(id, { done: Boolean(changes.done) }));
handle('study:planner-remove', id => study.removePlanner(id));
handle('study:priorities', () => study.priorities());
handle('study:progress', () => study.progress());

// Research
handle('research:run', async ({ question, requestId }) => ({ ok: true, project: await research.run({ question, onProgress: status => send('research:progress', { requestId, status }), onToken: streamTo('research:token', requestId) }) }));
handle('research:search', query => research.search(query));
handle('research:projects', () => research.listProjects());
handle('research:remove', id => research.removeProject(id));

// Automations
handle('automations:list', () => automations.list());
handle('automations:create', async input => { const item = await automations.create(input); await automations.syncWatcher(); return item; });
handle('automations:update', async (id, input) => { const item = await automations.update(id, input); await automations.syncWatcher(); return item; });
handle('automations:remove', id => automations.remove(id));
handle('automations:run', id => automations.run(id));
handle('automations:history', () => automations.history());
handle('automations:draft', async text => ({ ok: true, draft: await automations.draftFromText(text) }));

// Dashboard: every figure below is read from a real store or a live check.
handle('dashboard:data', async () => {
  const [apps, docs, taskList, reminders, events, projects, run, due, priorities, sets, savedTests] = await Promise.all([launcher.list(), documents.list(), tasks.list(), calendar.listReminders(), calendar.listEvents({ from: new Date(), to: new Date(Date.now() + 14 * 86400000) }), conversations.read(), chat.runs.list(), study.dueCards(), study.priorities(), study.listSets(), study.listTests()]);
  return {
    suggestions: buildSuggestions({ tasks: taskList, priorities, documents: docs, sets, tests: savedTests, apps }),
    recentApps: apps.filter(app => app.lastOpenedAt).sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt)).slice(0, 6),
    favoriteApps: apps.filter(app => app.favorite).slice(0, 6),
    recentDocuments: docs.slice().sort((a, b) => String(b.lastOpenedAt || b.addedAt).localeCompare(String(a.lastOpenedAt || a.addedAt))).slice(0, 5),
    tasks: taskList.filter(task => task.status !== 'complete').sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'))).slice(0, 5),
    reminders: reminders.filter(item => item.status === 'scheduled').sort((a, b) => a.at.localeCompare(b.at)).slice(0, 5),
    events: events.slice(0, 5),
    conversations: (projects?.projects || []).filter(project => project.messages?.length).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 5).map(project => ({ id: project.id, title: project.title, updatedAt: project.updatedAt })),
    recentRuns: run.slice(0, 4).map(item => ({ goal: item.goal, status: item.status, startedAt: item.startedAt })),
    dueCards: due.length
  };
});
// Search across everything in the top bar.
handle('dashboard:search', async (query, { kind = '' } = {}) => {
  const plan = parseSearch(query);
  const empty = { apps: [], documents: [], tasks: [], memories: [], conversations: [], events: [], understood: [] };
  if (!plan.words.length && !plan.filtered && !kind) return empty;
  const kinds = kind ? [kind] : plan.kinds;
  const wanted = name => !kinds.length || kinds.includes(name);
  const { words } = plan;
  const has = value => matchesWords(value, words);
  const [apps, docs, taskList, memories, projects, hits, upcoming] = await Promise.all([launcher.list(), documents.list(), tasks.list(), memory.list(), conversations.read(), words.length && wanted('documents') ? documents.search(words.join(' '), { limit: 5 }) : [], calendar.listEvents({ from: plan.since || new Date(Date.now() - 30 * 86400000), to: plan.until || new Date(Date.now() + 180 * 86400000) })]);
  const fileFits = doc => (!plan.extensions.length || plan.extensions.includes(String(doc.name).split('.').pop().toLowerCase())) && inDates(doc.addedAt, plan);
  const fitting = docs.filter(fileFits);
  const byName = fitting.filter(doc => has(doc.name));
  const passages = hits.map(hit => ({ doc: fitting.find(doc => doc.name === hit.name), hit })).filter(({ doc }) => doc && !byName.includes(doc)).map(({ doc, hit }) => ({ id: doc.id, name: doc.name, location: hit.location }));
  const taskFits = task => has(task.text) && inDates(task.dueDate || task.createdAt, plan) && (plan.done === null || task.done === plan.done) && (!plan.priority || task.priority === plan.priority) && (!plan.overdue || (task.dueDate && !task.done && new Date(task.dueDate) < new Date()));
  return {
    understood: plan.understood,
    apps: wanted('apps') && !plan.since ? apps.filter(app => has(app.name)).slice(0, 5) : [],
    documents: wanted('documents') ? [...byName.slice(0, 5).map(doc => ({ id: doc.id, name: doc.name, location: '' })), ...passages].slice(0, 6) : [],
    tasks: wanted('tasks') ? taskList.filter(taskFits).slice(0, 6) : [],
    events: wanted('events') ? upcoming.filter(event => has(event.title)).slice(0, 6) : [],
    memories: wanted('memories') && !plan.since ? memories.filter(item => has(item.text)).slice(0, 4) : [],
    conversations: wanted('conversations') ? (projects?.projects || []).filter(project => has(project.title) && inDates(project.updatedAt, plan)).slice(0, 5).map(project => ({ id: project.id, title: project.title })) : []
  };
});

// System: diagnostics, logs, backup
handle('system:diagnostics', async () => {
  const checks = await checkHelpers(rootDir);
  const ai = await models.test();
  const composioStatus = await composio.status();
  return { app: app.getVersion(), electron: process.versions.electron, node: process.versions.node, platform: `${os.type()} ${os.release()}`, pythonModules: checks, ai, composio: composioStatus, browsers: detectBrowsers(), dataDir, secureStorage: await safeStorage.isAsyncEncryptionAvailable() };
});
handle('system:logs', () => logger.tail());
handle('system:update-status', () => updater.status());
handle('system:open-speech-settings', async () => { await shell.openExternal('ms-settings:speech'); return { ok: true }; });
handle('system:update-check', () => updater.check({ manual: true }));
handle('system:update-restart', () => updater.restart());
handle('system:open-data-folder', async () => { await openPath(dataDir); return { ok: true }; });
const BACKUP_FILES = ['settings.json', 'conversations.json', 'apps.json', 'documents.json', 'nexus-memories.json', 'work-tasks.json', 'calendar-events.json', 'reminders.json', 'flashcards.json', 'study-sets.json', 'study-guides.json', 'practice-tests.json', 'study-planner.json', 'study-mastery.json', 'research-projects.json', 'automations.json', 'd2l-settings.json', 'd2l-study-library.json'];
handle('system:backup', async () => {
  const result = await dialog.showSaveDialog(mainWindow, { defaultPath: path.join(app.getPath('documents'), `nexus-backup-${new Date().toISOString().slice(0, 10)}.json`), filters: [{ name: 'Nexus backup', extensions: ['json'] }] });
  if (result.canceled) return { canceled: true };
  const bundle = { nexusBackup: 1, createdAt: new Date().toISOString(), files: {} };
  for (const name of BACKUP_FILES) { try { bundle.files[name] = JSON.parse(await fs.promises.readFile(path.join(dataDir, name), 'utf8')); } catch {} }
  await fs.promises.writeFile(result.filePath, JSON.stringify(bundle), { mode: 0o600 });
  return { ok: true, path: result.filePath, count: Object.keys(bundle.files).length, message: `Saved ${Object.keys(bundle.files).length} data files. API keys are not included.` };
});
handle('system:restore', async () => {
  const pick = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Nexus backup', extensions: ['json'] }] });
  if (pick.canceled) return { canceled: true };
  const bundle = JSON.parse(await fs.promises.readFile(pick.filePaths[0], 'utf8'));
  if (bundle.nexusBackup !== 1 || typeof bundle.files !== 'object') throw new Error('That file is not a Nexus backup.');
  if (!await confirmAction({ title: 'Restore backup?', message: `Replace current Nexus data with the backup from ${bundle.createdAt}?`, detail: 'A safety copy of the current data is saved first.' })) return { canceled: true };
  const safety = path.join(dataDir, `pre-restore-${Date.now()}`);
  await fs.promises.mkdir(safety, { recursive: true });
  for (const name of BACKUP_FILES) await fs.promises.copyFile(path.join(dataDir, name), path.join(safety, name)).catch(() => {});
  for (const [name, content] of Object.entries(bundle.files)) if (BACKUP_FILES.includes(name)) await fs.promises.writeFile(path.join(dataDir, name), JSON.stringify(content, null, 2), { mode: 0o600 });
  app.relaunch(); app.exit(0);
  return { ok: true };
});
handle('system:clear-data', async kind => {
  const all = { conversations: ['conversations.json'], memories: ['nexus-memories.json'], research: ['research-projects.json'], study: ['flashcards.json', 'study-sets.json', 'study-guides.json', 'practice-tests.json', 'study-mastery.json', 'study-planner.json'], history: ['agent-runs.json', 'automation-history.json', 'notifications.json'] }[kind];
  if (!all) throw new Error('Unknown data type.');
  if (!await confirmAction({ title: 'Delete data?', message: `Permanently delete your saved ${kind}?`, detail: 'This cannot be undone.' })) return { canceled: true };
  for (const name of all) await fs.promises.unlink(path.join(dataDir, name)).catch(() => {});
  app.relaunch(); app.exit(0);
  return { ok: true };
});
handle('system:shortcut', async () => {
  const link = path.join(app.getPath('desktop'), 'NEXUS.lnk');
  const launcherBat = path.join(rootDir, 'run_nexus.bat');
  const options = app.isPackaged ? { target: process.execPath } : { target: launcherBat, cwd: rootDir, icon: path.join(rootDir, 'build', 'icon.ico'), iconIndex: 0 };
  return shell.writeShortcutLink(link, fs.existsSync(link) ? 'update' : 'create', options) ? { ok: true, message: 'Added a NEXUS shortcut to the desktop.' } : { ok: false, message: 'Windows did not create the shortcut.' };
});

// Window
async function createWindow() {
  const startHidden = process.argv.includes('--minimized') || (getSettings().general.startMinimized && !process.env.NEXUS_TEST);
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1000, minHeight: 680, frame: true, show: !startHidden, backgroundColor: '#050b18', autoHideMenuBar: true,
    icon: fs.existsSync(path.join(rootDir, 'build', 'icon.png')) ? path.join(rootDir, 'build', 'icon.png') : undefined,
    webPreferences: { preload: path.join(rootDir, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }
  });
  // The window only ever shows Nexus's own page. Links open in the user's browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) openExternal(url); return { action: 'deny' }; });
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  mainWindow.on('close', event => {
    if (!quitting && getSettings().general.closeToTray && tray) { event.preventDefault(); mainWindow.hide(); }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  await mainWindow.loadFile(path.join(rootDir, 'index.html'));
}
function setupTray() {
  try {
    const icon = fs.existsSync(path.join(rootDir, 'build', 'icon.png')) ? nativeImage.createFromPath(path.join(rootDir, 'build', 'icon.png')).resize({ width: 16, height: 16 }) : nativeImage.createEmpty();
    tray = new Tray(icon);
    tray.setToolTip('NEXUS');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open NEXUS', click: () => { mainWindow?.show(); mainWindow?.focus(); } }, { type: 'separator' }, { label: 'Quit', click: () => { quitting = true; app.quit(); } }]));
    tray.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
  } catch (error) { logger.warn(`tray unavailable: ${error.message}`); }
}

// Reminders and automations are checked on a timer in the background process, so they fire on any page.
let schedulerTimer = null;
function startScheduler() {
  const tick = async () => {
    try { await calendar.tick(); await automations.tick(); }
    catch (error) { logger.error(`scheduler: ${error.message}`); }
  };
  tick();
  schedulerTimer = setInterval(tick, 20000);
}

if (!process.env.NEXUS_TEST && !app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
app.whenReady().then(async () => {
  await settings.load();
  await loadAiKey();
  applyStartupSetting(getSettings());
  ensureOllama().catch(() => {});
  setupTray();
  await createWindow();
  startScheduler();
  automations.syncWatcher().catch(error => logger.warn(`watcher: ${error.message}`));
  automations.fireTrigger('app_start').catch(() => {});
  updater.start();
  logger.info(`NEXUS ${app.getVersion()} started`);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', event => {
  quitting = true;
  if (studyDndOwned) {
    event.preventDefault();
    setWindowsDoNotDisturb(false).finally(() => { studyDndOwned = false; app.quit(); });
    return;
  }
  if (schedulerTimer) clearInterval(schedulerTimer);
  automations.stop();
  voice.stopAll();
  browser.closeAll().catch(() => {});
  school.closeBrowser().catch(() => {});
});
