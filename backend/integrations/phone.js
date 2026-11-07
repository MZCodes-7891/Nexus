const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Control Nexus from a phone by messaging the Discord bot. Only the one Discord account that proved itself with a code is listened to, and only in its direct messages.
const CODE_LIFETIME_MS = 10 * 60000;
const APPROVAL_WAIT_MS = 2 * 60000;
const HISTORY = 12;
const after = (a, b) => !b || BigInt(a) > BigInt(b);
// Pictures sent in the DM are only fetched from Discord's own file servers.
const DISCORD_FILES = /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//;
const MAX_PICTURE = 15 * 1024 * 1024;

// A practice test asked for from the phone is taken right in the DM, one question at a time.
function formatQuestion(test, index) {
  const question = test.questions[index];
  const choices = question.choices && Object.keys(question.choices).length ? `\n${Object.entries(question.choices).map(([letter, text]) => `${letter}) ${text}`).join('\n')}` : '';
  const how = question.type === 'multiple_choice' ? 'Reply with A, B, C, or D.' : question.type === 'true_false' ? 'Reply True or False.' : 'Reply with your answer.';
  return `**Question ${index + 1} of ${test.questions.length}**${question.topic ? ` (${question.topic})` : ''}\n${question.question}${choices}\n${how} Say "stop" to end the test.`;
}

