const path = require('path');
const crypto = require('crypto');
const { CollectionStore } = require('../core/store');
const { parseWhen, nextOccurrence } = require('../core/when');

const SENSITIVE_MEMORY = /\b(password|passcode|passwd|api[ _-]?key|secret key|private key|ssn|social insurance|social security|credit card|debit card|cvv|pin code|one[- ]time code)\b|\b(?:\d[ -]?){13,19}\b/i;

// Long-term memory: only what the user explicitly saves, never credentials, always editable.
function createMemory({ dataDir }) {
  const store = new CollectionStore(path.join(dataDir, 'nexus-memories.json'));
  const clean = text => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 800);
  async function list() { return store.list(); }
  async function remember(input, category = 'General') {
    const text = clean(input);
    if (!text) return { ok: false, message: 'Enter a memory to save.' };
    if (SENSITIVE_MEMORY.test(text)) return { ok: false, sensitive: true, message: 'That looks like a password or other sensitive detail, so Nexus did not save it.' };
    const memories = await list();
    const existing = memories.find(item => item.text.toLowerCase() === text.toLowerCase());
    if (existing) return { ok: true, added: false, item: existing };
    const item = { id: crypto.randomUUID(), text, category: String(category || 'General').slice(0, 40), createdAt: new Date().toISOString() };
    await store.write([item, ...memories].slice(0, 500));
    return { ok: true, added: true, item, message: `Saved: ${text}` };
  }
  async function edit(id, changes) {
    const text = changes.text === undefined ? undefined : clean(changes.text);
    if (text !== undefined && SENSITIVE_MEMORY.test(text)) throw new Error('That looks like a password or other sensitive detail, so it was not saved.');
    const update = {};
    if (text) update.text = text;
    if (changes.category) update.category = String(changes.category).slice(0, 40);
    return store.patch(id, update);
  }
  async function forget(input) {
    const target = clean(input).toLowerCase();
    if (!target) return false;
    const memories = await list();
    const remaining = memories.filter(item => item.text.toLowerCase() !== target && !item.text.toLowerCase().includes(target));
    if (remaining.length === memories.length) return false;
    await store.write(remaining);
    return true;
  }
  async function search(query) {
    const words = clean(query).toLowerCase().split(' ').filter(Boolean);
    return (await list()).map(item => ({ item, hits: words.filter(word => item.text.toLowerCase().includes(word)).length })).filter(entry => !words.length || entry.hits).sort((a, b) => b.hits - a.hits).map(entry => entry.item);
  }
  return { list, remember, edit, forget, search, remove: id => store.remove(id), clear: () => store.write([]) };
}

