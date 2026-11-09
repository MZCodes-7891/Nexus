// Saves lasting things the person says, without being told to. Only their own words are read, never documents, web pages, or tool results, so nothing planted in those can become a memory.
const PERSONAL = /\b(?:i|i'm|im|i've|ive|i'll|my|me|mine|we|we're|our|us)\b/i;
const MAX_NEW = 3;
const words = text => new Set(String(text || '').toLowerCase().match(/[a-z0-9']{3,}/g) || []);
function overlap(a, b) {
  const first = words(a);
  const second = words(b);
  const shared = [...first].filter(word => second.has(word)).length;
  return shared / Math.max(1, Math.min(first.size, second.size));
}
const SYSTEM = `You pick out facts about the user that are worth remembering in future conversations.
Save: lasting preferences and dislikes, the names of people, pets, and projects in their life, their school, classes, and grade, ongoing projects and goals, routines, and plans with dates.
Do not save: one-time requests or tasks, questions, small talk, anything the assistant said, or anything about passwords, codes, money or payment details, health, or other private matters.
Write each fact as one short sentence starting with "The user". Most messages have nothing worth saving, so an empty list is normal.
If a new fact replaces one of the numbered existing facts, give that number in "replaces".
Return JSON: {"memories":[{"fact":"...","replaces":null}]}`;

function createAutoMemory({ models, memory, getSettings, logger }) {
  async function fromMessage(message) {
    const { privacy } = getSettings();
    const text = String(message || '').trim();
    if (!privacy.memoryEnabled || privacy.autoRemember === false) return [];
    if (text.split(/\s+/).length < 4 || !PERSONAL.test(text) || /^\s*(?:please\s+)?(?:remember|forget)\b/i.test(text)) return [];
    const existing = (await memory.list()).slice(0, 40);
    let reply;
    try {
      reply = await models.chat({ messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: `Existing facts:\n${existing.map((item, index) => `${index + 1}. ${item.text}`).join('\n') || '(none)'}\n\nThe user's message:\n<message>\n${text.slice(0, 3000)}\n</message>` }], format: 'json', maxTokens: 400 });
    } catch (error) { logger?.warn(`auto memory skipped: ${error.message}`); return []; }
    let found = [];
    try { found = JSON.parse(String(reply.content || '').replace(/^```(?:json)?|```$/g, '')).memories || []; } catch { return []; }
    const saved = [];
    for (const item of (Array.isArray(found) ? found : []).slice(0, MAX_NEW)) {
      const fact = String(item?.fact || item || '').trim().slice(0, 300);
      if (!/^the user\b/i.test(fact) || fact.split(/\s+/).length < 4) continue;
      // A description of this one request ("The user wants to post…", "The user's message was about…") is not a lasting fact.
      if (/^the user(?:'s message| (?:wants|wanted|asked|is asking|would like|requested|needs to|told nexus|said to|is requesting)\b)/i.test(fact) && !/\b(always|usually|every|prefers?|likes?|loves?|hates?|favou?rite|birthday|allergic|lives|goes to|is in grade|studies|plays)\b/i.test(fact)) continue;
      // A near copy of something already saved adds nothing, unless it is meant to replace it.
      const replaces = Number(item?.replaces) >= 1 ? existing[Number(item.replaces) - 1] : null;
      if (!replaces && [...existing, ...saved.map(entry => ({ text: entry }))].some(entry => overlap(entry.text, fact) >= 0.8)) continue;
      const result = await memory.remember(fact, 'Learned');
      if (!result.ok || !result.added) continue;
      if (replaces && replaces.id !== result.item.id) await memory.remove(replaces.id);
      saved.push(fact);
    }
    return saved;
  }
  return { fromMessage };
}

module.exports = { createAutoMemory, overlap };
