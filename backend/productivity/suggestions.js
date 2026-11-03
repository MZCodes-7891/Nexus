// Suggestions come only from what Nexus already holds on this computer. Nothing here is sent anywhere.
function buildSuggestions({ tasks = [], priorities = [], documents = [], sets = [], tests = [], apps = [], now = new Date() } = {}) {
  const output = [];
  const add = (weight, text, action) => output.push({ weight, text, action });
  for (const task of tasks.filter(item => item.status !== 'complete' && item.dueDate && new Date(item.dueDate) < now).slice(0, 3)) add(90, `Overdue: ${task.text}`, { view: 'tasks' });
  for (const item of priorities) add(item.weight || 40, item.text, { view: 'school', tab: 'planner' });
  for (const test of tests) {
    const last = test.attempts?.[0];
    if (last?.total && last.score / last.total < 0.7) add(50, `Retake ${test.title}: you scored ${last.score} of ${last.total}`, { view: 'school', tab: 'tests' });
  }
  for (const set of sets) {
    const known = set.cards.filter(card => card.known).length;
    if (known < set.cards.length) add(known ? 45 : 35, `Keep learning ${set.title}: ${known} of ${set.cards.length} terms known`, { view: 'school', tab: 'sets', id: set.id });
  }
  const studied = new Set(sets.flatMap(set => set.sources));
  const recent = documents.filter(doc => !studied.has(doc.name) && now.getTime() - new Date(doc.addedAt).getTime() < 14 * 86400000);
  for (const doc of recent.slice(0, 2)) add(30, `Make a study set from ${doc.name}`, { view: 'school', tab: 'sets', documentIds: [doc.id] });
  const usual = apps.filter(app => app.lastOpenedAt && Math.abs(new Date(app.lastOpenedAt).getHours() - now.getHours()) <= 1).sort((a, b) => String(b.lastOpenedAt).localeCompare(String(a.lastOpenedAt)))[0];
  if (usual) add(10, `Open ${usual.name}, which you used around this time`, { app: usual.id });
  return output.sort((a, b) => b.weight - a.weight).slice(0, 6).map(({ text, action }) => ({ text, action }));
}

module.exports = { buildSuggestions };
