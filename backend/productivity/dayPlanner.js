// My Day: a timed plan for the day. Fixed things (school, classes and events, prayers, meals) are placed first, then the
// things to do fill the free time in order of importance, in blocks of up to 45 minutes with short breaks. The plan is
// saved per day; marking blocks done or skipped, or re-planning, keeps what is already done.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_ROUTINE = {
  wake: '07:00', bed: '22:00',
  school: { on: true, days: [1, 2, 3, 4, 5], start: '08:30', end: '15:30' },
  routine: [{ title: 'Dinner', time: '18:00', minutes: 45, days: [0, 1, 2, 3, 4, 5, 6] }],
  block: 45, breakMinutes: 10, alerts: true
};
const toMinutes = text => { const [hours, minutes] = String(text || '0:0').split(':').map(Number); return (hours || 0) * 60 + (minutes || 0); };
const dayKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const at = (date, minutes) => { const value = new Date(date); value.setHours(0, 0, 0, 0); value.setMinutes(minutes); return value; };
const minuteOf = (date, value) => { const start = new Date(date); start.setHours(0, 0, 0, 0); return Math.round((new Date(value).getTime() - start.getTime()) / 60000); };
const validTime = value => /^\d{1,2}:\d{2}$/.test(String(value || '')) && toMinutes(value) < 24 * 60;

