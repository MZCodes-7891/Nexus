const fs = require('fs');
const path = require('path');

const FILE_HOSTS = /^(?:cdn\.discordapp\.com|media\.discordapp\.net)$/i;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;
const FORUM_CHANNEL = 15;
const list = data => { if (Array.isArray(data)) return data; if (data?.id) return [data]; for (const key of ['threads', 'items', 'guilds', 'channels', 'messages', 'members', 'roles', 'details']) if (Array.isArray(data?.[key])) return data[key]; return []; };
const ACKNOWLEDGE = 'Got it! This suggestion is being implemented.';

// Watches one Discord channel. A suggestion only moves when someone with the chosen role pings the bot, and only then is anything saved for Claude to read.
function createSuggestionInbox({ hub, folder, channelName = 'suggestions', roleName = 'Owner', fetchFn = (...args) => fetch(...args), now = () => new Date() }) {
  const inboxPath = path.join(folder, 'inbox.json');
  const processedPath = path.join(folder, 'processed.json');
  const readJson = async (file, fallback) => { try { return JSON.parse(await fs.promises.readFile(file, 'utf8')); } catch { return fallback; } };
  const need = async (id, args) => { const result = await hub.run(id, args); if (!result.ok) throw Object.assign(new Error(result.message), { notConnected: result.notConnected }); return result.data; };
  const fileAddress = value => { const address = new URL(value); if (address.protocol !== 'https:' || !FILE_HOSTS.test(address.hostname)) throw new Error('Not a Discord file.'); return address.href; };

  async function saveImages(message) {
    const saved = [];
    const images = (message.attachments || []).filter(item => /^image\//i.test(item.content_type || '') && Number(item.size || 0) <= MAX_IMAGE_BYTES).slice(0, 5);
    for (const [index, image] of images.entries()) {
      try {
        const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[String(image.content_type).split(';')[0].toLowerCase()];
        if (!extension) continue;
        const reply = await fetchFn(fileAddress(image.url), { signal: AbortSignal.timeout(30000) });
        if (!reply.ok) continue;
        const bytes = Buffer.from(await reply.arrayBuffer());
        if (bytes.length > MAX_IMAGE_BYTES) continue;
        const file = path.join(folder, 'images', `${String(message.id).replace(/\W/g, '')}-${index + 1}.${extension}`);
        await fs.promises.writeFile(file, bytes);
        saved.push(file);
      } catch {}
    }
    return saved;
  }
  // Suggestions often come as .txt files, and Discord turns long messages into message.txt. They are only ever read as text.
  async function readTextFiles(message) {
    const parts = [];
    const files = (message.attachments || []).filter(item => /\.(?:txt|md)$/i.test(item.filename || '') && Number(item.size || 0) <= MAX_TEXT_BYTES).slice(0, 5);
    for (const file of files) {
      try {
        const reply = await fetchFn(fileAddress(file.url), { signal: AbortSignal.timeout(30000) });
        if (!reply.ok) continue;
        const bytes = Buffer.from(await reply.arrayBuffer());
        if (bytes.length <= MAX_TEXT_BYTES) parts.push(`[${String(file.filename).slice(0, 120)}]\n${bytes.toString('utf8').replace(/^﻿/, '')}`);
      } catch {}
    }
    return parts;
  }
  async function check() {
    try {
      await fs.promises.mkdir(path.join(folder, 'images'), { recursive: true });
      const inbox = await readJson(inboxPath, { lastMessageId: '', items: [] });
      const me = await need('discord.me');
      let target = null;
      for (const server of list(await need('discord.servers'))) {
        const channel = list(await need('discord.channels', { serverId: server.id })).find(item => String(item.name).toLowerCase() === channelName.toLowerCase());
        if (channel) { target = { server, channel }; break; }
      }
      if (!target) return { ok: false, message: `The bot can't see a channel named ${channelName}.` };
      const isNew = id => id && (!inbox.lastMessageId || BigInt(id) > BigInt(inbox.lastMessageId));
      // In a forum channel each post is its own thread, so the messages live in the threads rather than the channel.
      let places = [{ id: target.channel.id, title: '' }];
      if (target.channel.type === FORUM_CHANNEL) {
        const active = list(await need('discord.threads', { serverId: target.server.id })).filter(thread => thread.parent_id === target.channel.id);
        const archived = list(await need('discord.archived-threads', { channelId: target.channel.id }));
        places = [...new Map([...active, ...archived].map(thread => [thread.id, thread])).values()].map(thread => ({ id: thread.id, title: String(thread.name || '').slice(0, 200), last: thread.last_message_id || thread.id })).filter(place => isNew(place.last));
      }
      if (!places.length) { inbox.checkedAt = now().toISOString(); await fs.promises.writeFile(inboxPath, JSON.stringify(inbox, null, 2)); return { ok: true, added: 0, ignored: 0, message: 'No new pings.' }; }
      const role = list(await need('discord.roles', { serverId: target.server.id })).find(item => String(item.name).toLowerCase() === roleName.toLowerCase());
      if (!role) return { ok: false, message: `This server has no role named ${roleName}.` };
      const allowed = new Set(list(await need('discord.members', { serverId: target.server.id })).filter(member => (member.roles || []).includes(role.id)).map(member => member.user?.id).filter(Boolean));
      if (!allowed.size) return { ok: false, message: `Nexus found nobody with the ${roleName} role. The bot may not be allowed to read the member list, so nothing was saved.` };
      let added = 0;
      let ignored = 0;
      let newest = inbox.lastMessageId;
      const mention = new RegExp(`<@!?${me.id}>`, 'g');
      for (const place of places) {
        const messages = list(await need('discord.messages', { channelId: place.id })).slice().sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
        for (const message of messages.filter(item => isNew(item.id))) {
          if (!newest || BigInt(message.id) > BigInt(newest)) newest = message.id;
          const pinged = (message.mentions || []).some(user => user.id === me.id) || mention.test(message.content || '');
          mention.lastIndex = 0;
          if (!pinged || message.author?.bot) continue;
          if (!allowed.has(message.author?.id)) {
            ignored++;
            await hub.run('discord.send', { channelId: place.id, content: `Only people with the ${roleName} role can send suggestions to be implemented.` });
            continue;
          }
          // The ping points at the whole post, so everything the role's holders wrote in it counts. Nobody else's words are saved.
          const parts = [];
          const images = [];
          for (const item of messages.filter(entry => allowed.has(entry.author?.id) && !entry.author?.bot && BigInt(entry.id) <= BigInt(message.id))) {
            const said = String(item.content || '').replace(mention, '').trim();
            parts.push(...[said, ...await readTextFiles(item)].filter(part => part.trim()));
            images.push(...await saveImages(item));
          }
          inbox.items.push({ id: message.id, threadId: place.id, author: message.author.global_name || message.author.username || 'Unknown', at: message.timestamp || now().toISOString(), postTitle: place.title, text: parts.join('\n\n').slice(0, 40000), images });
          added++;
          await hub.run('discord.send', { channelId: place.id, content: ACKNOWLEDGE });
        }
      }
      inbox.lastMessageId = newest;
      inbox.items = inbox.items.slice(-500);
      inbox.checkedAt = now().toISOString();
      await fs.promises.writeFile(inboxPath, JSON.stringify(inbox, null, 2));
      return { ok: true, added, ignored, message: added ? `${added} suggestion${added === 1 ? '' : 's'} sent to Claude.` : 'No new pings.' };
    } catch (error) { return { ok: false, notConnected: Boolean(error.notConnected), message: String(error.message).slice(0, 400) }; }
  }
  // The person's own requests, typed or spoken in Nexus, join the same list so Claude has one place to look.
  async function addRequest(request) {
    const text = String(request || '').trim().slice(0, 4000);
    if (!text) return { ok: false, error: 'There was no request to pass on.' };
    await fs.promises.mkdir(folder, { recursive: true });
    const inbox = await readJson(inboxPath, { lastMessageId: '', items: [] });
    inbox.items.push({ id: `nexus-${now().getTime()}`, author: 'You, in Nexus', fromOwner: true, at: now().toISOString(), postTitle: '', text, images: [] });
    await fs.promises.writeFile(inboxPath, JSON.stringify(inbox, null, 2));
    return { ok: true, message: 'Passed to Claude.' };
  }
  async function setOutcome(id, outcome) {
    const processed = await readJson(processedPath, {});
    processed[id] = { ...processed[id], ...outcome, at: now().toISOString() };
    await fs.promises.mkdir(folder, { recursive: true });
    await fs.promises.writeFile(processedPath, JSON.stringify(processed, null, 2));
  }
  async function pending() {
    const inbox = await readJson(inboxPath, { items: [] });
    const processed = await readJson(processedPath, {});
    return inbox.items.filter(item => !processed[item.id] || processed[item.id].outcome === 'waiting').map(item => ({ ...item, approved: Boolean(processed[item.id]?.approved) }));
  }
  // Only the owner's button reaches this: held work goes ahead, and failed work tries again.
  async function retry(id, { approved = false } = {}) {
    const processed = await readJson(processedPath, {});
    if (!['held', 'failed'].includes(processed[id]?.outcome)) return { ok: false, message: 'That suggestion is not waiting on you.' };
    await setOutcome(id, { outcome: 'waiting', note: '', approved: approved || Boolean(processed[id].approved) });
    return { ok: true };
  }
  async function status() {
    const inbox = await readJson(inboxPath, { items: [] });
    const processed = await readJson(processedPath, {});
    return { folder, channelName, roleName, checkedAt: inbox.checkedAt || '', items: inbox.items.slice().reverse().slice(0, 50).map(item => ({ ...item, outcome: processed[item.id]?.outcome || 'waiting', note: processed[item.id]?.note || '' })) };
  }
  return { check, status, addRequest, setOutcome, pending, retry };
}

module.exports = { createSuggestionInbox, ACKNOWLEDGE };
