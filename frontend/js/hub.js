// App Control: hands-on panels for Spotify and a Discord bot, plus a runner for any other connected app.
let hubTimer = null;
const hubOpen = () => !document.getElementById('view-hub')?.classList.contains('hidden');
const hubList = data => {
    if (Array.isArray(data)) return data;
    if (data?.id) return [data];
    for (const key of ['items', 'guilds', 'channels', 'messages', 'members', 'devices', 'details']) if (Array.isArray(data?.[key])) return data[key];
    return [];
};
const hubButton = (label, onclick, kind = 'integration-button secondary') => h('button', { type: 'button', class: kind, text: label, onclick });

// A box for telling Nexus what to do with one app. Each request starts fresh, so an old chat can't mislead it, and the answer shows right here.
function hubOrderBar({ label, placeholder, prefix, help, button = 'Tell Nexus', disabledNote = '' }) {
    const input = h('input', { class: 'field', type: 'text', placeholder: disabledNote || placeholder, 'aria-label': label, autocomplete: 'off', style: 'flex:1', disabled: Boolean(disabledNote) });
    const send = h('button', { type: 'button', class: 'action-btn-primary', text: button, disabled: Boolean(disabledNote) });
    const reply = h('div', { class: 'hub-reply', role: 'log', 'aria-live': 'polite' });
    const run = async () => {
        const text = input.value.trim();
        if (!text || send.disabled) return;
        input.value = '';
        input.disabled = true; send.disabled = true;
        const steps = h('div', { class: 'hub-steps' });
        const answer = h('div', { class: 'muted small', text: 'Working on it…' });
        reply.replaceChildren(h('div', { class: 'hub-asked', text: text }), steps, answer);
        const rows = new Map();
        let runId = '';
        const early = [];
        const finish = () => { ipcRenderer.removeListener('agent:event', onEvent); input.disabled = false; send.disabled = false; input.focus(); };
        const handle = data => {
            if (data.type === 'tool_start') { const row = h('div', { class: 'hub-step-line', text: `… ${data.title || data.name}` }); rows.set(data.id, row); steps.append(row); }
            else if (data.type === 'tool_end') { const row = rows.get(data.id) || steps.appendChild(h('div', { class: 'hub-step-line' })); row.textContent = `${data.ok ? '✓' : '✗'} ${data.summary || data.tool}`; row.dataset.kind = data.ok ? 'ok' : 'error'; }
            else if (data.type === 'done') { answer.className = 'hub-answer'; answer.replaceChildren(); renderFormattedMessage(answer, String(data.answer || '')); finish(); }
            else if (data.type === 'error' || data.type === 'cancelled') { answer.className = 'error-text small'; answer.textContent = data.message || 'Stopped.'; finish(); }
        };
        const onEvent = (_event, data) => { if (!runId) { early.push(data); return; } if (data.runId === runId) handle(data); };
        ipcRenderer.on('agent:event', onEvent);
        const started = await ipcRenderer.invoke('agent:send', { messages: [{ role: 'user', content: `${prefix}${text}` }] });
        if (started?.ok === false || !started?.runId) { answer.className = 'error-text small'; answer.textContent = started?.message || 'Nexus could not start that.'; finish(); return; }
        runId = started.runId;
        early.filter(data => data.runId === runId).forEach(handle);
    };
    send.addEventListener('click', run);
    input.addEventListener('keydown', event => { if (event.key === 'Enter') run(); });
    return h('div', { class: 'hub-order-box' }, h('div', { class: 'row wrap hub-order' }, input, send), h('p', { class: 'muted small', text: help }), reply);
}