function createTasks({ dataDir }) {
  const store = new CollectionStore(path.join(dataDir, 'work-tasks.json'));
  const STATUSES = ['todo', 'in_progress', 'complete'];
  const PRIORITIES = ['high', 'medium', 'low'];
  async function list() {
    return (await store.list()).filter(task => task && typeof task.id === 'string').map(task => ({ description: '', category: '', ...task, status: STATUSES.includes(task.status) ? task.status : (task.done ? 'complete' : 'todo'), done: task.status === 'complete' || (!task.status && Boolean(task.done)) }));
  }
  function resolveDue(value) {
    if (!value) return '';
    const parsed = parseWhen(value);
    return parsed ? parsed.toISOString() : String(value).slice(0, 32);
  }
  async function create(input, project = {}) {
    const title = String(input?.title || input?.text || '').trim().slice(0, 180);
    if (!title) throw new Error('A task needs a title.');
    const status = STATUSES.includes(input.status) ? input.status : 'todo';
    const task = { id: crypto.randomUUID(), text: title, description: String(input.description || '').slice(0, 2000), category: String(input.category || '').slice(0, 40), status, done: status === 'complete', priority: PRIORITIES.includes(String(input.priority).toLowerCase()) ? String(input.priority).toLowerCase() : 'medium', dueDate: resolveDue(input.dueDate), projectId: String(input.projectId || project.projectId || '').slice(0, 100), projectTitle: String(input.projectTitle || project.projectTitle || 'General').slice(0, 80), createdAt: new Date().toISOString() , ...(input.minutes ? { minutes: Math.max(5, Math.min(480, Math.round(Number(input.minutes)))) } : {}) };
    await store.write([task, ...await list()]);
    return task;
  }
  async function update(input) {
    const tasks = await list();
    const task = tasks.find(item => item.id === String(input?.taskId || input?.id || ''));
    if (!task) throw new Error('That task was not found.');
    if (typeof input.done === 'boolean') { task.done = input.done; task.status = input.done ? 'complete' : 'todo'; }
    if (STATUSES.includes(input.status)) { task.status = input.status; task.done = input.status === 'complete'; }
    if (input.title || input.text) task.text = String(input.title || input.text).trim().slice(0, 180);
    if (input.description !== undefined) task.description = String(input.description).slice(0, 2000);
    if (input.category !== undefined) task.category = String(input.category).slice(0, 40);
    if (input.dueDate !== undefined) task.dueDate = resolveDue(input.dueDate);
    if (input.minutes !== undefined) task.minutes = Math.max(5, Math.min(480, Math.round(Number(input.minutes) || 30)));
    if (PRIORITIES.includes(String(input.priority).toLowerCase())) task.priority = String(input.priority).toLowerCase();
    await store.write(tasks);
    return task;
  }
  async function remove(id) { await store.remove(String(id)); return list(); }
  async function initialize(legacy = []) {
    let tasks = await list();
    if (!tasks.length && Array.isArray(legacy) && legacy.length) {
      tasks = legacy.filter(task => task && typeof task.text === 'string').map(task => ({ id: String(task.id || crypto.randomUUID()), text: task.text.slice(0, 180), description: '', category: '', done: Boolean(task.done), status: task.done ? 'complete' : 'todo', priority: 'medium', dueDate: '', projectId: '', projectTitle: 'General', createdAt: new Date().toISOString() }));
      await store.write(tasks);
    }
    return tasks;
  }
  return { list, create, update, remove, initialize };
}

