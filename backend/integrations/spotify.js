const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

// Nexus talks to Spotify directly through the person's own Spotify app. Signing in happens on Spotify's page, so Nexus never sees the password, and the PKCE sign-in needs no app secret.
const PORT = 47811;
const SCOPES = ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing', 'playlist-read-private', 'playlist-read-collaborative', 'playlist-modify-private', 'playlist-modify-public'];
const SIGN_IN_TIME_MS = 5 * 60000;
const id = value => { const clean = String(value ?? '').trim(); if (!clean) throw new Error('Something to play is missing.'); return encodeURIComponent(clean); };
const PAGE = message => `<!doctype html><meta charset="utf-8"><title>Nexus</title><body style="font-family:Segoe UI,sans-serif;background:#0b1530;color:#fff;display:grid;place-items:center;height:90vh"><h2>${message}</h2></body>`;

function createSpotify({ dataDir, safeStorage, openExternal, fetchFn = (...args) => fetch(...args), accountsBase = 'https://accounts.spotify.com', apiBase = 'https://api.spotify.com/v1', port = PORT }) {
  const secretPath = path.join(dataDir, 'spotify-token.enc');
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  let pending = null;
  async function readSecret() { try { return JSON.parse((await safeStorage.decryptStringAsync(await fs.promises.readFile(secretPath))).result); } catch { return null; } }
  async function writeSecret(value) { await fs.promises.mkdir(dataDir, { recursive: true }); await fs.promises.writeFile(secretPath, await safeStorage.encryptStringAsync(JSON.stringify(value)), { mode: 0o600 }); }
  async function token(form) {
    let reply;
    try { reply = await fetchFn(`${accountsBase}/api/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString(), signal: AbortSignal.timeout(20000) }); }
    catch { throw new Error('Nexus could not reach Spotify. Check your internet connection.'); }
    const data = await reply.json().catch(() => ({}));
    if (!reply.ok) throw Object.assign(new Error(data.error === 'invalid_grant' ? 'Spotify ended this sign-in. Connect again.' : `Spotify refused the sign-in: ${String(data.error_description || data.error || reply.status).slice(0, 200)}`), { signedOut: data.error === 'invalid_grant' });
    return data;
  }
  async function accessToken() {
    const saved = await readSecret();
    if (!saved) return null;
    if (saved.expiresAt > Date.now() + 60000) return saved.access;
    const fresh = await token({ grant_type: 'refresh_token', refresh_token: saved.refresh, client_id: saved.clientId });
    // Spotify may hand out a new refresh token each time, and the old one then stops working.
    await writeSecret({ ...saved, access: fresh.access_token, refresh: fresh.refresh_token || saved.refresh, expiresAt: Date.now() + fresh.expires_in * 1000 });
    return fresh.access_token;
  }
  async function api(route, { method = 'GET', body } = {}) {
    const access = await accessToken();
    if (!access) throw Object.assign(new Error('Spotify is not connected.'), { notConnected: true });
    let reply;
    try { reply = await fetchFn(`${apiBase}${route}`, { method, headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) }); }
    catch { throw new Error('Nexus could not reach Spotify. Check your internet connection.'); }
    if (reply.status === 204) return {};
    // Some refusals come back as plain text rather than JSON, so the text is kept as the message.
    let data;
    if (typeof reply.text !== 'function') data = await reply.json().catch(() => ({}));
    else {
      const text = await reply.text().catch(() => '');
      try { data = text ? JSON.parse(text) : {}; } catch { data = reply.ok ? {} : { error: { message: text } }; }
    }
    if (!reply.ok) {
      const reason = data.error?.reason || '';
      if (reason === 'NO_ACTIVE_DEVICE' || (reply.status === 404 && /player/.test(route))) throw new Error('NO_ACTIVE_DEVICE');
      if (reason === 'PREMIUM_REQUIRED') throw new Error('PREMIUM_REQUIRED');
      // Spotify only lets an app work while the account that made it on the developer site has Premium.
      if (reply.status === 403 && /premium subscription required for the owner/i.test(data.error?.message || '')) throw new Error('Spotify blocks this until the account that made your Spotify app on the developer site has Premium. If you just got Premium, it can take a few hours to start working.');
      if (reply.status === 403) throw new Error(`Spotify would not allow this${data.error?.message ? `: ${String(data.error.message).slice(0, 200)}` : ''}. Check you added your account under User Management in your Spotify app.`);
      throw new Error(`Spotify answered with an error: ${String(data.error?.message || reply.status).slice(0, 200)}`);
    }
    return data;
  }
  // Waits for Spotify to send the browser back with a sign-in code, on this computer only.
  function connect(clientIdInput) {
    const clientId = String(clientIdInput || '').trim();
    if (!/^[0-9a-f]{32}$/i.test(clientId)) return Promise.resolve({ ok: false, message: 'That doesn\'t look like a Client ID. It is 32 letters and numbers, on your Spotify app\'s Settings page.' });
    pending?.close();
    const verifier = crypto.randomBytes(48).toString('base64url');
    const state = crypto.randomBytes(16).toString('hex');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return new Promise(resolve => {
      let done = false;
      const finish = result => { if (done) return; done = true; clearTimeout(timer); server.close(); pending = null; resolve(result); };
      const server = http.createServer(async (request, response) => {
        const url = new URL(request.url, redirectUri);
        if (url.pathname !== '/callback') { response.writeHead(404); response.end(); return; }
        const send = (message, status = 200) => { response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(PAGE(message)); };
        if (url.searchParams.get('state') !== state) { send('This sign-in link is out of date. Go back to Nexus and press Connect again.', 400); return; }
        if (url.searchParams.get('error')) { send('Spotify sign-in was cancelled. You can close this tab.'); finish({ ok: false, message: 'The Spotify sign-in was cancelled.' }); return; }
        try {
          const granted = await token({ grant_type: 'authorization_code', code: url.searchParams.get('code') || '', redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier });
          await writeSecret({ clientId, access: granted.access_token, refresh: granted.refresh_token, expiresAt: Date.now() + granted.expires_in * 1000 });
          send('Spotify is connected to Nexus. You can close this tab.');
          finish({ ok: true, message: 'Spotify is connected.' });
        } catch (error) { send('Spotify did not finish the sign-in. Go back to Nexus to see why.', 500); finish({ ok: false, message: error.message }); }
      });
      const timer = setTimeout(() => finish({ ok: false, message: 'The Spotify sign-in timed out. Press Connect to try again.' }), SIGN_IN_TIME_MS);
      server.on('error', error => finish({ ok: false, message: error.code === 'EADDRINUSE' ? `Something else on this computer is using port ${port}. Close it and try again.` : error.message }));
      server.listen(port, '127.0.0.1', () => {
        pending = { close: () => finish({ ok: false, message: 'A newer sign-in replaced this one.' }) };
        const query = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirectUri, scope: SCOPES.join(' '), state, code_challenge_method: 'S256', code_challenge: challenge });
        Promise.resolve(openExternal(`${accountsBase}/authorize?${query}`)).catch(() => {});
      });
    });
  }
  async function disconnect() { pending?.close(); await fs.promises.unlink(secretPath).catch(() => {}); return { ok: true }; }
  async function status() {
    if (!await readSecret()) return { connected: false, redirectUri };
    try { const me = await api('/me'); return { connected: true, name: me.display_name || me.id, premium: me.product === 'premium', redirectUri }; }
    catch (error) { return { connected: true, failed: true, signedOut: Boolean(error.signedOut), message: error.message, redirectUri }; }
  }
  // A new playlist, filled with the best search match for each song named. Songs that can't be found are reported, not guessed.
  async function createPlaylist({ name, description = '', songs = [] }) {
    const title = String(name ?? '').trim().slice(0, 100);
    if (!title) throw new Error('A playlist name is missing.');
    const me = await api('/me');
    const playlist = await api(`/users/${encodeURIComponent(me.id)}/playlists`, { method: 'POST', body: { name: title, description: String(description).slice(0, 300), public: false } });
    const added = [];
    const missing = [];
    for (const song of (Array.isArray(songs) ? songs : []).slice(0, 50)) {
      const wanted = String(song ?? '').trim();
      if (!wanted) continue;
      const found = (await api(`/search?type=track&limit=1&q=${encodeURIComponent(wanted)}`)).tracks?.items?.[0];
      if (found) added.push(found); else missing.push(wanted);
    }
    if (added.length) await api(`/playlists/${encodeURIComponent(playlist.id)}/tracks`, { method: 'POST', body: { uris: added.map(track => track.uri) } });
    return { id: playlist.id, name: playlist.name || title, url: playlist.external_urls?.spotify || '', added: added.map(track => `${track.name} by ${(track.artists || []).map(artist => artist.name).join(', ')}`), missing };
  }
  const ROUTES = {
    'spotify.create-playlist': args => createPlaylist(args),
    // Spotify has no delete: unfollowing a playlist removes it from the library, and the owner can restore it later on spotify.com.
    'spotify.remove-playlist': ({ playlistId }) => api(`/playlists/${id(playlistId)}/followers`, { method: 'DELETE' }),
    'spotify.state': () => api('/me/player'),
    'spotify.devices': () => api('/me/player/devices'),
    'spotify.playlists': () => api('/me/playlists?limit=50'),
    'spotify.search': ({ query }) => { const q = String(query ?? '').trim(); if (!q) throw new Error('A search is missing.'); return api(`/search?type=track,playlist&limit=10&q=${encodeURIComponent(q)}`); },
    'spotify.play': ({ playlistUri, trackUri }) => api('/me/player/play', { method: 'PUT', body: playlistUri ? { context_uri: String(playlistUri) } : trackUri ? { uris: [String(trackUri)] } : undefined }),
    'spotify.pause': () => api('/me/player/pause', { method: 'PUT' }),
    'spotify.next': () => api('/me/player/next', { method: 'POST' }),
    'spotify.previous': () => api('/me/player/previous', { method: 'POST' }),
    'spotify.volume': ({ percent }) => api(`/me/player/volume?volume_percent=${Math.max(0, Math.min(100, Math.round(Number(percent) || 0)))}`, { method: 'PUT' }),
    'spotify.shuffle': ({ on }) => api(`/me/player/shuffle?state=${Boolean(on)}`, { method: 'PUT' }),
    'spotify.queue': ({ uri }) => api(`/me/player/queue?uri=${id(uri)}`, { method: 'POST' }),
    'spotify.add-to-playlist': ({ playlistId, uri }) => api(`/playlists/${id(playlistId)}/tracks`, { method: 'POST', body: { uris: [String(uri ?? '')] } })
  };
  async function run(action, args = {}) {
    if (!ROUTES[action]) return { ok: false, message: 'Nexus does not know that action.' };
    try { return { ok: true, data: await ROUTES[action](args) }; }
    catch (error) { return { ok: false, notConnected: Boolean(error.notConnected), message: error.message }; }
  }
  return { connect, disconnect, status, run, redirectUri };
}

module.exports = { createSpotify, SCOPES };
