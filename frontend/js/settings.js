// Settings: every control here changes real behaviour, and is saved as soon as it changes.
const LANGUAGES = ['English', 'French', 'Spanish', 'Arabic', 'Urdu', 'German', 'Hindi', 'Chinese'];
const CATEGORY_LABELS = { computer: 'Control apps and windows', files: 'Change files and folders', browser: 'Act in the Nexus browser', apps: 'Open apps and websites', productivity: 'Tasks, calendar, reminders', documents: 'Document library and new files', research: 'Search the web', integrations: 'Connected apps', automations: 'Run automations', school: 'D2L access', study: 'Study tools', memory: 'Save memories' };

function settingRow(label, help, control) { return h('div', { class: 'setting' }, h('label', {}, label, help ? h('small', { text: help }) : null), h('div', {}, control)); }
function save(changes, message) { return updateSettings(changes).then(() => { if (message) toast(message, 'ok'); }).catch(error => toast(error.message, 'error')); }
function checkbox(value, onChange) { return h('input', { type: 'checkbox', checked: value, onchange: event => onChange(event.target.checked) }); }
function selectBox(options, value, onChange) { return h('select', { onchange: event => onChange(event.target.value) }, options.map(option => { const [optionValue, text] = Array.isArray(option) ? option : [option, option]; return h('option', { value: optionValue, text, selected: optionValue === value }); })); }
function textBox(value, onChange, attrs = {}) { return h('input', { type: 'text', value, onchange: event => onChange(event.target.value), ...attrs }); }
function numberBox(value, onChange, attrs = {}) { return h('input', { type: 'number', value, onchange: event => onChange(Number(event.target.value)), ...attrs }); }
function section(title, ...children) { return h('section', { class: 'settings-section' }, h('h3', { text: title }), children); }