// Spotify setup: a free Spotify app gives Nexus its own way in, since Composio offers no Spotify sign-in.
function renderSpotifySetup(panel, current) {
    const status = h('div', { class: 'muted small status-line', role: 'status', text: current.failed ? current.message : '', dataset: { kind: current.failed ? 'error' : '' } });
    const clientId = h('input', { class: 'field', type: 'text', placeholder: 'Paste your Client ID here', 'aria-label': 'Spotify Client ID', autocomplete: 'off' });
    const connect = h('button', { type: 'button', class: 'action-btn-primary', text: 'Connect' });
    const submit = busyButton(connect, 'Waiting for Spotify…', async () => {
        status.textContent = 'Spotify opened in your browser. Press Agree there, then come back.';
        status.dataset.kind = '';
        const result = await ipcRenderer.invoke('hub:spotify-connect', clientId.value);
        status.textContent = result.message;
        status.dataset.kind = result.ok ? 'ok' : 'error';
        if (result.ok) { panel.replaceChildren(panel.firstChild); await renderSpotifyPanel(panel); }
    });
    connect.addEventListener('click', submit);
    clientId.addEventListener('keydown', event => { if (event.key === 'Enter') submit(); });
    const copy = hubButton('Copy', async () => { await navigator.clipboard.writeText(current.redirectUri).catch(() => {}); toast('Copied.', 'ok'); });
    const step = (number, text, ...rest) => h('div', { class: 'hub-step' }, h('b', { text: `${number}. ` }), h('span', { text }), ...rest);
    panel.append(
        h('p', { class: 'muted small', text: 'Nexus connects to Spotify through your own free Spotify app. You sign in on Spotify\'s page, so Nexus never sees your password.' }),
        step(1, 'Open Spotify\'s developer site, sign in, and press Create app. Name it Nexus. ', hubButton('Open Spotify', () => ipcRenderer.invoke('open-external-url', 'https://developer.spotify.com/dashboard'))),
        step(2, 'For Redirect URI, paste this exactly: ', h('code', { text: current.redirectUri }), copy),
        step(3, 'Tick Web API, agree to the terms, and press Save. Then open Settings and copy the Client ID.'),
        step(4, 'Open User Management in the same app, and add your name and the email of your Spotify account. Spotify refuses accounts that are not listed there.'),
        step(5, 'Paste the Client ID below and press Connect. Spotify asks you to agree, once.'),
        h('div', { class: 'row wrap' }, clientId, connect),
        status);
}

const spotifyOrderBar = (disabledNote = '') => hubOrderBar({ label: 'Tell Nexus what to do on Spotify', placeholder: 'Tell Nexus, such as: make a chill study playlist with 15 songs', prefix: 'On my Spotify: ', help: 'It can make, fill, and remove playlists, play one, and pause, skip, or go back. It asks before removing a playlist.', disabledNote });

