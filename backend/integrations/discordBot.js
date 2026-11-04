const fs = require('fs');
const path = require('path');

// Nexus talks to Discord directly as the person's own bot, so no outside service has to stay in their server.
const VIEW_CHANNEL = 1024n;
const SEND_MESSAGES = 2048n;
const READ_MESSAGE_HISTORY = 65536n;
const SEND_IN_THREADS = 274877906944n;
const MANAGE_CHANNELS = 16n;
const CREATE_PUBLIC_THREADS = 34359738368n;
// What the bot needs to read, post, and make channels and posts. No moderation, roles, or admin powers.
const INVITE_PERMISSIONS = VIEW_CHANNEL | SEND_MESSAGES | READ_MESSAGE_HISTORY | SEND_IN_THREADS | MANAGE_CHANNELS | CREATE_PUBLIC_THREADS;
const MEMBERS_INTENT = 1 << 15;
const MESSAGE_CONTENT_INTENT = 1 << 19;
const INTENTS = MEMBERS_INTENT | MESSAGE_CONTENT_INTENT;
const PAGE = 1000;
const required = (value, label) => { const clean = String(value ?? '').trim(); if (!clean) throw new Error(`${label} is missing.`); return encodeURIComponent(clean); };

function createDiscordBot({ dataDir, safeStorage, fetchFn = (...args) => fetch(...args), apiBase = 'https://discord.com/api/v10', timeoutMs = 20000 }) {
  const secretPath = path.join(dataDir, 'discord-bot-token.enc');
  async function readToken() {
    try { return (await safeStorage.decryptStringAsync(await fs.promises.readFile(secretPath))).result; } catch { return ''; }
  }
  async function request(token, route, { method = 'GET', body } = {}, retried = false) {
    let reply;
    try { reply = await fetchFn(`${apiBase}${route}`, { method, headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'NexusBot (https://github.com, 2.0)' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) }); }
    catch { throw new Error('Nexus could not reach Discord. Check your internet connection and try again.'); }
    const data = await reply.json().catch(() => ({}));
    if (reply.status === 429 && !retried) {
      await new Promise(resolve => setTimeout(resolve, Math.min(5000, Number(data.retry_after || 1) * 1000)));
      return request(token, route, { method, body }, true);
    }
    if (reply.status === 401) throw Object.assign(new Error('Discord rejected this bot token. Copy a new one from the Bot page and try again.'), { badToken: true });
    if (reply.status === 403) throw new Error(/members/.test(route) ? 'Discord would not share the member list. Turn on Server Members Intent on your bot\'s Bot page.' : (method === 'POST' && /channels$|threads$/.test(route)) || method === 'PATCH' ? 'The bot isn\'t allowed to make channels or posts yet. Press Add to a server in Nexus again and approve it, which gives it that permission.' : 'The bot does not have access to that. Check it is in the server and can see the channel.');
    if (reply.status === 404) throw new Error('Discord could not find that. The bot may have been removed from the server.');
    if (!reply.ok) throw new Error(`Discord answered with an error: ${String(data.message || reply.status).slice(0, 200)}`);
    return data;
  }
  // A message with a file attached, such as a picture Nexus made.
  async function sendFile(token, { channelId, content = '', filePath }) {
    const file = String(filePath || '');
    const bytes = await fs.promises.readFile(file).catch(() => { throw new Error('Nexus could not find that file to send.'); });
    if (bytes.length > 9.5 * 1024 * 1024) throw new Error('That file is too big to send on Discord.');
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ content: String(content).slice(0, 2000), allowed_mentions: { parse: [] } }));
    form.append('files[0]', new Blob([bytes]), path.basename(file));
    let reply;
    try { reply = await fetchFn(`${apiBase}/channels/${required(channelId, 'A channel')}/messages`, { method: 'POST', headers: { Authorization: `Bot ${token}`, 'User-Agent': 'NexusBot (https://github.com, 2.0)' }, body: form, signal: AbortSignal.timeout(60000) }); }
    catch { throw new Error('Nexus could not reach Discord. Check your internet connection and try again.'); }
    const data = await reply.json().catch(() => ({}));
    if (!reply.ok) throw new Error(`Discord would not take the file: ${String(data.message || reply.status).slice(0, 200)}`);
    return data;
  }
  const inviteUrl = id => `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(id)}&scope=bot&permissions=${INVITE_PERMISSIONS}`;
  const hasIntents = flags => (Number(flags) & INTENTS) === INTENTS;

  async function connect(input) {
    const token = String(input || '').trim().replace(/^Bot\s+/i, '');
    if (!token) return { ok: false, message: 'Paste your bot token first.' };
    if (/\s/.test(token)) return { ok: false, message: 'That doesn\'t look like a bot token. It should be one long piece of text with no spaces.' };
    if (!await safeStorage.isAsyncEncryptionAvailable()) return { ok: false, message: 'Windows secure storage is unavailable, so Nexus did not save the token.' };
    try {
      const application = await request(token, '/applications/@me');
      // Reading messages and roles needs these two switches, and Discord lets a small bot turn them on itself.
      if (!hasIntents(application.flags)) await request(token, '/applications/@me', { method: 'PATCH', body: { flags: Number(application.flags || 0) | INTENTS } }).catch(() => {});
      await fs.promises.mkdir(dataDir, { recursive: true });
      await fs.promises.writeFile(secretPath, await safeStorage.encryptStringAsync(token), { mode: 0o600 });
      return { ok: true, message: `Connected as ${application.name}.` };
    } catch (error) { return { ok: false, message: error.message }; }
  }
  async function disconnect() { await fs.promises.unlink(secretPath).catch(() => {}); return { ok: true }; }
  async function status() {
    const token = await readToken();
    if (!token) return { connected: false };
    try {
      const application = await request(token, '/applications/@me');
      const servers = await request(token, '/users/@me/guilds');
      return { connected: true, name: application.name, inviteUrl: inviteUrl(application.id), intentsOk: hasIntents(application.flags), portalUrl: `https://discord.com/developers/applications/${encodeURIComponent(application.id)}/bot`, serverCount: servers.length };
    } catch (error) { return { connected: true, invalid: Boolean(error.badToken), offline: !error.badToken, message: error.message }; }
  }
  async function members(token, serverId) {
    const everyone = [];
    let after = '';
    // Five pages covers 5,000 members, far beyond a friends' server, and keeps a huge one from running forever.
    for (let page = 0; page < 5; page++) {
      const batch = await request(token, `/guilds/${required(serverId, 'A server')}/members?limit=${PAGE}${after ? `&after=${after}` : ''}`);
      everyone.push(...batch);
      if (batch.length < PAGE) break;
      after = encodeURIComponent(batch.at(-1).user.id);
    }
    return everyone;
  }
  const ROUTES = {
    'discord.me': token => request(token, '/users/@me'),
    'discord.open-dm': (token, { userId }) => request(token, '/users/@me/channels', { method: 'POST', body: { recipient_id: String(userId || '') } }),
    'discord.send-file': (token, args) => sendFile(token, args),
    'discord.typing': (token, { channelId }) => request(token, `/channels/${required(channelId, 'A channel')}/typing`, { method: 'POST' }),
    'discord.servers': token => request(token, '/users/@me/guilds'),
    'discord.channels': (token, { serverId }) => request(token, `/guilds/${required(serverId, 'A server')}/channels`),
    'discord.messages': (token, { channelId }) => request(token, `/channels/${required(channelId, 'A channel')}/messages?limit=50`),
    'discord.send': (token, { channelId, content }) => { const message = String(content ?? '').trim(); if (!message) throw new Error('A message is missing.'); return request(token, `/channels/${required(channelId, 'A channel')}/messages`, { method: 'POST', body: { content: message.slice(0, 2000), allowed_mentions: { parse: [] } } }); },
    // Categories keep their spaces and capitals; text channels use Discord's lower-case-with-dashes style.
    'discord.create-channel': (token, { serverId, name, topic, category = false, parentId }) => { const clean = category ? String(name ?? '').trim().slice(0, 90) : String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9-_ ]/g, '').replace(/\s+/g, '-').slice(0, 90); if (!clean) throw new Error('A channel name is missing.'); return request(token, `/guilds/${required(serverId, 'A server')}/channels`, { method: 'POST', body: { name: clean, type: category ? 4 : 0, topic: category ? undefined : String(topic || '').slice(0, 1000) || undefined, parent_id: parentId || undefined } }); },
    'discord.move-channel': (token, { channelId, parentId }) => request(token, `/channels/${required(channelId, 'A channel')}`, { method: 'PATCH', body: { parent_id: parentId || null } }),
    'discord.create-post': (token, { channelId, title, content }) => { const name = String(title ?? '').trim().slice(0, 100); const message = String(content ?? '').trim(); if (!name || !message) throw new Error('A post needs a title and a message.'); return request(token, `/channels/${required(channelId, 'A forum')}/threads`, { method: 'POST', body: { name, message: { content: message.slice(0, 2000), allowed_mentions: { parse: [] } } } }); },
    'discord.threads': (token, { serverId }) => request(token, `/guilds/${required(serverId, 'A server')}/threads/active`),
    'discord.archived-threads': (token, { channelId }) => request(token, `/channels/${required(channelId, 'A channel')}/threads/archived/public?limit=50`),
    'discord.roles': (token, { serverId }) => request(token, `/guilds/${required(serverId, 'A server')}/roles`),
    'discord.members': (token, { serverId }) => members(token, serverId)
  };
  async function run(id, args = {}) {
    if (!ROUTES[id]) return { ok: false, message: 'Nexus does not know that action.' };
    const token = await readToken();
    if (!token) return { ok: false, notConnected: true, message: 'The Nexus bot is not set up yet.' };
    try { return { ok: true, data: await ROUTES[id](token, args) }; }
    catch (error) { return { ok: false, message: error.message }; }
  }
  return { connect, disconnect, status, run };
}

module.exports = { createDiscordBot, INVITE_PERMISSIONS };
