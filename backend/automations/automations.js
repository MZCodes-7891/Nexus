const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CollectionStore } = require('../core/store');
const { nextOccurrence } = require('../core/when');
const { parseJson } = require('../study/study');

const TRIGGERS = ['manual', 'schedule', 'app_start', 'study_start', 'file_download'];

function sanitizeAutomation(input, existing = {}) {
  const name = String(input.name || existing.name || '').trim().slice(0, 80);
  if (!name) throw new Error('An automation needs a name.');
  const type = TRIGGERS.includes(input.trigger?.type) ? input.trigger.type : 'manual';
  const trigger = { type };
  if (type === 'schedule') {
    if (!/^\d{1,2}:\d{2}$/.test(String(input.trigger.time || ''))) throw new Error('A scheduled automation needs a time like 16:30.');
    trigger.time = String(input.trigger.time);
    trigger.days = (Array.isArray(input.trigger.days) ? input.trigger.days : [0, 1, 2, 3, 4, 5, 6]).map(Number).filter(day => day >= 0 && day <= 6);
    if (!trigger.days.length) throw new Error('Choose at least one day.');
  }
  if (type === 'file_download') trigger.extensions = (Array.isArray(input.trigger.extensions) ? input.trigger.extensions : ['pdf']).map(item => String(item).replace(/^\./, '').toLowerCase().slice(0, 8));
  const steps = (Array.isArray(input.steps) ? input.steps : []).slice(0, 20).map(step => step?.tool
    ? { tool: String(step.tool).slice(0, 64), args: step.args && typeof step.args === 'object' && !Array.isArray(step.args) ? step.args : {} }
    : { prompt: String(step?.prompt || '').trim().slice(0, 1000) }).filter(step => step.tool || step.prompt);
  if (!steps.length) throw new Error('An automation needs at least one step.');
  const condition = ['none', 'weekdays', 'weekends'].includes(input.condition) ? input.condition : 'none';
  const conditions = (Array.isArray(input.conditions) ? input.conditions : []).slice(0, 8).map(sanitizeCondition).filter(Boolean);
  return { name, trigger, steps, condition, conditions, enabled: input.enabled === undefined ? existing.enabled ?? true : Boolean(input.enabled) };
}
const validTime = value => /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(value));
function sanitizeCondition(item) {
  if (item?.type === 'time_between' && validTime(item.from) && validTime(item.to)) return { type: item.type, from: item.from, to: item.to };
  if (item?.type === 'file_name_contains' && String(item.text || '').trim()) return { type: item.type, text: String(item.text).trim().slice(0, 80) };
  if (item?.type === 'on_days' && Array.isArray(item.days) && item.days.length) return { type: item.type, days: item.days.map(Number).filter(day => day >= 0 && day <= 6) };
  return null;
}
function minutesOf(value) { const [hour, minute] = String(value).split(':').map(Number); return hour * 60 + minute; }
// All must hold for the automation to run. A window like 22:00 to 06:00 wraps past midnight.
function conditionsMet(conditions = [], now = new Date(), context = {}) {
  return conditions.every(item => {
    if (item.type === 'on_days') return item.days.includes(now.getDay());
    if (item.type === 'file_name_contains') return path.basename(String(context.file || '')).toLowerCase().includes(item.text.toLowerCase());
    if (item.type === 'time_between') { const current = now.getHours() * 60 + now.getMinutes(); const from = minutesOf(item.from); const to = minutesOf(item.to); return from <= to ? current >= from && current <= to : current >= from || current <= to; }
    return true;
  });
}
// {{file}} in a step becomes the file that set off the automation.
function fillPlaceholders(value, context) {
  if (typeof value === 'string') return value.replace(/\{\{file\}\}/g, context.file || '');
  if (Array.isArray(value)) return value.map(item => fillPlaceholders(item, context));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fillPlaceholders(item, context)]));
  return value;
}
function conditionMet(condition, now = new Date()) {
  const weekend = [0, 6].includes(now.getDay());
  return condition === 'weekdays' ? !weekend : condition === 'weekends' ? weekend : true;
}