async function renderSpotifyPanel(panel) {
    const current = await ipcRenderer.invoke('hub:spotify-status');
    if (!current.connected || current.signedOut) { panel.append(spotifyOrderBar('Connect Spotify below, then tell Nexus what to do here')); renderSpotifySetup(panel, current); return; }
    panel.append(h('div', { class: 'row wrap' }, h('span', { class: 'muted small', text: current.failed ? current.message : `Connected as ${current.name}${current.premium ? '' : '. Spotify only lets Premium accounts control playback from other apps, so play, pause, and skip may not work, but playlists will'}.` }), hubButton('Disconnect', async () => { await call('hub:spotify-disconnect'); panel.replaceChildren(panel.firstChild); await renderSpotifyPanel(panel); })));
    // The box stays even when Spotify's account check fails, so a request can still be sent and Nexus explains any problem.
    panel.append(spotifyOrderBar());
    if (current.failed) { panel.append(h('div', { class: 'row wrap' }, hubButton('Open Spotify developer site', () => ipcRenderer.invoke('open-external-url', 'https://developer.spotify.com/dashboard')))); return; }
    const status = h('div', { class: 'muted small status-line', role: 'status' });
    const say = (message, failed = true) => { status.textContent = message || ''; status.dataset.kind = failed && message ? 'error' : ''; };
    const run = async (id, args) => { const result = await ipcRenderer.invoke('hub:run', id, args); if (!result.ok) say(result.message); else say(''); return result; };
    const now = h('div', { class: 'hub-now', text: 'Checking what is playing…' });
    const volume = h('input', { type: 'range', min: 0, max: 100, value: 50, 'aria-label': 'Volume' });
    const shuffle = h('input', { type: 'checkbox', 'aria-label': 'Shuffle' });
    let playing = false;
    const refresh = async () => {
        const result = await ipcRenderer.invoke('hub:run', 'spotify.state');
        if (!result.ok) { now.textContent = result.message; return; }
        const state = result.data || {};
        playing = Boolean(state.is_playing);
        toggle.textContent = playing ? 'Pause' : 'Play';
        const track = state.item;
        now.textContent = track ? `${playing ? 'Playing' : 'Paused'}: ${track.name}${track.artists?.length ? ` by ${track.artists.map(artist => artist.name).join(', ')}` : ''}${state.device?.name ? ` on ${state.device.name}` : ''}` : 'Nothing is playing. Pick a playlist below, with Spotify open on a device.';
        if (Number.isFinite(state.device?.volume_percent)) volume.value = state.device.volume_percent;
        shuffle.checked = Boolean(state.shuffle_state);
    };
    const act = async (id, args) => { const result = await run(id, args); if (result.ok) setTimeout(() => refresh().catch(() => {}), 500); return result; };
    const toggle = hubButton('Play', () => act(playing ? 'spotify.pause' : 'spotify.play'), 'action-btn-primary');
    volume.addEventListener('change', () => act('spotify.volume', { percent: Number(volume.value) }));
    shuffle.addEventListener('change', () => act('spotify.shuffle', { on: shuffle.checked }));
    const playlists = h('div', { class: 'doc-list' });
    const target = h('select', { class: 'field', 'aria-label': 'Playlist to add songs to' });
    const searchBox = h('input', { class: 'field', type: 'search', placeholder: 'Search songs and playlists', 'aria-label': 'Search Spotify' });
    const found = h('div', { class: 'doc-list' });
    const playlistRow = item => h('div', { class: 'doc-row' }, h('div', { class: 'grow' }, h('div', { class: 'doc-title', text: item.name }), h('div', { class: 'doc-meta', text: [item.owner?.display_name, Number.isFinite(item.tracks?.total) ? `${item.tracks.total} songs` : ''].filter(Boolean).join(' · ') })), hubButton('Play', () => act('spotify.play', { playlistUri: item.uri })));
    const search = async () => {
        const result = await run('spotify.search', { query: searchBox.value });
        if (!result.ok) return;
        const tracks = result.data?.tracks?.items?.filter(Boolean) || [];
        const lists = result.data?.playlists?.items?.filter(Boolean) || [];
        found.replaceChildren(...tracks.map(track => h('div', { class: 'doc-row' },
            h('div', { class: 'grow' }, h('div', { class: 'doc-title', text: track.name }), h('div', { class: 'doc-meta', text: (track.artists || []).map(artist => artist.name).join(', ') })),
            hubButton('Play', () => act('spotify.play', { trackUri: track.uri })),
            hubButton('Queue', async () => { if ((await act('spotify.queue', { uri: track.uri })).ok) toast(`Added ${track.name} to the queue.`, 'ok'); }),
            hubButton('Add to playlist', async () => { if ((await run('spotify.add-to-playlist', { playlistId: target.value, uri: track.uri })).ok) toast(`Added ${track.name} to the playlist.`, 'ok'); }))),
            ...lists.map(playlistRow));
        if (!tracks.length && !lists.length) found.replaceChildren(emptyState('Nothing found.'));
    };
    searchBox.addEventListener('keydown', event => { if (event.key === 'Enter') search(); });
    panel.append(now,
        h('div', { class: 'row wrap hub-controls' }, hubButton('⏮ Back', () => act('spotify.previous')), toggle, hubButton('Next ⏭', () => act('spotify.next')), h('label', { class: 'muted small hub-inline' }, 'Volume', volume), h('label', { class: 'muted small hub-inline' }, shuffle, 'Shuffle')),
        status,
        h('h4', { text: 'Your playlists' }), playlists,
        h('h4', { text: 'Search' }), h('div', { class: 'row wrap' }, searchBox, hubButton('Search', search), h('label', { class: 'muted small hub-inline' }, 'Add songs to', target)), found);
    const lists = await run('spotify.playlists');
    if (lists.ok) {
        const items = hubList(lists.data).filter(Boolean);
        playlists.replaceChildren(...(items.length ? items.map(playlistRow) : [emptyState('No playlists on this account.')]));
        target.replaceChildren(...items.map(item => h('option', { value: item.id, text: item.name })));
    }
    await refresh();
    clearInterval(hubTimer);
    hubTimer = setInterval(() => { if (hubOpen() && now.isConnected) refresh().catch(() => {}); else clearInterval(hubTimer); }, 15000);
}

