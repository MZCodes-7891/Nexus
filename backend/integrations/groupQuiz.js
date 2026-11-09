// Group study quiz on Discord: the bot posts each question in a channel, friends answer with A, B, C, or D, and a
// leaderboard is kept. Only the first answer from each person counts; the fastest right answer earns a bonus point.
const fs = require('fs');
const path = require('path');

function createGroupQuiz({ dataDir, hub, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const boardFile = path.join(dataDir, 'group-quiz.json');
  const readBoard = async () => { try { return JSON.parse(await fs.promises.readFile(boardFile, 'utf8')); } catch { return { players: {}, games: [] }; } };
  let running = null;

  async function post(channelId, content) {
    const result = await hub.run('discord.send', { channelId, content: content.slice(0, 1900) });
    if (!result.ok) throw new Error(result.message || 'The bot could not post in that channel.');
    return result.data;
  }
  // Answers are replies after the question, from people (not bots), that start with a letter A to D.
  async function answersAfter(channelId, messageId) {
    const result = await hub.run('discord.messages', { channelId });
    if (!result.ok) return [];
    const after = BigInt(messageId);
    return (result.data || []).filter(message => !message.author?.bot && BigInt(message.id) > after).map(message => ({ id: message.id, user: message.author.id, name: message.author.global_name || message.author.username, letter: (String(message.content || '').trim().toUpperCase().match(/^([ABCD])\b/) || [])[1] })).filter(item => item.letter).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  }

  async function play({ quiz, channelId, seconds = 30, count = 10 }) {
    const questions = (quiz.questions || []).filter(question => question.choices && question.answer).slice(0, Math.max(1, Math.min(20, count)));
    if (!questions.length) throw new Error('That quiz has no multiple-choice questions.');
    const scores = {};
    await post(channelId, `📚 **Group quiz: ${quiz.title}**\n${questions.length} questions, ${seconds} seconds each. Reply with **A**, **B**, **C**, or **D**. Your first answer counts, and the fastest right answer gets a bonus point.`);
    for (const [index, question] of questions.entries()) {
      if (running?.stop) break;
      running.at = index + 1;
      const message = await post(channelId, `**Question ${index + 1} of ${questions.length}**\n${question.question}\n${['A', 'B', 'C', 'D'].map(letter => `**${letter}.** ${question.choices[letter]}`).join('\n')}`);
      await wait(seconds * 1000);
      const seen = new Set(); const right = [];
      for (const answer of await answersAfter(channelId, message.id)) {
        if (seen.has(answer.user)) continue;
        seen.add(answer.user);
        const player = scores[answer.user] || (scores[answer.user] = { name: answer.name, points: 0, right: 0 });
        if (answer.letter === question.answer) { player.points += right.length ? 1 : 2; player.right++; right.push(answer.name); }
      }
      await post(channelId, `✅ It was **${question.answer}. ${question.choices[question.answer]}**${question.explanation ? `\n${String(question.explanation).slice(0, 300)}` : ''}\n${right.length ? `Right: ${right.join(', ')}${right.length ? ` (${right[0]} was fastest)` : ''}` : 'Nobody got it this time.'}`);
    }
    const ranked = Object.entries(scores).sort((a, b) => b[1].points - a[1].points);
    const board = await readBoard();
    for (const [id, score] of ranked) { const player = board.players[id] || (board.players[id] = { name: score.name, points: 0, games: 0, wins: 0 }); player.name = score.name; player.points += score.points; player.games++; }
    if (ranked.length) board.players[ranked[0][0]].wins++;
    board.games = [...board.games, { at: new Date().toISOString(), title: quiz.title, players: ranked.length, winner: ranked[0]?.[1].name || '' }].slice(-50);
    await fs.promises.writeFile(boardFile, JSON.stringify(board, null, 2));
    const all = Object.values(board.players).sort((a, b) => b.points - a.points).slice(0, 10);
    await post(channelId, `🏆 **Results**\n${ranked.length ? ranked.map(([, score], place) => `${['🥇', '🥈', '🥉'][place] || `${place + 1}.`} ${score.name}: ${score.points} points (${score.right}/${questions.length} right)`).join('\n') : 'Nobody answered.'}\n\n**All-time leaderboard**\n${all.map((player, place) => `${place + 1}. ${player.name}: ${player.points} points, ${player.wins} win${player.wins === 1 ? '' : 's'}`).join('\n') || 'Nobody yet.'}`);
    return { ranked: ranked.map(([, score]) => score) };
  }

  function start(options) {
    if (running) return { ok: false, message: 'A group quiz is already running.' };
    running = { at: 0, stop: false, title: options.quiz?.title || '' };
    const done = play(options).catch(error => ({ error: error.message })).finally(() => { running = null; });
    return { ok: true, done };
  }
  return { start, stop: () => { if (running) running.stop = true; return { ok: true }; }, status: () => (running ? { running: true, at: running.at, title: running.title } : { running: false }), leaderboard: async () => { const board = await readBoard(); return { players: Object.values(board.players).sort((a, b) => b.points - a.points), games: board.games.slice().reverse() }; } };
}

module.exports = { createGroupQuiz };
