const { JsonStore } = require('./store');

const DEFAULTS = {
  general: { setupDone: false, userName: '', startPage: 'home', launchAtLogin: false, startMinimized: false, closeToTray: false, notifications: true, language: 'English', city: '', newsTopic: '', newsOn: false, autoUpdate: true, phoneNotifications: true, morningBriefing: true, briefingTime: '07:00', phonePage: false, stayAwake: true },
  appearance: { theme: 'navy', accent: '#38bdf8', fontFamily: 'Segoe UI', fontSize: 14, animations: true, sidebarCollapsed: false, sidebarSide: 'left', density: 'comfortable', chatWidth: 'normal', corners: 'rounded', glow: true, hiddenPages: [], pageOrder: [] },
  ai: { provider: 'ollama', model: 'qwen2.5:latest', baseUrl: 'http://127.0.0.1:11434', openaiBaseUrl: 'http://127.0.0.1:1234/v1', temperature: 0.4, topP: 0.9, contextLength: 8192, maxOutputTokens: 0, toolMode: 'auto', maxAgentSteps: 8, autoStartOllama: true, embeddingModel: '' },
  voice: { inputDevice: '', voiceId: '', rate: 175, volume: 100, pitch: 0, spokenReplies: true, wakeWordEnabled: false, followUp: true, wakeWord: 'hey nexus', silenceSeconds: 1.2 },
  browser: { preferred: 'auto', researchHidden: true },
  smartHome: { url: '' },
  study: { curriculum: 'ab-science-9' },
  focus: { minutes: 25, apps: ['Discord', 'Steam', 'Lunar Client', 'Modrinth App'] },
  sections: { newAs: 'ask', decided: [], seeded: false },
  privacy: { askBeforeActions: 'important', memoryEnabled: true, autoRemember: true, conversationMemory: true, indexDocuments: true, allowedFolders: [], approvedScripts: [], permissions: { computer: 'ask', files: 'ask', browser: 'ask', apps: 'allow', productivity: 'allow', documents: 'allow', research: 'allow', integrations: 'ask', automations: 'ask', school: 'allow', study: 'allow', memory: 'allow' } },
  advanced: { debug: false }
};

const LIMITS = { fontSize: [11, 20], temperature: [0, 2], topP: [0, 1], contextLength: [2048, 262144], maxOutputTokens: [0, 65536], maxAgentSteps: [1, 20], rate: [80, 320], silenceSeconds: [0.4, 5], volume: [0, 100], pitch: [-10, 10] };
const ENUMS = { askBeforeActions: ['important', 'critical'], theme: ['navy', 'midnight', 'black', 'purple', 'forest', 'crimson', 'slate', 'ocean'], sidebarSide: ['left', 'right'], curriculum: ['', 'ab-science-9'], newAs: ['ask', 'private', 'public'], density: ['compact', 'comfortable', 'spacious'], chatWidth: ['normal', 'wide', 'full'], corners: ['rounded', 'soft', 'square'], provider: ['ollama', 'openai'], toolMode: ['auto', 'native', 'json', 'off'], preferred: ['auto', 'chrome', 'edge', 'opera', 'brave'] };
const POLICIES = ['allow', 'ask', 'block'];

function isPlainObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }

// Only keys that exist in the defaults are accepted, each coerced to the default's type.
function sanitize(defaults, input) {
  const output = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = isPlainObject(input) ? input[key] : undefined;
    if (isPlainObject(fallback)) {
      if (key === 'permissions') { output[key] = {}; for (const [name, policy] of Object.entries(fallback)) output[key][name] = POLICIES.includes(value?.[name]) ? value[name] : policy; }
      else output[key] = sanitize(fallback, value);
    } else if (Array.isArray(fallback)) output[key] = Array.isArray(value) ? value.filter(item => typeof item === 'string' || isPlainObject(item)).slice(0, 100) : fallback;
    else if (typeof fallback === 'boolean') output[key] = typeof value === 'boolean' ? value : fallback;
    else if (typeof fallback === 'number') {
      const number = Number(value);
      const [min, max] = LIMITS[key] || [-Infinity, Infinity];
      output[key] = value !== undefined && value !== null && value !== '' && Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
    } else {
      const text = typeof value === 'string' ? value.trim().slice(0, 500) : fallback;
      output[key] = ENUMS[key] && !ENUMS[key].includes(text) ? fallback : text;
    }
  }
  return output;
}

function mergeDeep(base, changes) {
  const output = { ...base };
  for (const [key, value] of Object.entries(changes || {})) output[key] = isPlainObject(value) && isPlainObject(base[key]) ? mergeDeep(base[key], value) : value;
  return output;
}

class Settings {
  constructor(filePath, env = process.env) { this.store = new JsonStore(filePath, {}); this.env = env; this.current = null; this.listeners = new Set(); }
  async load() {
    this.current = sanitize(DEFAULTS, await this.store.read());
    if (this.env.NEXUS_OLLAMA_MODEL) this.current.ai.model = this.env.NEXUS_OLLAMA_MODEL;
    return this.current;
  }
  get() { return this.current || sanitize(DEFAULTS, {}); }
  async update(changes) {
    const next = sanitize(DEFAULTS, mergeDeep(this.get(), changes));
    if (/^https?:\/\//i.test(next.ai.baseUrl) === false) throw new Error('The Ollama address must start with http:// or https://.');
    if (/^https?:\/\//i.test(next.ai.openaiBaseUrl) === false) throw new Error('The endpoint address must start with http:// or https://.');
    this.current = next;
    await this.store.write(next);
    for (const listener of this.listeners) { try { listener(next); } catch {} }
    return next;
  }
  onChange(listener) { this.listeners.add(listener); }
}

module.exports = { Settings, DEFAULTS, sanitize };