// Setting up your own bot takes a minute on Discord's site, and only needs doing once.
function renderDiscordSetup(panel, bot) {
    const status = h('div', { class: 'muted small status-line', role: 'status', text: bot.invalid ? bot.message : '', dataset: { kind: bot.invalid ? 'error' : '' } });
    const token = h('input', { class: 'field', type: 'password', placeholder: 'Paste your bot token here', 'aria-label': 'Bot token', autocomplete: 'off' });
    const connect = h('button', { type: 'button', class: 'action-btn-primary', text: 'Connect' });
    const submit = busyButton(connect, 'Connecting…', async () => {
        const result = await ipcRenderer.invoke('hub:discord-connect', token.value);
        token.value = '';
        status.textContent = result.message;
        status.dataset.kind = result.ok ? 'ok' : 'error';
        if (result.ok) { panel.replaceChildren(panel.firstChild); await renderDiscordPanel(panel); }
    });
    connect.addEventListener('click', submit);
    token.addEventListener('keydown', event => { if (event.key === 'Enter') submit(); });
    const step = (number, text, ...rest) => h('div', { class: 'hub-step' }, h('b', { text: `${number}. ` }), h('span', { text }), ...rest);
    panel.append(
        h('p', { class: 'muted small', text: 'Nexus runs as your own Discord bot. Nobody else can remove it from your account, and you can add it to any server you manage.' }),
        step(1, 'Open Discord\'s site, press New Application, and name it Nexus. ', hubButton('Open Discord', () => ipcRenderer.invoke('open-external-url', 'https://discord.com/developers/applications'))),
        step(2, 'Go to the Bot page, press Reset Token, then Copy.'),
        step(3, 'Paste it below and press Connect. Treat it like a password: only paste it here, and never share it with anyone.'),
        h('div', { class: 'row wrap' }, token, connect),
        status);
}

// Linking a Discord account lets that one person control Nexus by messaging the bot from their phone.
async function renderPhoneLink(box) {
    const current = await ipcRenderer.invoke('hub:phone-status');
    const status = h('div', { class: 'muted small status-line', role: 'status' });
    const redraw = async () => { box.replaceChildren(); await renderPhoneLink(box); };
    box.append(h('h4', { text: 'Control Nexus from your phone' }));
    if (current.linked) {
        box.append(h('p', { class: 'muted small', text: `Linked to ${current.name || 'your Discord account'}. Message the bot from Discord on your phone and Nexus does it on this PC, then answers you there. Risky things, like deleting, ask you to reply yes first. Nexus has to be running on this PC.` }),
            h('div', { class: 'row wrap' }, hubButton('Unlink', async () => { await call('hub:phone-unlink'); await redraw(); })));
        return;
    }
    const person = h('select', { class: 'field', 'aria-label': 'Your Discord account' }, h('option', { value: '', text: 'Loading people…' }));
    const link = h('button', { type: 'button', class: 'action-btn-primary', text: 'Link my account' });
    link.addEventListener('click', busyButton(link, 'Sending code…', async () => {
        const result = await ipcRenderer.invoke('hub:phone-link', person.value, person.selectedOptions[0]?.textContent || '');
        status.textContent = result.message;
        status.dataset.kind = result.ok ? 'ok' : 'error';
        if (result.ok) waitForLink();
    }));
    const waitForLink = () => {
        const timer = setInterval(async () => {
            if (!box.isConnected) { clearInterval(timer); return; }
            const now = await ipcRenderer.invoke('hub:phone-status');
            if (now.linked) { clearInterval(timer); toast('Your phone is linked.', 'ok'); await redraw(); }
            else if (!now.waitingForCode) { clearInterval(timer); status.textContent = 'The code ran out. Press Link my account again.'; status.dataset.kind = 'error'; }
        }, 4000);
    };
    box.append(h('p', { class: 'muted small', text: 'Choose your own Discord account. The bot sends you a code in a direct message; reply with it, and from then on you can message the bot from your phone to tell Nexus what to do. Only your account is listened to.' }),
        h('div', { class: 'row wrap' }, person, link), status);
    if (current.waitingForCode) { status.textContent = 'Waiting for you to reply to the bot with the code.'; waitForLink(); }
    const result = await ipcRenderer.invoke('hub:phone-people');
    if (!result.ok || !result.people?.length) { person.replaceChildren(h('option', { value: '', text: result.ok ? 'Add the bot to your server first' : 'Could not load people' })); if (!result.ok) { status.textContent = result.message; status.dataset.kind = 'error'; } return; }
    person.replaceChildren(h('option', { value: '', text: 'Choose your account' }), ...result.people.map(item => h('option', { value: item.id, text: item.name })));
}