function renderGeneralSettings(box) {
    const { general } = appSettings;
    const set = changes => save({ general: changes });
    box.replaceChildren(section('General',
        settingRow('Your name', 'Used in greetings and by the assistant.', textBox(general.userName, value => set({ userName: value }), { maxlength: 60 })),
        settingRow('Assistant language', 'Language of the app\'s main labels, AI replies, and speech recognition. Longer descriptions stay in English.', selectBox(LANGUAGES, general.language, value => set({ language: value }))),
        settingRow('Open on', '', selectBox([...NAV_ITEMS, ['last', 'Last page used']], general.startPage, value => set({ startPage: value }))),
        settingRow('Start with Windows', 'Applies to the installed version of Nexus.', checkbox(general.launchAtLogin, value => set({ launchAtLogin: value }))),
        settingRow('Start minimized', '', checkbox(general.startMinimized, value => set({ startMinimized: value }))),
        settingRow('Keep running in the tray when closed', 'Reminders and automations only fire while Nexus is running.', checkbox(general.closeToTray, value => set({ closeToTray: value }))),
        settingRow('Show notifications', 'Windows pop-ups for reminders and automation problems. They are still listed under the bell.', checkbox(general.notifications, value => set({ notifications: value }))),
        settingRow('Desktop shortcut', 'Adds a NEXUS shortcut that always runs the current version.', h('button', { type: 'button', class: 'mini-button', text: 'Create shortcut', onclick: async () => { try { toast((await call('system:shortcut')).message, 'ok'); } catch (error) { toast(error.message, 'error'); } } }))
    ));
}
function renderAppearanceSettings(box) {
    const { appearance } = appSettings;
    const set = changes => save({ appearance: changes });
    box.replaceChildren(section('Appearance',
        settingRow('Background', '', selectBox([['navy', 'Deep navy'], ['midnight', 'Midnight blue'], ['black', 'Black']], appearance.theme, value => set({ theme: value }))),
        settingRow('Accent color', '', h('input', { type: 'color', value: appearance.accent, onchange: event => set({ accent: event.target.value }) })),
        settingRow('Font', '', selectBox(['Segoe UI', 'Bahnschrift', 'Calibri', 'Verdana', 'Tahoma', 'Consolas'], appearance.fontFamily, value => set({ fontFamily: value }))),
        settingRow('Text size', '11 to 20', numberBox(appearance.fontSize, value => set({ fontSize: value }), { min: 11, max: 20 })),
        settingRow('Animations', '', checkbox(appearance.animations, value => set({ animations: value }))),
        settingRow('Collapse the sidebar', '', checkbox(appearance.sidebarCollapsed, value => set({ sidebarCollapsed: value })))
    ));
}
async function renderAiSettings(box) {
    const { ai } = appSettings;
    const loaded = await ipcRenderer.invoke('settings:get');
    const set = async changes => { await save({ ai: changes }); refreshTopbarStatus(); };
    const result = h('div', { class: 'muted small status-line', role: 'status' });
    const modelBox = h('div', {});
    const drawModels = async () => {
        const status = await ipcRenderer.invoke('ollama:test');
        const names = (status.models || []).map(model => model.name);
        result.textContent = status.message; result.dataset.kind = status.ready ? 'ok' : 'error';
        modelBox.replaceChildren(names.length ? selectBox(names.includes(appSettings.ai.model) ? names : [appSettings.ai.model, ...names], appSettings.ai.model, value => set({ model: value }).then(drawModels)) : textBox(appSettings.ai.model, value => set({ model: value }).then(drawModels)));
    };
    const apiKey = h('input', { type: 'password', autocomplete: 'new-password', placeholder: loaded.hasAiKey ? 'A key is saved. Enter a new one to replace it.' : 'Only if your endpoint needs one' });
    box.replaceChildren(section('Model',
        settingRow('Provider', 'Ollama runs on this computer. Other endpoints may send your messages to whoever runs them.', selectBox([['ollama', 'Ollama (local)'], ['openai', 'OpenAI-compatible endpoint']], ai.provider, value => set({ provider: value }).then(() => renderAiSettings(box)))),
        ai.provider === 'ollama' ? settingRow('Ollama address', '', textBox(ai.baseUrl, value => set({ baseUrl: value }).then(drawModels))) : settingRow('Endpoint address', 'Such as http://127.0.0.1:1234/v1', textBox(ai.openaiBaseUrl, value => set({ openaiBaseUrl: value }).then(drawModels))),
        ai.provider === 'openai' ? settingRow('API key', 'Encrypted by Windows and never shown again.', h('div', { class: 'row' }, apiKey, h('button', { type: 'button', class: 'mini-button', text: 'Save key', onclick: async () => { try { toast((await call('settings:save-ai-key', apiKey.value)).message, 'ok'); apiKey.value = ''; drawModels(); } catch (error) { toast(error.message, 'error'); } } }))) : null,
        settingRow('Model', '', modelBox),
        settingRow('Connection', 'Loads the model to prove it can answer.', h('button', { type: 'button', class: 'mini-button', text: 'Test connection', onclick: drawModels })),
        ai.provider === 'ollama' ? settingRow('AI setup', 'Installs or repairs the AI engine and model.', h('button', { type: 'button', class: 'mini-button', text: 'Open AI setup', onclick: () => showSetup({ force: true }) })) : null,
        result
    ), section('Generation',
        settingRow('Temperature', 'Lower is more focused, higher more varied. 0 to 2.', numberBox(ai.temperature, value => set({ temperature: value }), { min: 0, max: 2, step: 0.1 })),
        settingRow('Top P', '0 to 1', numberBox(ai.topP, value => set({ topP: value }), { min: 0, max: 1, step: 0.05 })),
        settingRow('Context length', 'How much the model can consider at once. Higher uses more memory. Document and study work use more when needed.', numberBox(ai.contextLength, value => set({ contextLength: value }), { min: 2048, max: 262144, step: 1024 })),
        settingRow('Maximum reply length', 'In tokens. 0 means no limit.', numberBox(ai.maxOutputTokens, value => set({ maxOutputTokens: value }), { min: 0 })),
        settingRow('Tool calling', 'Automatic uses the model\'s tool support, or a text-based method when it has none.', selectBox([['auto', 'Automatic'], ['native', 'Always native'], ['json', 'Always text-based'], ['off', 'No tools']], ai.toolMode, value => set({ toolMode: value }))),
        settingRow('Steps per request', 'The most tool rounds in a single request.', numberBox(ai.maxAgentSteps, value => set({ maxAgentSteps: value }), { min: 1, max: 20 })),
        settingRow('Start Ollama if it is not running', '', checkbox(ai.autoStartOllama, value => set({ autoStartOllama: value }))),
        settingRow('Embedding model', 'Optional. An Ollama embedding model such as nomic-embed-text adds search by meaning. Keyword search always works.', textBox(ai.embeddingModel, value => set({ embeddingModel: value }))),
        settingRow('Rebuild meaning search', 'Run this after choosing an embedding model.', h('button', { type: 'button', class: 'mini-button', text: 'Rebuild', onclick: async () => { try { toast(`Updated ${(await call('documents:reindex')).count} document(s).`, 'ok'); } catch (error) { toast(error.message, 'error'); } } }))
    ));
    drawModels();
}
async function renderVoiceSettings(box) {
    const { voice } = appSettings;
    const set = changes => save({ voice: changes });
    const micBox = h('div', { class: 'muted small', text: 'Looking for microphones…' });
    const voiceBox = h('div', { class: 'muted small', text: 'Looking for voices…' });
    const wake = checkbox(voice.wakeWordEnabled, async value => { await set({ wakeWordEnabled: value }); setWakeWordListening(value); });
    box.replaceChildren(section('Voice',
        settingRow('Microphone', '', micBox),
        settingRow('Spoken replies', '', checkbox(voice.spokenReplies, value => set({ spokenReplies: value }))),
        settingRow('Voice', '', voiceBox),
        settingRow('Speaking speed', 'Words per minute, 80 to 320.', numberBox(voice.rate, value => set({ rate: value }), { min: 80, max: 320, step: 5 })),
        settingRow('Pause before sending', 'Seconds of silence that end your request.', numberBox(voice.silenceSeconds, value => set({ silenceSeconds: value }), { min: 0.4, max: 5, step: 0.1 })),
        settingRow('Test speech', '', h('button', { type: 'button', class: 'mini-button', text: 'Speak a sample', onclick: () => ipcRenderer.send('speak-response', 'This is how Nexus sounds.') }))
    ), section('Voice privacy and background listening',
        h('p', { class: 'muted small', text: 'Speech recognition sends the audio of what you say to Google to be transcribed. Spoken replies stay on this computer. The microphone is used only while you press the orb, or while the option below is on.' }),
        settingRow('Listen for a wake phrase', 'Off by default. While on, the microphone stays active, and every phrase it hears is sent to Google to check for the wake phrase.', wake),
        settingRow('Wake phrase', '', textBox(voice.wakeWord, value => set({ wakeWord: value.toLowerCase() }))),
        settingRow('Keep listening after replies', 'While the wake phrase is on, Nexus listens for a few seconds after answering, so you can carry on without saying the wake phrase again.', checkbox(voice.followUp, value => set({ followUp: value })))
    ));
    const devices = await ipcRenderer.invoke('voice:devices');
    micBox.replaceWith(devices.ok === false ? h('span', { class: 'error-text small', text: devices.message }) : selectBox([['', 'System default'], ...devices.devices.map(device => [String(device.index), device.name])], String(voice.inputDevice), value => set({ inputDevice: value })));
    const voices = await ipcRenderer.invoke('voice:voices');
    voiceBox.replaceWith(voices.ok === false ? h('span', { class: 'error-text small', text: voices.message }) : selectBox([['', 'System default'], ...voices.voices.map(item => [item.id, item.name])], voice.voiceId, value => set({ voiceId: value })));
}
function renderIntegrationSettings(box) { box.replaceChildren(); const panel = document.getElementById('settings-integrations'); panel.classList.remove('hidden'); refreshComposioStatus(); }
function renderPrivacySettings(box) {
    const { privacy } = appSettings;
    const set = changes => save({ privacy: changes });
    const permission = name => selectBox([['allow', 'Allow'], ['ask', 'Ask each time'], ['block', 'Block']], privacy.permissions[name], value => set({ permissions: { [name]: value } }));
    const folderList = h('div', { class: 'doc-list' });
    const drawFolders = () => folderList.replaceChildren(...appSettings.privacy.allowedFolders.filter(item => typeof item === 'string').map(folder => h('div', { class: 'doc-row' }, h('div', { class: 'grow doc-title', text: folder }), h('button', { type: 'button', class: 'mini-button danger', text: 'Remove', onclick: async () => { await set({ allowedFolders: appSettings.privacy.allowedFolders.filter(item => item !== folder) }); drawFolders(); } }))));
    const scriptList = h('div', { class: 'doc-list' });
    const drawScripts = () => scriptList.replaceChildren(...appSettings.privacy.approvedScripts.map(script => h('div', { class: 'doc-row' }, h('div', { class: 'grow' }, h('div', { class: 'doc-title', text: script.name }), h('div', { class: 'doc-meta', text: script.path })), h('button', { type: 'button', class: 'mini-button danger', text: 'Remove', onclick: async () => { await set({ approvedScripts: appSettings.privacy.approvedScripts.filter(item => item !== script) }); drawScripts(); } }))));
    const clear = (kind, label) => h('button', { type: 'button', class: 'mini-button danger', text: label, onclick: () => call('system:clear-data', kind).catch(error => toast(error.message, 'error')) });
    box.replaceChildren(section('Memory',
        settingRow('Use saved memories in replies', '', checkbox(privacy.memoryEnabled, value => set({ memoryEnabled: value }))),
        settingRow('Remember things automatically', 'Nexus saves lasting things you tell it, such as your preferences, people, projects, and plans, without being asked. It only reads what you say, never files or web pages, and skips passwords, money, and health details. Each new memory shows a notice, and you can delete any of them on the Memory page.', checkbox(privacy.autoRemember, value => set({ autoRemember: value }))),
        h('button', { type: 'button', class: 'mini-button', text: 'Open Memory', dataset: { nav: 'memory' } })
    ), section('Asking first',
        settingRow('Ask before Nexus acts', 'With "Only for risky actions", Nexus just does things, and only asks before deleting, sending emails or messages to other people from your accounts, and unlocking doors. Blocked categories below stay blocked.', selectBox([['important', 'For anything that changes something'], ['critical', 'Only for risky actions']], privacy.askBeforeActions, value => set({ askBeforeActions: value })))
    ), section('What Nexus may do',
        h('p', { class: 'muted small', text: 'Reading is always allowed in a category that isn\'t blocked. "Allow" lets ordinary changes through without asking. Sensitive actions always ask: closing apps, clicking on web pages, sorting files, connected-app changes, and scripts.' }),
        h('div', {}, Object.entries(CATEGORY_LABELS).map(([name, label]) => settingRow(label, '', permission(name))))
    ), section('Folders Nexus may use',
        h('p', { class: 'muted small', text: 'Your Documents, Desktop, Downloads, Pictures, Music, Videos, and OneDrive are included. Credential files and Nexus\'s own private data are always off limits.' }),
        folderList,
        h('button', { type: 'button', class: 'mini-button', text: 'Add a folder', onclick: async () => { const result = await call('settings:pick-folder'); if (!result.canceled) { await set({ allowedFolders: [...appSettings.privacy.allowedFolders, result.path] }); drawFolders(); } } })
    ), section('Approved scripts',
        h('p', { class: 'muted small', text: 'Nexus can run only the scripts listed here, and it asks each time. It cannot run any other command.' }),
        scriptList,
        h('button', { type: 'button', class: 'mini-button', text: 'Add a script', onclick: async () => { const result = await call('settings:pick-script'); if (result.canceled) return; const name = await promptModal('Name this script', { value: result.path.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') }); if (name) { await set({ approvedScripts: [...appSettings.privacy.approvedScripts, { name, path: result.path }] }); drawScripts(); } } })
    ), section('Your data',
        h('p', { class: 'muted small', text: 'All of this is stored only on this computer. Deleting cannot be undone, and Nexus restarts afterward.' }),
        h('div', { class: 'row wrap' }, clear('conversations', 'Delete conversations'), clear('memories', 'Delete memories'), clear('research', 'Delete research'), clear('study', 'Delete study data'), clear('history', 'Delete activity history'))
    ));
    drawFolders(); drawScripts();
}
async function renderAdvancedSettings(box) {
    const report = h('div', { class: 'muted small', text: 'Checking…' });
    const logs = h('div', { class: 'log-box', text: '' });
    const refreshLogs = async () => { logs.textContent = (await ipcRenderer.invoke('system:logs')) || 'The log is empty.'; logs.scrollTop = logs.scrollHeight; };
    const result = text => { toast(text, 'ok'); };
    box.replaceChildren(section('Debug',
        settingRow('Debug logging', 'Adds detail to the log. Secrets are removed either way.', checkbox(appSettings.advanced.debug, value => save({ advanced: { debug: value } })))
    ), section('Diagnostics', report), section('Backup and restore',
        h('p', { class: 'muted small', text: 'A backup holds your settings, conversations, apps, tasks, study data, and memories. It does not hold API keys, and it is not encrypted, so keep it somewhere safe.' }),
        h('div', { class: 'row wrap' },
            h('button', { type: 'button', class: 'mini-button', text: 'Create backup', onclick: async () => { try { const saved = await call('system:backup'); if (!saved.canceled) result(saved.message); } catch (error) { toast(error.message, 'error'); } } }),
            h('button', { type: 'button', class: 'mini-button', text: 'Restore backup', onclick: () => call('system:restore').catch(error => toast(error.message, 'error')) }),
            h('button', { type: 'button', class: 'mini-button', text: 'Open data folder', onclick: () => call('system:open-data-folder') }))
    ), section('Log', h('button', { type: 'button', class: 'mini-button', text: 'Refresh', onclick: refreshLogs }), logs));
    refreshLogs();
    const data = await ipcRenderer.invoke('system:diagnostics');
    if (data.ok === false) { report.textContent = data.message; return; }
    const line = (label, good, detail) => h('div', { class: 'setting' }, h('label', { text: label }), h('div', { class: good ? 'diag-ok' : 'diag-bad', text: detail }));
    const missing = Object.entries(data.pythonModules).filter(([name, present]) => !['version', 'error', 'bundled'].includes(name) && !present).map(([name]) => name);
    report.replaceWith(h('div', {},
        line('Nexus', true, `${data.app} · Electron ${data.electron} · ${data.platform}`),
        line('AI', Boolean(data.ai.ready), data.ai.message),
        line('Composio', Boolean(data.composio.verified), data.composio.message),
        line('Voice and document helpers', !data.pythonModules.error && !missing.length, data.pythonModules.error || `${data.pythonModules.bundled ? 'Built in' : `Python ${data.pythonModules.version}`}${missing.length ? `; missing ${missing.filter(name => name !== 'bundled').join(', ')}` : '; all found'}`),
        line('Browsers', data.browsers.length > 0, data.browsers.map(item => item.id).join(', ') || 'None found'),
        line('Secure key storage', data.secureStorage, data.secureStorage ? 'Available' : 'Unavailable')
    ));
}
function bindSettings() {
    const PANELS = { general: ['General', renderGeneralSettings], appearance: ['Appearance', renderAppearanceSettings], ai: ['AI', renderAiSettings], voice: ['Voice', renderVoiceSettings], integrations: ['Integrations', renderIntegrationSettings], privacy: ['Privacy', renderPrivacySettings], advanced: ['Advanced', renderAdvancedSettings] };
    let current = 'general';
    const select = tabs('settings-tabs', Object.entries(PANELS).map(([id, [label]]) => [id, label]), id => {
        current = id;
        document.getElementById('settings-integrations').classList.toggle('hidden', id !== 'integrations');
        Promise.resolve(PANELS[id][1](document.getElementById('settings-body'))).catch(error => toast(error.message, 'error'));
    });
    PAGE_HOOKS.settings = () => select(current);
}