// Reusable workflows. Steps go through the same permission checks as the chat agent, so an automation can't quietly do what a chat could not.
function createAutomations({ dataDir, registry, permissions, models, runPrompt, notify, logger, getDownloadsDir, confirm }) {
  const store = new CollectionStore(path.join(dataDir, 'automations.json'));
  const history = new CollectionStore(path.join(dataDir, 'automation-history.json'));
  let watcher = null;
  let lastFired = new Map();
  const running = new Set();

  async function create(input) { const automation = { id: crypto.randomUUID(), ...sanitizeAutomation(input), createdAt: new Date().toISOString(), lastRunAt: '', lastStatus: '' }; await store.upsert(automation); return automation; }
  async function update(id, input) { const current = await store.get(id); if (!current) throw new Error('That automation no longer exists.'); return store.patch(id, sanitizeAutomation({ ...current, ...input }, current)); }
  async function run(id, { reason = 'manual', context = {} } = {}) {
    const automation = await store.get(id);
    if (!automation) throw new Error('That automation no longer exists.');
    if (running.has(id)) return { ok: false, error: 'This automation is already running.' };
    running.add(id);
    const results = [];
    let status = 'completed';
    try {
      for (const step of automation.steps) {
        if (step.tool) {
          const tool = registry.get(step.tool);
          if (!tool) { results.push({ step: step.tool, ok: false, error: 'That tool no longer exists.' }); status = 'failed'; break; }
          // Scheduled runs have no one watching, so a sensitive step that gets declined stops the workflow rather than skipping ahead.
          const args = fillPlaceholders(step.args, context);
          const decision = await permissions.authorize(tool, args);
          if (!decision.allowed) { results.push({ step: step.tool, ok: false, error: decision.reason }); status = 'stopped'; break; }
          try {
            const result = await tool.handler(args, { automation: true, logger, signal: AbortSignal.timeout(180000) });
            const ok = result?.ok !== false && !result?.error;
            results.push({ step: step.tool, ok, message: String(result?.message || result?.error || '').slice(0, 300) });
            if (!ok) { status = 'failed'; break; }
          } catch (error) { results.push({ step: step.tool, ok: false, error: String(error.message).slice(0, 300) }); status = 'failed'; break; }
        } else {
          try {
            const reply = await runPrompt(`${fillPlaceholders(step.prompt, context)}${context.file && !step.prompt.includes('{{file}}') ? `\nThe new file is: ${context.file}` : ''}`);
            results.push({ step: step.prompt.slice(0, 80), ok: true, message: String(reply).slice(0, 300) });
          } catch (error) { results.push({ step: step.prompt.slice(0, 80), ok: false, error: String(error.message).slice(0, 300) }); status = 'failed'; break; }
        }
      }
    } finally { running.delete(id); }
    const at = new Date().toISOString();
    await store.patch(id, { lastRunAt: at, lastStatus: status });
    await history.update(items => [{ id: crypto.randomUUID(), automationId: id, name: automation.name, reason, status, results, at }, ...items].slice(0, 200));
    if (status !== 'completed') await notify({ title: `Automation ${status}: ${automation.name}`, body: results.at(-1)?.error || 'See Automations for details.', kind: 'automation' });
    logger?.info(`automation "${automation.name}" ${status} (${reason})`);
    return { ok: status === 'completed', status, results, message: `Automation "${automation.name}" ${status}.` };
  }
  async function fireTrigger(type, context = {}) {
    const items = (await store.list()).filter(item => item.enabled && item.trigger.type === type && conditionMet(item.condition) && conditionsMet(item.conditions, new Date(), context));
    for (const item of items) {
      if (type === 'file_download' && !item.trigger.extensions?.some(extension => String(context.file || '').toLowerCase().endsWith(`.${extension}`))) continue;
      run(item.id, { reason: type, context }).catch(error => logger?.error(`automation failed: ${error.message}`));
    }
    return items.length;
  }
  async function tick(now = new Date()) {
    for (const item of await store.list()) {
      if (!item.enabled || item.trigger.type !== 'schedule' || !conditionMet(item.condition, now) || !conditionsMet(item.conditions, now)) continue;
      const previous = nextOccurrence(item.trigger, new Date(now.getTime() - 61000));
      if (!previous || previous > now) continue;
      const key = `${item.id}|${previous.toISOString()}`;
      if (lastFired.get(item.id) === key) continue;
      lastFired.set(item.id, key);
      run(item.id, { reason: 'schedule' }).catch(error => logger?.error(`automation failed: ${error.message}`));
    }
  }
  // Runs only when an enabled automation asks for it, so Nexus doesn't watch the Downloads folder otherwise.
  async function syncWatcher() {
    const wanted = (await store.list()).some(item => item.enabled && item.trigger.type === 'file_download');
    if (!wanted) { watcher?.close(); watcher = null; return; }
    if (watcher) return;
    const seen = new Map();
    watcher = fs.watch(getDownloadsDir(), (event, name) => {
      if (event !== 'rename' || !name || /\.(crdownload|tmp|part|opdownload)$/i.test(name)) return;
      const full = path.join(getDownloadsDir(), name);
      if (seen.has(full) && Date.now() - seen.get(full) < 30000) return;
      if (!fs.existsSync(full)) return;
      seen.set(full, Date.now());
      fireTrigger('file_download', { file: full });
    });
    watcher.on('error', error => logger?.warn(`downloads watcher stopped: ${error.message}`));
  }
  // Natural language to a draft the user reviews and saves; nothing runs until they do.
  async function draftFromText(text) {
    // Only the tools plausibly relevant, since the full list overflows a small model's context.
    const tools = registry.select(text, { max: 16 }).filter(tool => !tool.agentOnly && tool.name !== 'plan_task').map(tool => `${tool.name}: ${tool.description.slice(0, 100)} args=${JSON.stringify(Object.keys(tool.parameters?.properties || {}))}`).join('\n');
    const reply = await models.chat({ messages: [
      { role: 'system', content: `Convert the user's request into a Nexus automation. Return JSON only: {"name":"short name","trigger":{"type":"manual|schedule|app_start|study_start|file_download","time":"HH:MM (24h, schedule only)","days":[0-6 Sunday=0, schedule only],"extensions":["pdf" for file_download only]},"condition":"none|weekdays|weekends","steps":[{"tool":"tool_name","args":{}} or {"prompt":"instruction for the AI assistant"}]}. Prefer a tool step when one fits exactly; otherwise use a prompt step. For a repeating reminder use notify_user, since the schedule already handles the timing. Tool args must be a JSON object with named keys. In a file_download automation, {{file}} stands for the new file. Use only these tools:\n${tools}` },
      { role: 'user', content: String(text).slice(0, 1000) }
    ], format: 'json', contextLength: 16384, maxTokens: 800 });
    const draft = parseJson(reply.content);
    // Models sometimes give tool arguments as a list. Line them up with the tool's named parameters, and turn an unknown tool into a plain instruction.
    draft.steps = (Array.isArray(draft.steps) ? draft.steps : []).map(step => {
      if (!step?.tool) return step;
      const tool = registry.get(step.tool);
      if (!tool) return { prompt: String(text) };
      if (!Array.isArray(step.args)) return step;
      const names = Object.keys(tool.parameters?.properties || {});
      return { tool: step.tool, args: Object.fromEntries(step.args.map((value, index) => [names[index], value]).filter(([name, value]) => name && value !== null)) };
    });
    return sanitizeAutomation(draft);
  }
  return { create, update, remove: async id => { const removed = await store.remove(id); await syncWatcher(); return removed; }, list: () => store.list(), history: () => history.list(), run, fireTrigger, tick, syncWatcher, draftFromText, stop: () => { watcher?.close(); watcher = null; } };
}

module.exports = { createAutomations, sanitizeAutomation, conditionMet, conditionsMet, fillPlaceholders };