async function renderDiscordPanel(panel) {
    const bot = await ipcRenderer.invoke('hub:discord-status');
    if (!bot.connected || bot.invalid) { renderDiscordSetup(panel, bot); return; }
    const addToServer = () => ipcRenderer.invoke('open-external-url', bot.inviteUrl);
    if (bot.offline) { panel.append(h('p', { class: 'error-text small', text: bot.message })); return; }
    panel.append(
        h('div', { class: 'row wrap' }, h('span', { class: 'muted small', text: `Connected as ${bot.name}, in ${bot.serverCount} server${bot.serverCount === 1 ? '' : 's'}.` }),
            hubButton('Add to a server', addToServer, bot.serverCount ? 'integration-button secondary' : 'action-btn-primary'),
            hubButton('Disconnect', async () => { await call('hub:discord-disconnect'); panel.replaceChildren(panel.firstChild); await renderDiscordPanel(panel); })),
        bot.intentsOk ? null : h('p', { class: 'error-text small' }, h('span', { text: 'Discord needs two switches turned on so the bot can read messages and roles: Server Members Intent and Message Content Intent, on the Bot page. ' }), hubButton('Open Bot page', () => ipcRenderer.invoke('open-external-url', bot.portalUrl))));
    panel.append(hubOrderBar({ label: 'Tell your Discord bot what to do', placeholder: 'Tell your bot, such as: make a Development category with coding and testing channels', prefix: 'On my Discord server, as the Nexus bot: ', help: 'It can look at your channels, make channels and categories, move channels into categories, post and read messages, and make forum posts.', button: 'Tell bot' }));
    const status = h('div', { class: 'muted small status-line', role: 'status' });
    const say = message => { status.textContent = message || ''; status.dataset.kind = message ? 'error' : ''; };
    const run = async (id, args) => { const result = await ipcRenderer.invoke('hub:run', id, args); say(result.ok ? '' : result.message); return result; };
    const server = h('select', { class: 'field', 'aria-label': 'Server' });
    const channel = h('select', { class: 'field', 'aria-label': 'Channel' });
    const messages = h('div', { class: 'hub-messages', role: 'log' });
    const box = h('textarea', { class: 'field', rows: 2, maxlength: 2000, placeholder: 'Message to send as the bot', 'aria-label': 'Message', style: 'width:100%' });
    const members = h('div', { class: 'muted small' });
    const loadMessages = async () => {
        if (!channel.value) { messages.replaceChildren(emptyState('Choose a channel.')); return; }
        const result = await run('discord.messages', { channelId: channel.value });
        if (!result.ok) return;
        const items = hubList(result.data).slice().reverse();
        messages.replaceChildren(...(items.length ? items.map(item => h('div', { class: 'hub-message' }, h('b', { text: `${item.author?.global_name || item.author?.username || 'Someone'}: ` }), h('span', { text: item.content || '(no text)' }))) : [emptyState('No messages here yet.')]));
    };
    const loadServer = async () => {
        channel.replaceChildren();
        if (!server.value) return;
        const [channels, people] = await Promise.all([run('discord.channels', { serverId: server.value }), ipcRenderer.invoke('hub:run', 'discord.members', { serverId: server.value })]);
        if (channels.ok) channel.replaceChildren(...hubList(channels.data).filter(item => item.type === 0 || item.type === 5).map(item => h('option', { value: item.id, text: `# ${item.name}` })));
        members.textContent = people.ok ? `${hubList(people.data).length} members found.` : '';
        await loadMessages();
    };
    server.addEventListener('change', () => loadServer());
    channel.addEventListener('change', () => loadMessages());
    const send = h('button', { type: 'button', class: 'action-btn-primary', text: 'Send as bot' });
    send.addEventListener('click', busyButton(send, 'Sending…', async () => {
        if ((await run('discord.send', { channelId: channel.value, content: box.value })).ok) { box.value = ''; toast('Message sent.', 'ok'); await loadMessages(); }
    }));
    const phoneBox = h('div', { class: 'hub-phone' });
    const inboxStatus = h('div', { class: 'muted small status-line', role: 'status' });
    const inboxList = h('div', { class: 'doc-list' });
    const OUTCOMES = { waiting: 'With Claude', done: 'Done, ready in Studio', held: 'Needs your okay', failed: 'Not finished', ignored: 'Not used' };
    const loadInbox = async () => {
        const inbox = await ipcRenderer.invoke('hub:suggestions');
        inboxList.replaceChildren(...([]), ...(inbox.items?.length ? inbox.items.map(item => h('div', { class: 'doc-row', dataset: { suggestion: item.id } }, h('div', { class: 'grow' }, h('div', { class: 'doc-title set-definition', text: [item.postTitle, item.text].filter(Boolean).join(': ') || '(image only)' }), h('div', { class: 'doc-meta', text: [item.author, formatWhen(item.at), item.images.length ? `${item.images.length} image${item.images.length === 1 ? '' : 's'}` : '', OUTCOMES[item.outcome] || item.outcome, item.note].filter(Boolean).join(' · ') })), item.outcome === 'held' ? hubButton('Approve', async () => { if (await confirmModal('Approve this suggestion', 'Let Claude make this change in Studio? Robux, admin powers, saved data, and outside scripts stay off limits.', 'Approve', false)) { await call('hub:suggestions-retry', item.id, { approved: true }); await loadInbox(); } }) : null, item.outcome === 'failed' ? hubButton('Try again', async () => { await call('hub:suggestions-retry', item.id); await loadInbox(); }) : null)) : [emptyState(`Nothing yet. Someone with the ${inbox.roleName} role pings the bot in a #${inbox.channelName} post to send it here.`)]));
    };
    const checkNow = h('button', { type: 'button', class: 'action-btn-primary', text: 'Check now' });
    checkNow.addEventListener('click', busyButton(checkNow, 'Checking…', async () => {
        const result = await ipcRenderer.invoke('hub:suggestions-check');
        inboxStatus.textContent = result.message;
        inboxStatus.dataset.kind = result.ok ? 'ok' : 'error';
        await loadInbox();
    }));
    panel.append(h('div', { class: 'study-form-row' }, server, channel, hubButton('Refresh messages', loadMessages)), status, messages, box, h('div', { class: 'row' }, send), members,
        phoneBox,
        h('h4', { text: 'Game suggestions' }), h('p', { class: 'muted small', text: 'When someone with the Owner role pings the bot in a suggestions post, it replies there and sends the post to Claude, who works on it in Studio. Nexus looks for pings once a minute while it runs, and Studio needs to be open.' }),
        h('div', { class: 'row wrap' }, checkNow, hubButton('Open folder', () => ipcRenderer.invoke('hub:suggestions-folder'))), inboxStatus, inboxList);
    loadInbox().catch(() => {});
    renderPhoneLink(phoneBox).catch(error => phoneBox.append(h('p', { class: 'error-text small', text: error.message })));
    const servers = await run('discord.servers');
    if (!servers.ok) return;
    const items = hubList(servers.data);
    if (!items.length) { say('The bot is not in a server yet. Press Add to a server, choose your server on Discord, then press Refresh at the top of this page.'); return; }
    server.replaceChildren(...items.map(item => h('option', { value: item.id, text: item.name })));
    await loadServer();
}

