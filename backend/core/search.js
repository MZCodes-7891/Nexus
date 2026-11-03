// Turns "pdfs about biology from last week" into filters, with no AI needed, so the search box answers as you type.
const KINDS = [
  ['documents', /\b(?:documents?|docs?|files?)\b/gi],
  ['tasks', /\b(?:tasks?|to-?dos?|homework)\b/gi],
  ['events', /\b(?:events?|calendar|appointments?|meetings?)\b/gi],
  ['conversations', /\b(?:chats?|conversations?)\b/gi],
  ['memories', /\b(?:memor(?:y|ies))\b/gi],
  ['apps', /\b(?:apps?|programs?)\b/gi]
];
const EXTENSIONS = [[/\bpdfs?\b/gi, ['pdf'], 'PDF'], [/\b(?:word docs?|word documents?|docx)\b/gi, ['doc', 'docx'], 'Word'], [/\b(?:powerpoints?|pptx?|slides?|presentations?)\b/gi, ['ppt', 'pptx'], 'PowerPoint'], [/\b(?:spreadsheets?|excel|xlsx|csv)\b/gi, ['xls', 'xlsx', 'csv'], 'spreadsheet']];
const FILLER = new Set('a about all an and any are at can could do find for from get give i in is it look looking me my of on please search see show something that the there to want what where which with'.split(' '));

function dayRange(now, startOffset, endOffset) {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return [new Date(base.getTime() + startOffset * 86400000), new Date(base.getTime() + endOffset * 86400000 - 1)];
}
function dateFilter(now) {
  const weekStart = -now.getDay();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return [
    [/\byesterday\b/i, 'yesterday', () => dayRange(now, -1, 0)],
    [/\btoday\b/i, 'today', () => dayRange(now, 0, 1)],
    [/\btomorrow\b/i, 'tomorrow', () => dayRange(now, 1, 2)],
    [/\blast week\b/i, 'last week', () => dayRange(now, weekStart - 7, weekStart)],
    [/\bthis week\b/i, 'this week', () => dayRange(now, weekStart, weekStart + 7)],
    [/\bnext week\b/i, 'next week', () => dayRange(now, weekStart + 7, weekStart + 14)],
    [/\blast month\b/i, 'last month', () => [new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(monthStart.getTime() - 1)]],
    [/\bthis month\b/i, 'this month', () => [monthStart, new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, -1)]]
  ];
}

function parseSearch(text, now = new Date()) {
  let rest = ` ${String(text || '')} `;
  const take = pattern => { const found = pattern.test(rest); pattern.lastIndex = 0; if (found) rest = rest.replace(pattern, ' '); return found; };
  const understood = [];
  const output = { kinds: [], extensions: [], since: null, until: null, priority: '', overdue: false, done: null };
  for (const [pattern, values, label] of EXTENSIONS) if (take(pattern)) { output.extensions.push(...values); understood.push(label); if (!output.kinds.includes('documents')) output.kinds.push('documents'); }
  if (take(/\b(?:high[- ]priority|urgent|important)\b/gi)) { output.priority = 'high'; understood.push('high priority'); if (!output.kinds.length) output.kinds.push('tasks'); }
  if (take(/\boverdue\b/gi)) { output.overdue = true; understood.push('overdue'); if (!output.kinds.length) output.kinds.push('tasks'); }
  if (take(/\b(?:completed|finished|done)\b/gi)) { output.done = true; understood.push('done'); }
  for (const [kind, pattern] of KINDS) if (take(pattern) && !output.kinds.includes(kind)) { output.kinds.push(kind); understood.push(kind); }
  for (const [pattern, label, range] of dateFilter(now)) if (take(pattern)) { [output.since, output.until] = range(); understood.push(label); break; }
  output.words = (rest.toLowerCase().match(/[\p{L}\p{N}.'-]+/gu) || []).filter(word => !FILLER.has(word) && word !== 'due');
  if (output.words.length && understood.length) understood.push(`"${output.words.join(' ')}"`);
  output.understood = understood;
  output.filtered = understood.length > 0;
  return output;
}
const matchesWords = (value, words) => { const text = String(value || '').toLowerCase(); return words.every(word => text.includes(word)); };
const inDates = (value, { since, until }) => { if (!since) return true; if (!value) return false; const at = new Date(value).getTime(); return at >= since.getTime() && at <= until.getTime(); };

module.exports = { parseSearch, matchesWords, inDates };
