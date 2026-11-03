const { describeComposioError, needsConfirmation } = require('./composio');

const text = value => String(value ?? '').trim();
const requireText = (value, label) => { const clean = text(value); if (!clean) throw new Error(`${label} is missing.`); return clean; };
const inRange = (value, low, high) => Math.max(low, Math.min(high, Math.round(Number(value) || 0)));

// The only actions the hub's panels can run. Each one is a button the user pressed, so none of them asks again.
// Spotify and Discord run directly, through the person's own apps. Composio keeps everything else.
const ACTIONS = {};

function friendlyError(message) {
  const said = String(message || '');
  if (/NO_ACTIVE_DEVICE|no active device/i.test(said)) return 'Spotify is not open on any device. Open Spotify on your computer or phone, play anything for a moment, then try again.';
  if (/PREMIUM_REQUIRED|premium/i.test(said)) return 'Spotify only allows this with a Premium account.';
  if (/Missing Access|50001/i.test(said)) return 'The bot cannot see that. Check it has been added to the server and has access to the channel.';
  if (/Missing Permissions|50013/i.test(said)) return 'The bot does not have permission to do that in this channel.';
  return said.slice(0, 400) || 'That did not work.';
}
// Composio wraps replies differently from one app to another.
function unwrap(result) { const data = result?.data ?? result; return data?.response_data ?? data?.data ?? data; }

function createHub({ composio, confirm, discord, spotify, timeoutMs = 45000 }) {
  const label = toolkit => ({ spotify: 'Spotify' })[toolkit] || toolkit;
  function withinTime(work) {
    let timer;
    const tooSlow = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The app took too long to answer. Check your internet connection and try again.')), timeoutMs); });
    return Promise.race([work, tooSlow]).finally(() => clearTimeout(timer));
  }
  async function isActive(toolkit) {
    try { return (await withinTime(composio.accounts())).some(account => account.toolkit === toolkit && account.status === 'ACTIVE'); }
    catch (error) { if (/too long/.test(error.message)) throw error; return false; }
  }
  async function execute(slug, args) {
    let result;
    try { result = await withinTime(composio.execute(slug, args)); }
    catch (error) { return { ok: false, message: friendlyError(describeComposioError(error)) }; }
    if (result?.error || result?.successful === false) return { ok: false, message: friendlyError(typeof result.error === 'string' ? result.error : JSON.stringify(result.error)) };
    return { ok: true, data: unwrap(result) };
  }
  async function run(id, args = {}) {
    // Discord runs as the person's own bot rather than through Composio.
    if (String(id).startsWith('discord.')) return discord ? discord.run(id, args) : { ok: false, notConnected: true, message: 'The Nexus bot is not set up yet.' };
    if (String(id).startsWith('spotify.')) {
      if (!spotify) return { ok: false, notConnected: true, message: 'Spotify is not connected.' };
      const result = await spotify.run(id, args);
      return result.ok ? result : { ...result, message: friendlyError(result.message) };
    }
    const action = ACTIONS[id];
    if (!action) return { ok: false, message: 'Nexus does not know that action.' };
    if (!await isActive(action.toolkit)) return { ok: false, notConnected: true, message: `${label(action.toolkit)} is not connected.` };
    return execute(action.slug, action.args(args));
  }
  // Any other connected app. The action must belong to that app, and anything that could change something asks first.
  async function runAny({ toolkit, slug, args = {} }) {
    const name = text(toolkit);
    const action = text(slug);
    if (!name || !action.startsWith(`${name.toUpperCase()}_`)) return { ok: false, message: 'That action does not belong to this app.' };
    if (!await isActive(name)) return { ok: false, notConnected: true, message: `${name} is not connected.` };
    if (needsConfirmation(action, { any: true }) && !await confirm({ title: 'Run this on your account?', message: `Run ${action} on your ${name} account?`, detail: JSON.stringify(args).slice(0, 500) })) return { ok: false, canceled: true, message: 'Cancelled. Nothing was changed.' };
    return execute(action, args);
  }
  return { run, runAny, accounts: () => composio.accounts(), actionList: () => Object.fromEntries(Object.entries(ACTIONS).map(([id, action]) => [id, { toolkit: action.toolkit, slug: action.slug }])) };
}

module.exports = { createHub, friendlyError };