// Fields are drawn from what Composio says the action takes, so this works for every app.
async function renderRunner(panel, accounts) {
    const active = accounts.filter(account => account.status === 'ACTIVE');
    if (!active.length) { panel.append(emptyState('Connect an app first.')); return; }
    const appSelect = h('select', { class: 'field', 'aria-label': 'App' }, [...new Set(active.map(account => account.toolkit))].map(name => h('option', { value: name, text: name })));
    const filter = h('input', { class: 'field', type: 'search', placeholder: 'Filter actions', 'aria-label': 'Filter actions' });
    const actionSelect = h('select', { class: 'field', 'aria-label': 'Action' });
    const about = h('p', { class: 'muted small' });
    const fields = h('div', { class: 'study-form-row' });
    const output = h('pre', { class: 'hub-output hidden' });
    const status = h('div', { class: 'muted small status-line', role: 'status' });
    let actions = [];
    const drawFields = () => {
        const action = actions.find(item => item.slug === actionSelect.value);
        about.textContent = action?.description || '';
        const names = [...(action?.required || []), ...(action?.inputs || []).filter(name => !(action?.required || []).includes(name))].slice(0, 12);
        fields.replaceChildren(...names.map(name => h('label', { class: 'muted small' }, `${name}${action.required.includes(name) ? ' (required)' : ''}`, h('input', { class: 'field', type: 'text', dataset: { field: name, kind: action.inputTypes?.[name] || 'string' }, 'aria-label': name }))));
    };
    const drawActions = () => {
        const wanted = filter.value.trim().toLowerCase();
        const shown = actions.filter(item => !wanted || `${item.slug} ${item.description}`.toLowerCase().includes(wanted));
        actionSelect.replaceChildren(...shown.map(item => h('option', { value: item.slug, text: item.name || item.slug })));
        drawFields();
    };
    const loadActions = async () => {
        const wanted = appSelect.value;
        const result = await ipcRenderer.invoke('composio:actions', wanted);
        // A slower reply for an app that is no longer chosen must not replace the current list.
        if (wanted !== appSelect.value) return;
        actions = result.actions || [];
        status.textContent = result.ok ? '' : result.message;
        drawActions();
    };
    const run = h('button', { type: 'button', class: 'action-btn-primary', text: 'Run' });
    run.addEventListener('click', busyButton(run, 'Running…', async () => {
        const args = {};
        for (const input of fields.querySelectorAll('input')) {
            if (!input.value.trim()) continue;
            const kind = input.dataset.kind;
            try { args[input.dataset.field] = kind === 'number' || kind === 'integer' ? Number(input.value) : kind === 'boolean' ? input.value.trim().toLowerCase() === 'true' : kind === 'array' || kind === 'object' ? JSON.parse(input.value) : input.value; }
            catch { throw new Error(`${input.dataset.field} must be written as JSON, such as ["a","b"].`); }
        }
        const result = await ipcRenderer.invoke('hub:run-any', { toolkit: appSelect.value, slug: actionSelect.value, args });
        status.textContent = result.ok ? 'Done.' : result.message;
        status.dataset.kind = result.ok ? 'ok' : 'error';
        output.classList.toggle('hidden', !result.ok);
        output.textContent = result.ok ? JSON.stringify(result.data, null, 2).slice(0, 20000) : '';
    }));
    appSelect.addEventListener('change', loadActions);
    filter.addEventListener('input', drawActions);
    actionSelect.addEventListener('change', drawFields);
    panel.append(h('div', { class: 'study-form-row' }, appSelect, filter, actionSelect), about, fields, h('div', { class: 'row' }, run), status, output);
    await loadActions();
}

