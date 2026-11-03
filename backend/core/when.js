// Small natural-language date parser for reminders and events. Returns null rather than guessing when it cannot understand.
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const NAMED_TIMES = { morning: [9, 0], noon: [12, 0], midday: [12, 0], afternoon: [15, 0], evening: [18, 0], tonight: [20, 0], night: [20, 0], midnight: [23, 59] };
const WORD_NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, half: 0.5 };

function parseWhen(input, now = new Date()) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}.*)?$/.test(raw)) { const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T09:00:00` : raw.replace(' ', 'T')); return Number.isNaN(date.getTime()) ? null : date; }
  const text = raw.toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim();
  const relative = text.match(/\bin\s+(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|half)(?:\s+an?)?\s*(min(?:ute)?s?|hours?|hrs?|days?|weeks?)\b/);
  if (relative) {
    const amount = WORD_NUMBERS[relative[1]] ?? Number(relative[1]);
    const unit = relative[2][0] === 'm' ? 60000 : relative[2][0] === 'h' ? 3600000 : relative[2][0] === 'd' ? 86400000 : 604800000;
    return new Date(now.getTime() + amount * unit);
  }
  const date = new Date(now);
  let matchedDay = false;
  if (/\btoday\b|\btonight\b/.test(text)) matchedDay = true;
  else if (/\bday after tomorrow\b/.test(text)) { date.setDate(date.getDate() + 2); matchedDay = true; }
  else if (/\b(tomorrow|tmrw)\b/.test(text)) { date.setDate(date.getDate() + 1); matchedDay = true; }
  const weekday = !matchedDay && text.match(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (weekday) {
    let delta = (WEEKDAYS.indexOf(weekday[2]) - date.getDay() + 7) % 7;
    if (delta === 0 || weekday[1]) delta += delta === 0 ? 7 : (weekday[1] ? 7 : 0);
    date.setDate(date.getDate() + delta); matchedDay = true;
  }
  const monthDay = !matchedDay && (text.match(new RegExp(`\\b(${MONTHS.join('|')}|${MONTHS.map(m => m.slice(0, 3)).join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(\\d{4}))?\\b`)));
  if (monthDay) {
    const month = MONTHS.findIndex(name => name.startsWith(monthDay[1].slice(0, 3)));
    date.setMonth(month, Number(monthDay[2]));
    if (monthDay[3]) date.setFullYear(Number(monthDay[3]));
    else if (date < new Date(now.getFullYear(), now.getMonth(), now.getDate())) date.setFullYear(date.getFullYear() + 1);
    matchedDay = true;
  }
  const numeric = !matchedDay && text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (numeric) {
    date.setMonth(Number(numeric[1]) - 1, Number(numeric[2]));
    if (numeric[3]) date.setFullYear(numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3]));
    else if (date < new Date(now.getFullYear(), now.getMonth(), now.getDate())) date.setFullYear(date.getFullYear() + 1);
    matchedDay = true;
  }
  const clock = text.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a m|p m)\b/) || text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/) || text.match(/\b(\d{1,2}):(\d{2})\b/);
  let matchedTime = false;
  if (clock) {
    let hour = Number(clock[1]);
    const minute = Number(clock[2] || 0);
    const meridiem = (clock[3] || '').replace(' ', '');
    if (hour > 23 || minute > 59) return null;
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    // "at 5" with no am/pm means the next time that hour comes around in waking hours.
    if (!meridiem && hour >= 1 && hour <= 7) hour += 12;
    date.setHours(hour, minute, 0, 0); matchedTime = true;
  } else {
    const named = Object.keys(NAMED_TIMES).find(name => new RegExp(`\\b${name}\\b`).test(text));
    if (named) { date.setHours(NAMED_TIMES[named][0], NAMED_TIMES[named][1], 0, 0); matchedTime = true; }
  }
  if (!matchedDay && !matchedTime) return null;
  if (!matchedTime) date.setHours(9, 0, 0, 0);
  if (!matchedDay && date <= now) date.setDate(date.getDate() + 1);
  return date;
}

// Next run of a recurring schedule: { time: 'HH:MM', days: [0-6] } in local time.
function nextOccurrence(schedule, after = new Date()) {
  const [hour, minute] = String(schedule?.time || '').split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  const days = Array.isArray(schedule.days) && schedule.days.length ? schedule.days : [0, 1, 2, 3, 4, 5, 6];
  for (let offset = 0; offset < 8; offset++) {
    const date = new Date(after);
    date.setDate(date.getDate() + offset);
    date.setHours(hour, minute, 0, 0);
    if (days.includes(date.getDay()) && date > after) return date;
  }
  return null;
}

module.exports = { parseWhen, nextOccurrence };