function createDayPlanner({ dataDir, now = () => new Date() }) {
  const folder = path.join(dataDir, 'my-day');
  const read = async (name, fallback) => { try { return JSON.parse(await fs.promises.readFile(path.join(folder, name), 'utf8')); } catch { return fallback; } };
  const write = async (name, value) => { await fs.promises.mkdir(folder, { recursive: true }); await fs.promises.writeFile(path.join(folder, name), JSON.stringify(value, null, 2)); };

  async function routine() { const saved = await read('routine.json', {}); return { ...DEFAULT_ROUTINE, ...saved, school: { ...DEFAULT_ROUTINE.school, ...(saved.school || {}) } }; }
  async function setRoutine(input = {}) {
    const current = await routine();
    const next = { ...current };
    for (const key of ['wake', 'bed']) if (validTime(input[key])) next[key] = input[key].padStart(5, '0');
    if (toMinutes(next.bed) <= toMinutes(next.wake)) throw new Error('Bedtime has to be after wake-up time.');
    if (input.school) {
      const school = { ...current.school, ...input.school };
      school.on = Boolean(school.on);
      school.days = (Array.isArray(school.days) ? school.days : current.school.days).map(Number).filter(day => day >= 0 && day <= 6);
      if (!validTime(school.start) || !validTime(school.end) || toMinutes(school.end) <= toMinutes(school.start)) throw new Error('School has to end after it starts.');
      next.school = school;
    }
    if (Array.isArray(input.routine)) next.routine = input.routine.filter(item => item?.title && validTime(item.time)).slice(0, 12).map(item => ({ title: String(item.title).slice(0, 60), time: item.time.padStart(5, '0'), minutes: Math.max(5, Math.min(240, Math.round(Number(item.minutes) || 30))), days: Array.isArray(item.days) && item.days.length ? item.days.map(Number) : [0, 1, 2, 3, 4, 5, 6] }));
    if (input.block) next.block = Math.max(15, Math.min(90, Math.round(Number(input.block))));
    if (input.breakMinutes !== undefined) next.breakMinutes = Math.max(0, Math.min(30, Math.round(Number(input.breakMinutes))));
    if (input.alerts !== undefined) next.alerts = Boolean(input.alerts);
    await write('routine.json', next);
    return next;
  }

  // fixed: [{ title, start, end, kind }] already on the clock. todo: [{ key, title, minutes, score, kind, detail, action }].
  async function build({ date = now(), fixed = [], todo = [], keep = true } = {}) {
    const settings = await routine();
    const day = new Date(date); const weekday = day.getDay();
    const isToday = dayKey(day) === dayKey(now());
    const previous = keep ? await read(`${dayKey(day)}.json`, null) : null;
    const done = (previous?.blocks || []).filter(block => block.status === 'done' || block.status === 'skipped');
    const finishedKeys = new Set(done.filter(block => block.key).map(block => block.key));
    const wake = toMinutes(settings.wake); const bed = toMinutes(settings.bed);
    // Planning starts now (rounded up to 5 minutes) for today, or at wake-up for another day.
    const startMinute = isToday ? Math.max(wake, Math.ceil(minuteOf(day, now()) / 5) * 5) : wake;
    const busy = [];
    if (settings.school.on && settings.school.days.includes(weekday)) busy.push({ title: 'School', start: toMinutes(settings.school.start), end: toMinutes(settings.school.end), kind: 'school' });
    for (const item of settings.routine) if (item.days.includes(weekday)) busy.push({ title: item.title, start: toMinutes(item.time), end: toMinutes(item.time) + item.minutes, kind: 'routine' });
    for (const item of fixed) { const start = minuteOf(day, item.start); const end = Math.max(start + 5, minuteOf(day, item.end || item.start)); if (end > 0 && start < 24 * 60) busy.push({ title: item.title, start: Math.max(0, start), end: Math.min(24 * 60, end), kind: item.kind || 'event' }); }
    busy.sort((a, b) => a.start - b.start);
    // Time already used by finished blocks isn't free again.
    const taken = [...busy, ...done.map(block => ({ start: minuteOf(day, block.start), end: minuteOf(day, block.end) }))].sort((x, y) => x.start - y.start);
    // Free time between wake (or now) and bed, outside the busy blocks.
    const free = [];
    let cursor = startMinute;
    for (const block of taken) { if (block.start > cursor) free.push([cursor, Math.min(block.start, bed)]); cursor = Math.max(cursor, block.end); }
    if (cursor < bed) free.push([cursor, bed]);
    const gaps = free.filter(([start, end]) => end - start >= 15).map(([start, end]) => ({ start, end }));
    // Things to do, most important first, each split into blocks.
    const queue = todo.filter(item => !finishedKeys.has(item.key)).sort((a, b) => b.score - a.score).map(item => ({ ...item, left: Math.max(10, Math.round(item.minutes || 30)) }));
    const placed = [];
    let streak = 0;
    for (const gap of gaps) {
      let time = gap.start;
      while (time + 10 <= gap.end && queue.some(item => item.left > 0)) {
        const item = queue.find(entry => entry.left > 0);
        const length = Math.min(item.left, settings.block, gap.end - time);
        if (length < 10) break;
        placed.push({ key: item.key, title: item.title, detail: item.detail || '', kind: item.kind || 'task', action: item.action || null, start: time, end: time + length });
        item.left -= length; time += length; streak += length;
        // A break after about 90 minutes of work, if there's room.
        if (streak >= 90 && settings.breakMinutes && time + settings.breakMinutes <= gap.end) { placed.push({ title: 'Break', kind: 'break', start: time, end: time + settings.breakMinutes }); time += settings.breakMinutes; streak = 0; }
      }
      streak = 0;
    }
    const toBlock = item => ({ id: item.id || crypto.randomUUID(), key: item.key || '', title: item.title, detail: item.detail || '', kind: item.kind, action: item.action || null, start: at(day, item.start).toISOString(), end: at(day, item.end).toISOString(), status: item.status || 'planned' });
    const doneAt = new Set(done.map(block => `${block.title}|${block.start}`));
    const blocks = [...done, ...busy.filter(block => block.end > startMinute || !isToday).map(toBlock).filter(block => !doneAt.has(`${block.title}|${block.start}`)), ...placed.map(toBlock)]
      .sort((a, b) => a.start.localeCompare(b.start));
    const plan = { day: dayKey(day), madeAt: now().toISOString(), wake: settings.wake, bed: settings.bed, blocks, notFitted: queue.filter(item => item.left > 0).map(item => ({ title: item.title, minutes: item.left })), freeMinutes: gaps.reduce((sum, gap) => sum + gap.end - gap.start, 0) };
    await write(`${plan.day}.json`, plan);
    return plan;
  }
  async function get(date = now()) { return read(`${dayKey(new Date(date))}.json`, null); }
  async function mark({ day, id, status }) {
    const plan = await get(day ? new Date(`${day}T12:00`) : now());
    const block = plan?.blocks.find(item => item.id === id);
    if (!block) throw new Error('That block is not in the plan anymore.');
    block.status = ['done', 'skipped', 'planned'].includes(status) ? status : 'done';
    await write(`${plan.day}.json`, plan);
    return plan;
  }
  // Blocks starting now, not yet announced: for the "time for…" alerts.
  async function starting() {
    const plan = await get();
    if (!plan) return [];
    const settings = await routine();
    if (!settings.alerts) return [];
    const time = now().getTime();
    const due = plan.blocks.filter(block => block.status === 'planned' && !block.announced && ['task', 'study', 'assignment', 'test', 'quran'].includes(block.kind) && new Date(block.start).getTime() <= time && new Date(block.start).getTime() > time - 5 * 60000);
    if (due.length) { for (const block of due) block.announced = true; await write(`${plan.day}.json`, plan); }
    return due;
  }
  // How the day went: done, skipped, and what's left.
  async function review(date = now()) {
    const plan = await get(date);
    if (!plan) return null;
    const work = plan.blocks.filter(block => !['school', 'routine', 'event', 'prayer', 'break'].includes(block.kind));
    const minutes = list => list.reduce((sum, block) => sum + (new Date(block.end) - new Date(block.start)) / 60000, 0);
    return { day: plan.day, done: work.filter(block => block.status === 'done').length, total: work.length, doneMinutes: Math.round(minutes(work.filter(block => block.status === 'done'))), left: work.filter(block => block.status === 'planned' && new Date(block.end) <= now()).map(block => block.title) };
  }
  return { routine, setRoutine, build, get, mark, starting, review, dayKey };
}

module.exports = { createDayPlanner, DEFAULT_ROUTINE };