async function renderSmartHomePanel(panel) {
    const status = h('div', { class: 'muted small status-line', role: 'status' });
    const current = await ipcRenderer.invoke('smarthome:status');
    if (!current.connected) {
        const url = h('input', { class: 'field', type: 'text', placeholder: 'http://homeassistant.local:8123', 'aria-label': 'Home Assistant address', value: current.url || '' });
        const token = h('input', { class: 'field', type: 'password', placeholder: 'Long-lived access token', 'aria-label': 'Access token', autocomplete: 'off' });
        const connect = h('button', { type: 'button', class: 'action-btn-primary', text: 'Connect' });
        connect.addEventListener('click', busyButton(connect, 'Connecting…', async () => {
            const result = await ipcRenderer.invoke('smarthome:connect', { url: url.value, token: token.value });
            token.value = '';
            status.textContent = result.message;
            status.dataset.kind = result.ok ? 'ok' : 'error';
            if (result.ok) { panel.replaceChildren(panel.firstChild); await renderSmartHomePanel(panel); }
        }));
        panel.append(h('p', { class: 'muted small', text: 'Nexus controls lights, plugs, thermostats, and more through Home Assistant, a free hub that works with most brands. You need Home Assistant running, and a token from your profile page there. The token is stored encrypted on this computer.' }), h('div', { class: 'study-form-row' }, url, token), h('div', { class: 'row' }, connect), status);
        return;
    }
    const list = h('div', { class: 'doc-list' });
    const load = async () => {
        const result = await ipcRenderer.invoke('smarthome:devices');
        status.textContent = result.ok ? '' : result.message;
        status.dataset.kind = result.ok ? '' : 'error';
        if (!result.ok) return;
        list.replaceChildren(...(result.devices.length ? result.devices.map(device => h('div', { class: 'doc-row', dataset: { device: device.id } }, h('div', { class: 'grow' }, h('div', { class: 'doc-title', text: device.name }), h('div', { class: 'doc-meta', text: `${device.type.replace('_', ' ')} · ${device.state}` })), device.actions.filter(action => !(device.actions.includes('toggle') && action.startsWith('turn_'))).filter(action => action !== 'media_play_pause').map(action => hubButton(action.replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase()), async () => {
            if (device.sensitive && !await confirmModal(device.name, `${action.replace(/_/g, ' ')}: ${device.name}?`, 'Yes')) return;
            const done = await ipcRenderer.invoke('smarthome:control', device.id, action);
            status.textContent = done.ok ? '' : done.message;
            status.dataset.kind = done.ok ? '' : 'error';
            if (done.ok) setTimeout(() => load().catch(() => {}), 500);
        })))) : [emptyState('Home Assistant reported no devices Nexus can control.')]));
    };
    panel.append(h('div', { class: 'row wrap' }, h('span', { class: 'muted small', text: `Connected to ${current.url}` }), hubButton('Disconnect', async () => { await call('smarthome:disconnect'); panel.replaceChildren(panel.firstChild); await renderSmartHomePanel(panel); })), status, list);
    await load();
}

