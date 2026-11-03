// Shared page helpers. Everything is built with text nodes, so model and web output can never become markup.
const bridge = window.nexusBridge;
const listenerRegistry = new Map();
const ipcRenderer = {
    invoke: (channel, ...args) => bridge.invoke(channel, ...args),
    send: (channel, ...args) => bridge.send(channel, ...args),
    on(channel, handler) { const off = bridge.on(channel, (...args) => handler({}, ...args)); listenerRegistry.set(handler, off); },
    removeListener(_channel, handler) { listenerRegistry.get(handler)?.(); listenerRegistry.delete(handler); }
};

function h(tag, props = {}, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
        if (value === undefined || value === null || value === false) continue;
        if (key === 'class') element.className = value;
        else if (key === 'text') element.textContent = value;
        else if (key === 'dataset') Object.assign(element.dataset, value);
        else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), value);
        else if (key === 'value') element.value = value;
        else if (key === 'checked' || key === 'disabled' || key === 'selected' || key === 'multiple' || key === 'draggable') element[key] = Boolean(value);
        else element.setAttribute(key, value);
    }
    for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) element.append(child);
    return element;
}
const SVG_NS = 'http://www.w3.org/2000/svg';
// Icons are plain path data drawn through DOM APIs rather than parsed markup.
const ICONS = {
    home: ['M3 11.5 12 4l9 7.5', 'M5.5 10v9.5h13V10', 'M10 19.5v-5h4v5'],
    chat: ['M4 5h16v11H9l-5 4z', 'M8 9.5h8', 'M8 12.5h5'],
    apps: ['M4 4h6.5v6.5H4z', 'M13.5 4H20v6.5h-6.5z', 'M4 13.5h6.5V20H4z', 'M13.5 13.5H20V20h-6.5z'],
    docs: ['M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z', 'M14 3v6h6', 'M8 14h8', 'M8 17.5h5'],
    school: ['M2.5 9 12 4.5 21.5 9 12 13.5z', 'M6.5 11.5V16c1.5 1.5 3.5 2.2 5.5 2.2s4-.7 5.5-2.2v-4.5', 'M21.5 9v6'],
    research: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'm20.5 20.5-4.6-4.6'],
    tasks: ['M4 5h16v15H4z', 'm8 12 3 3 5-6'],
    calendar: ['M4 6h16v14H4z', 'M4 10.5h16', 'M8.5 3.5v4', 'M15.5 3.5v4'],
    automations: ['M13 3 5 13.5h6L10 21l9-11h-6.5z'],
    'composio-dash': ['M10 13a5 5 0 0 0 7.1 0l2.1-2.1a5 5 0 0 0-7.1-7.1l-1.2 1.2', 'M14 11a5 5 0 0 0-7.1 0l-2.1 2.1a5 5 0 0 0 7.1 7.1l1.2-1.2'],
    hub: ['M4 7h10', 'M18 7h2', 'M14 5v4h4V5z', 'M4 17h2', 'M10 17h10', 'M6 15v4h4v-4z'],
    memory: ['M9 3.5a3.5 3.5 0 0 0-3.4 4.3A3.8 3.8 0 0 0 5 14.6 3.6 3.6 0 0 0 9 20.5a3 3 0 0 0 3-3V6.5a3 3 0 0 0-3-3z', 'M15 3.5a3.5 3.5 0 0 1 3.4 4.3 3.8 3.8 0 0 1 .6 6.8 3.6 3.6 0 0 1-4 5.9 3 3 0 0 1-3-3'],
    settings: ['M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z', 'M12 2.5v3', 'M12 18.5v3', 'M2.5 12h3', 'M18.5 12h3', 'm5.3 5.3 2.1 2.1', 'm16.6 16.6 2.1 2.1', 'm18.7 5.3-2.1 2.1', 'm7.4 16.6-2.1 2.1'],
    bell: ['M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z', 'M10 21h4'],
    chevron: ['m14.5 6-6 6 6 6']
};
function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    for (const data of ICONS[name] || []) { const path = document.createElementNS(SVG_NS, 'path'); path.setAttribute('d', data); svg.appendChild(path); }
    return svg;
}
function toast(message, kind = '') {
    const node = h('div', { class: 'toast', text: String(message), dataset: { kind } });
    document.getElementById('toast-root').append(node);
    setTimeout(() => node.remove(), kind === 'error' ? 8000 : 4000);
}
// IPC handlers return { ok:false, message } on failure; this turns that into an exception pages can catch in one place.
async function call(channel, ...args) {
    const result = await ipcRenderer.invoke(channel, ...args);
    if (result && result.ok === false && !result.canceled) throw new Error(result.message || result.error || 'That did not work.');
    return result;
}
function setLine(id, text, kind = '') { const el = document.getElementById(id); if (el) { el.textContent = text; el.dataset.kind = kind; } }

function modal(title, body, actions) {
    const root = document.getElementById('modal-root');
    const previousFocus = document.activeElement;
    const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey); previousFocus?.focus?.(); };
    const onKey = event => { if (event.key === 'Escape') close(); };
    const buttons = (actions || [{ label: 'Close' }]).map(action => h('button', { type: 'button', class: action.primary ? 'action-btn-primary' : action.danger ? 'integration-button danger' : 'integration-button secondary', text: action.label, onclick: async () => {
        try { if (action.run) { if (await action.run() === false) return; } close(); }
        catch (error) { toast(error.message, 'error'); }
    } }));
    const dialog = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h3', { text: title }), body, h('div', { class: 'modal-actions' }, buttons));
    const backdrop = h('div', { class: 'modal-backdrop', onmousedown: event => { if (event.target === backdrop) close(); } }, dialog);
    root.append(backdrop);
    document.addEventListener('keydown', onKey);
    dialog.querySelector('input,select,textarea,button')?.focus();
    return { close, dialog };
}
function promptModal(title, { label = '', value = '', placeholder = '' } = {}) {
    return new Promise(resolve => {
        const input = h('input', { type: 'text', value, placeholder, 'aria-label': label || title });
        const m = modal(title, h('div', {}, label ? h('label', { text: label }) : null, input), [{ label: 'Cancel', run: () => resolve(null) }, { label: 'Save', primary: true, run: () => resolve(input.value) }]);
        input.addEventListener('keydown', event => { if (event.key === 'Enter') { resolve(input.value); m.close(); } });
    });
}
function confirmModal(title, message, confirmLabel = 'Confirm', danger = true) {
    return new Promise(resolve => modal(title, h('p', { class: 'muted', text: message }), [{ label: 'Cancel', run: () => resolve(false) }, { label: confirmLabel, danger, primary: !danger, run: () => resolve(true) }]));
}
function formatWhen(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const today = new Date();
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (date.toDateString() === today.toDateString()) return `Today ${time}`;
    if (date.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}
function formatSize(bytes) { if (!bytes) return ''; const units = ['B', 'KB', 'MB', 'GB']; let value = bytes, index = 0; while (value >= 1024 && index < 3) { value /= 1024; index++; } return `${value.toFixed(index ? 1 : 0)} ${units[index]}`; }
function debounce(fn, ms = 250) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); }; }
function tabs(containerId, items, onChange) {
    const container = document.getElementById(containerId);
    const select = id => {
        container.querySelectorAll('.tab').forEach(tab => { const active = tab.dataset.tab === id; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); });
        onChange(id);
    };
    container.replaceChildren(...items.map(([id, label]) => h('button', { type: 'button', class: 'tab', role: 'tab', dataset: { tab: id }, text: label, onclick: () => select(id) })));
    return select;
}
function emptyState(text) { return h('div', { class: 'empty', text }); }