// Events and reminders. A reminder is a stored schedule that a timer really fires; creating one is verified by reading the time back.
function createCalendar({ dataDir, notify, now = () => new Date() }) {
  const events = new CollectionStore(path.join(dataDir, 'calendar-events.json'));
  const reminders = new CollectionStore(path.join(dataDir, 'reminders.json'));
  const KINDS = ['event', 'study', 'assignment', 'test'];
  const REPEATS = ['none', 'daily', 'weekdays', 'weekly', 'monthly'];
  // A repeating event is stored once. Its dates are worked out when asked for, so changing the series changes every date.
  function occurrences(event, from, to) {
    const base = new Date(event.start);
    const inRange = at => at.getTime() >= from && at.getTime() <= to;
    if (!event.repeat || event.repeat === 'none') return inRange(base) ? [event] : [];
    const length = new Date(event.end).getTime() - base.getTime();
    const stop = Math.min(to, base.getTime() + 2 * 366 * 86400000);
    const dates = [];
    for (let step = 0, at = new Date(base); at.getTime() <= stop && step < 1500; step++) {
      if (event.repeat !== 'weekdays' || (at.getDay() > 0 && at.getDay() < 6)) if (inRange(at)) dates.push(new Date(at));
      if (event.repeat === 'monthly') {
        // The 31st falls back to the last day of shorter months, rather than spilling into the next one.
        const month = base.getMonth() + step + 1;
        const lastDay = new Date(base.getFullYear(), month + 1, 0).getDate();
        at = new Date(base.getFullYear(), month, Math.min(base.getDate(), lastDay), base.getHours(), base.getMinutes());
      } else at = new Date(at.getFullYear(), at.getMonth(), at.getDate() + (event.repeat === 'weekly' ? 7 : 1), base.getHours(), base.getMinutes());
    }
    return dates.map(at => ({ ...event, start: at.toISOString(), end: new Date(at.getTime() + length).toISOString(), seriesStart: event.start, repeating: true }));
  }
  // Open times in the coming days, ranked by when this person has studied before. With no history yet, it favours after-school hours.
  async function suggestTimes({ minutes = 45, count = 3, days = 7, busy = [] } = {}) {
    const length = Math.max(10, Math.min(480, Number(minutes) || 45)) * 60000;
    const current = now();
    const horizon = current.getTime() + days * 86400000;
    const all = await events.list();
    const taken = [...(await listEvents({ from: current, to: new Date(horizon) })), ...busy].map(item => [new Date(item.start).getTime(), new Date(item.end || item.start).getTime()]);
    const habit = {};
    for (const item of all.filter(entry => entry.kind === 'study')) { const hour = new Date(item.start).getHours(); habit[hour] = (habit[hour] || 0) + 1; }
    const usual = Object.entries(habit).sort((a, b) => b[1] - a[1])[0];
    const buffer = 15 * 60000;
    const slots = [];
    const first = new Date(current);
    first.setMinutes(first.getMinutes() < 30 ? 30 : 60, 0, 0);
    for (let at = first.getTime(); at + length <= horizon; at += 30 * 60000) {
      const date = new Date(at);
      const end = new Date(at + length);
      if (date.getHours() < 8 || end.getHours() >= 22 || end.toDateString() !== date.toDateString()) continue;
      if (taken.some(([start, stop]) => at < stop + buffer && at + length + buffer > start)) continue;
      const score = (habit[date.getHours()] || 0) * 3 + (date.getHours() >= 16 && date.getHours() < 20 ? 1 : 0) - Math.floor((at - current.getTime()) / 86400000) * 0.2;
      slots.push({ start: date.toISOString(), end: end.toISOString(), score, day: date.toDateString() });
    }
    const chosen = [];
    for (const slot of slots.sort((a, b) => b.score - a.score || a.start.localeCompare(b.start))) { if (chosen.length < count && !chosen.some(item => item.day === slot.day)) chosen.push(slot); }
    return { ok: true, reason: usual ? `Ranked by when you usually study, around ${Number(usual[0]) % 12 || 12} ${Number(usual[0]) < 12 ? 'AM' : 'PM'}.` : 'You have no study sessions yet, so these favour after-school hours.', slots: chosen.sort((a, b) => a.start.localeCompare(b.start)).map(({ start, end }) => ({ start, end })) };
  }
  async function weekSummary() {
    const current = now();
    const start = new Date(current.getFullYear(), current.getMonth(), current.getDate() - current.getDay());
    const end = new Date(start.getTime() + 7 * 86400000);
    const week = await listEvents({ from: start, to: end });
    const hours = item => Math.max(0, new Date(item.end).getTime() - new Date(item.start).getTime()) / 3600000;
    const perDay = {};
    for (const item of week) { const day = new Date(item.start).toLocaleDateString([], { weekday: 'long' }); perDay[day] = (perDay[day] || 0) + hours(item); }
    const busiest = Object.entries(perDay).sort((a, b) => b[1] - a[1])[0];
    const round = value => Math.round(value * 10) / 10;
    return { events: week.length, hours: round(week.reduce((sum, item) => sum + hours(item), 0)), studyHours: round(week.filter(item => item.kind === 'study').reduce((sum, item) => sum + hours(item), 0)), busiestDay: busiest?.[0] || '' };
  }
  async function addEvent(input) {
    const title = String(input.title || '').trim().slice(0, 160);
    if (!title) throw new Error('An event needs a title.');
    const start = input.start instanceof Date ? input.start : parseWhen(input.start, now());
    if (!start) throw new Error(`Could not understand the time "${input.start}".`);
    const end = input.end ? parseWhen(input.end, now()) : new Date(start.getTime() + Number(input.minutes || 60) * 60000);
    const event = { id: crypto.randomUUID(), title, kind: KINDS.includes(input.kind) ? input.kind : 'event', start: start.toISOString(), end: (end || start).toISOString(), notes: String(input.notes || '').slice(0, 1000), source: 'nexus', repeat: REPEATS.includes(input.repeat) ? input.repeat : 'none', course: String(input.course || '').slice(0, 60), createdAt: now().toISOString() };
    await events.upsert(event);
    return event;
  }
  async function updateEvent(id, input) {
    const changes = {};
    if (input.title) changes.title = String(input.title).slice(0, 160);
    if (input.start) { const start = parseWhen(input.start, now()); if (!start) throw new Error('Could not understand that time.'); changes.start = start.toISOString(); }
    if (input.end) { const end = parseWhen(input.end, now()); if (end) changes.end = end.toISOString(); }
    if (input.notes !== undefined) changes.notes = String(input.notes).slice(0, 1000);
    if (KINDS.includes(input.kind)) changes.kind = input.kind;
    if (REPEATS.includes(input.repeat)) changes.repeat = input.repeat;
    return events.patch(id, changes);
  }
  async function listEvents({ from, to } = {}) {
    const start = from ? new Date(from).getTime() : -Infinity;
    const end = to ? new Date(to).getTime() : Infinity;
    return (await events.list()).flatMap(event => occurrences(event, start, end)).sort((a, b) => a.start.localeCompare(b.start));
  }
  async function addReminder(input) {
    const text = String(input.text || input.title || '').trim().slice(0, 240);
    if (!text) throw new Error('A reminder needs something to remind you about.');
    const repeat = ['none', 'daily', 'weekdays', 'weekly'].includes(input.repeat) ? input.repeat : 'none';
    const at = parseWhen(input.when, now());
    if (!at) throw new Error(`Could not understand the time "${input.when}". Try "tomorrow at 5 PM".`);
    if (at <= now() && repeat === 'none') throw new Error(`${at.toLocaleString()} is already in the past.`);
    const reminder = { id: crypto.randomUUID(), text, at: at.toISOString(), repeat, status: 'scheduled', createdAt: now().toISOString(), firedAt: '' };
    await reminders.upsert(reminder);
    return reminder;
  }
  function nextRepeat(reminder, after) {
    const base = new Date(reminder.at);
    const time = `${String(base.getHours()).padStart(2, '0')}:${String(base.getMinutes()).padStart(2, '0')}`;
    const days = reminder.repeat === 'weekdays' ? [1, 2, 3, 4, 5] : reminder.repeat === 'weekly' ? [base.getDay()] : [0, 1, 2, 3, 4, 5, 6];
    return nextOccurrence({ time, days }, after);
  }
  // Called on a timer and at startup, so reminders due while Nexus was closed still appear (flagged as late).
  async function tick() {
    const current = now();
    const due = (await reminders.list()).filter(item => item.status === 'scheduled' && new Date(item.at) <= current);
    for (const reminder of due) {
      const late = current.getTime() - new Date(reminder.at).getTime() > 5 * 60000;
      await notify({ title: late ? 'Nexus reminder (missed while closed)' : 'Nexus reminder', body: reminder.text, kind: 'reminder', id: reminder.id });
      const next = reminder.repeat === 'none' ? null : nextRepeat(reminder, current);
      await reminders.patch(reminder.id, next ? { at: next.toISOString(), firedAt: current.toISOString() } : { status: 'fired', firedAt: current.toISOString() });
    }
    return due.length;
  }
  return { suggestTimes, weekSummary, addEvent, updateEvent, removeEvent: id => events.remove(id), listEvents, addReminder, listReminders: () => reminders.list(), removeReminder: id => reminders.remove(id), snoozeReminder: async (id, minutes = 10) => reminders.patch(id, { at: new Date(now().getTime() + minutes * 60000).toISOString(), status: 'scheduled' }), tick };
}

module.exports = { createMemory, createTasks, createCalendar, SENSITIVE_MEMORY };