// Composio can answer slowly. A visit that finishes after a newer one must not draw over it.
let hubRenderCount = 0;
async function renderHub() {
    const thisRender = ++hubRenderCount;
    const root = document.getElementById('hub-root');
    const home = h('section', { class: 'school-card study-form hub-panel', id: 'hub-home' }, h('h3', { text: 'Smart home' }));
    renderSmartHomePanel(home).catch(error => home.append(h('p', { class: 'error-text small', text: error.message })));
    // Old panels go right away, or a click on one is lost when the fresh page replaces it.
    const spotify = h('section', { class: 'school-card study-form hub-panel', id: 'hub-spotify' }, h('h3', { text: 'Spotify' }));
    renderSpotifyPanel(spotify).catch(error => spotify.append(h('p', { class: 'error-text small', text: error.message })));
    const discord = h('section', { class: 'school-card study-form hub-panel', id: 'hub-discord' }, h('h3', { text: 'Discord bot' }));
    renderDiscordPanel(discord).catch(error => discord.append(h('p', { class: 'error-text small', text: error.message })));
    root.replaceChildren(spotify, discord, home, h('p', { class: 'muted small', text: 'Loading your connected apps…' }));
    const status = await ipcRenderer.invoke('composio:status');
    if (thisRender !== hubRenderCount) return;
    if (!status.verified) { root.replaceChildren(spotify, discord, home, h('section', { class: 'school-card' }, h('p', { text: 'Add and verify your Composio key in Settings to control your other connected apps from here.' }), hubButton('Open Settings', () => go('settings'), 'action-btn-primary'))); return; }
    const accounts = await ipcRenderer.invoke('hub:accounts');
    if (thisRender !== hubRenderCount) return;
    if (!Array.isArray(accounts)) { root.replaceChildren(h('p', { class: 'error-text', text: accounts?.message || 'Could not load your apps.' })); return; }
    const find = toolkit => accounts.find(account => account.toolkit === toolkit && account.status === 'ACTIVE') || accounts.find(account => account.toolkit === toolkit);
    const section = (id, title) => h('section', { class: 'school-card study-form hub-panel', id }, h('h3', { text: title }));
    const runner = section('hub-runner', 'Any connected app');
    runner.append(h('p', { class: 'muted small', text: 'Run any action a connected app offers. Anything that could change something asks you first.' }));
    root.replaceChildren(spotify, discord, home, runner);
    const failed = (panel, error) => panel.append(h('p', { class: 'error-text small', text: error.message }));
    renderRunner(runner, accounts).catch(error => failed(runner, error));
}

function bindHub() {
    PAGE_HOOKS.hub = () => renderHub().catch(error => toast(error.message, 'error'));
    document.getElementById('hub-refresh')?.addEventListener('click', () => PAGE_HOOKS.hub());
}