function createPhoneController({ hub, runAgent, dataDir, logger, study, now = () => Date.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), fetchFn = (...args) => fetch(...args) }) {
  const statePath = path.join(dataDir, 'phone-link.json');
  let running = false;
  let polling = false;
  const read = async () => { try { return JSON.parse(await fs.promises.readFile(statePath, 'utf8')); } catch { return {}; } };
  const write = async state => { await fs.promises.mkdir(dataDir, { recursive: true }); await fs.promises.writeFile(statePath, JSON.stringify(state, null, 2)); };
  const say = async (channelId, text) => {
    // Discord caps a message at 2000 characters, so a long answer goes in parts.
    const parts = String(text || '').match(/[\s\S]{1,1900}(?=\s|$)|[\s\S]{1,1900}/g) || [''];
    for (const part of parts.slice(0, 5)) await hub.run('discord.send', { channelId, content: part });
  };
  async function newMessages(state) {
    const listed = await hub.run('discord.messages', { channelId: state.channelId });
    if (!listed.ok) return [];
    return (Array.isArray(listed.data) ? listed.data : []).filter(message => message.author?.id === state.userId && !message.author?.bot && after(message.id, state.lastId)).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  }

  async function pictures(message) {
    const found = [];
    for (const file of (message.attachments || []).slice(0, 4)) {
      if (!/^image\//.test(file.content_type || '') || !DISCORD_FILES.test(file.url || '') || Number(file.size) > MAX_PICTURE) continue;
      try {
        const reply = await fetchFn(file.url, { signal: AbortSignal.timeout(30000) });
        if (reply.ok) found.push(Buffer.from(await reply.arrayBuffer()).toString('base64'));
      } catch (error) { logger?.warn(`phone picture: ${error.message}`); }
    }
    return found;
  }

  async function startQuiz(state, testId) {
    const test = await study?.getTest(testId);
    if (!test?.questions?.length) return;
    state.quiz = { id: testId, index: 0, answers: [], right: 0 };
    await write(state);
    await say(state.channelId, `Let's take it here. ${test.questions.length} questions.\n\n${formatQuestion(test, 0)}`);
  }
  async function answerQuiz(state, text) {
    const test = await study.getTest(state.quiz.id);
    if (!test) { delete state.quiz; await write(state); return; }
    if (/^(stop|quit|end|cancel)\b/i.test(text)) {
      await say(state.channelId, `Stopped after ${state.quiz.index} question${state.quiz.index === 1 ? '' : 's'}: ${state.quiz.right} right. The test is still in the Study Center if you want to finish it there.`);
      delete state.quiz;
      await write(state);
      return;
    }
    const question = test.questions[state.quiz.index];
    const answer = question.type === 'multiple_choice' ? (text.match(/^\s*\(?([a-d])\b/i)?.[1] || text).toUpperCase() : text;
    let graded;
    try { graded = await study.gradeQuestion(question, answer); }
    catch (error) { graded = { correct: false, feedback: `I couldn't grade that one: ${error.message}` }; }
    state.quiz.answers.push(answer);
    if (graded.correct) state.quiz.right++;
    state.quiz.index++;
    const key = question.type === 'multiple_choice' && question.choices?.[question.answer] ? `${question.answer}) ${question.choices[question.answer]}` : question.answer;
    const verdict = `${graded.correct ? '✅ Right!' : `❌ Not quite. The answer is ${key}.`} ${graded.feedback || question.explanation || ''}`.trim();
    if (state.quiz.index < test.questions.length) {
      await write(state);
      await say(state.channelId, `${verdict}\n\n${formatQuestion(test, state.quiz.index)}`);
      return;
    }
    // The finished test is saved like one taken on the PC, so it counts toward weak topics.
    const answers = state.quiz.answers;
    delete state.quiz;
    await write(state);
    const attempt = await study.submitTest(test.id, answers).catch(() => null);
    const score = attempt?.score ?? 0;
    const weak = [...new Set((attempt?.results || []).map((result, index) => (!result.correct ? test.questions[index]?.topic : '')).filter(Boolean))];
    await say(state.channelId, `${verdict}\n\n**Done! ${score} of ${test.questions.length}.**${weak.length ? ` Worth reviewing: ${weak.slice(0, 4).join(', ')}.` : ' Nice work!'}`);
  }

  async function link(userId, name = '') {
    const id = String(userId || '').trim();
    if (!/^\d{5,25}$/.test(id)) return { ok: false, message: 'Choose your Discord account first.' };
    const opened = await hub.run('discord.open-dm', { userId: id });
    if (!opened.ok) return { ok: false, message: `The bot could not message that account: ${opened.message}` };
    const code = String(crypto.randomInt(100000, 1000000));
    const sent = await hub.run('discord.send', { channelId: opened.data.id, content: `Nexus wants to link this Discord account so you can control it from your phone. Reply here with this code: ${code}\nIf you didn't ask for this, ignore it.` });
    if (!sent.ok) return { ok: false, message: sent.message };
    await write({ userId: id, name: String(name).slice(0, 80), channelId: opened.data.id, code, codeExpires: now() + CODE_LIFETIME_MS, verified: false, lastId: sent.data?.id || '', history: [] });
    return { ok: true, message: 'Check Discord: your bot sent you a code. Reply to it with the code.' };
  }
  async function unlink() { await fs.promises.unlink(statePath).catch(() => {}); return { ok: true }; }
  async function status() { const state = await read(); return { linked: Boolean(state.verified), waitingForCode: Boolean(state.userId && !state.verified && state.codeExpires > now()), name: state.name || '' }; }

  // Called while a request from the phone is running: the approval is asked in the DM instead of in a window on the PC.
  async function confirm({ message }) {
    const state = await read();
    if (!state.verified) return false;
    await say(state.channelId, `Nexus needs your OK: ${message}\nReply yes or no.`);
    const until = now() + APPROVAL_WAIT_MS;
    while (now() < until) {
      await sleep(3000);
      for (const reply of await newMessages(state)) {
        state.lastId = reply.id;
        await write(state);
        const answer = String(reply.content || '').trim().toLowerCase();
        if (/^(y|yes|yeah|yep|ok|okay|sure|do it)\b/.test(answer)) return true;
        if (/^(n|no|nope|stop|cancel|don't)\b/.test(answer)) { await say(state.channelId, 'Okay, I won\'t do that.'); return false; }
      }
    }
    await say(state.channelId, 'No answer, so I didn\'t do it.');
    return false;
  }

  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const state = await read();
      if (!state.userId) return;
      const messages = await newMessages(state);
      if (!state.verified) {
        if (state.codeExpires < now()) { await unlink(); return; }
        const proof = messages.find(message => String(message.content || '').includes(state.code));
        if (messages.length) state.lastId = messages.at(-1).id;
        if (proof) {
          Object.assign(state, { verified: true, code: '', codeExpires: 0 });
          await say(state.channelId, 'Linked! Message me here any time to control Nexus on your PC, like "set a reminder for 5 PM" or "make a study playlist". Nexus has to be running on your PC for me to answer.');
        }
        await write(state);
        return;
      }
      for (const message of messages) {
        state.lastId = message.id;
        await write(state);
        // While a test is running, each message is an answer.
        if (state.quiz && study) {
          const reply = String(message.content || '').trim();
          if (reply) { await hub.run('discord.typing', { channelId: state.channelId }); await answerQuiz(state, reply); }
          continue;
        }
        const imageData = await pictures(message);
        const text = String(message.content || '').trim() || (imageData.length ? 'What is in this picture?' : '');
        if (!text) continue;
        await hub.run('discord.typing', { channelId: state.channelId });
        running = true;
        let result;
        try { result = await runAgent([...(state.history || []), { role: 'user', content: text, ...(imageData.length ? { imageData } : {}) }]); }
        finally { running = false; }
        const answer = result?.answer || 'Something went wrong on the PC, so that wasn\'t done.';
        await say(state.channelId, answer);
        // Pictures Nexus made for this request are sent here too, not just saved on the PC.
        for (const filePath of (result?.images || []).slice(0, 4)) {
          const sent = await hub.run('discord.send-file', { channelId: state.channelId, filePath });
          if (!sent.ok) await say(state.channelId, `I made the picture, but couldn't send it here: ${sent.message} It's saved on your PC in Documents\\Nexus\\Images.`);
        }
        const fresh = await read();
        if (!fresh.verified || fresh.userId !== state.userId) return;
        fresh.history = [...(fresh.history || []), { role: 'user', content: text }, { role: 'assistant', content: answer }].slice(-HISTORY);
        // An approval answered during the run moved this on, so it is never wound back.
        if (after(state.lastId, fresh.lastId)) fresh.lastId = state.lastId;
        await write(fresh);
        Object.assign(state, fresh);
        if (result?.test) await startQuiz(state, result.test);
      }
    } catch (error) { logger?.warn(`phone controller: ${error.message}`); }
    finally { polling = false; }
  }
  // Sends a note to the linked phone, such as a reminder, when an account is linked.
  async function tell(text) { const state = await read(); if (!state.verified || !String(text || '').trim()) return { ok: false }; await say(state.channelId, String(text).slice(0, 1800)); return { ok: true }; }
  return { link, unlink, status, poll, confirm, tell, isRunning: () => running };
}

module.exports = { createPhoneController };
