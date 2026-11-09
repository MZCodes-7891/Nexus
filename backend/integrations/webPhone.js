const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// The phone page: NEXUS served to a phone's browser on the home network, or anywhere through Tailscale.
// It is off until switched on, and every request needs the secret key from the QR code; anyone without it gets nothing.
const PORT = 47820;
const COOKIE = 'nexus_key';

function createWebPhone({ dataDir, pageFile, api, logger, port = PORT }) {
  const keyFile = path.join(dataDir, 'phone-page-key.json');
  let server = null;
  let key = '';
  const loadKey = async () => { try { key = JSON.parse(await fs.promises.readFile(keyFile, 'utf8')).key || ''; } catch { key = ''; } if (!key) await newKey(); return key; };
  async function newKey() { key = crypto.randomBytes(24).toString('base64url'); await fs.promises.writeFile(keyFile, JSON.stringify({ key })); return key; }
  const sameKey = given => { const a = Buffer.from(String(given || '')); const b = Buffer.from(key); return a.length === b.length && crypto.timingSafeEqual(a, b); };
  const cookieKey = request => (String(request.headers.cookie || '').match(new RegExp(`${COOKIE}=([\\w-]+)`)) || [])[1];

  // Addresses the phone can reach: the home network, and Tailscale (100.x) when it is installed.
  function addresses() {
    const found = [];
    for (const [name, list] of Object.entries(os.networkInterfaces())) {
      for (const item of list || []) {
        if (item.family !== 'IPv4' || item.internal) continue;
        const tailscale = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(item.address) || /tailscale/i.test(name);
        if (tailscale || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(item.address)) found.push({ address: item.address, kind: tailscale ? 'tailscale' : 'home', url: `http://${item.address}:${port}/?k=${key}` });
      }
    }
    return found.sort((a, b) => (a.kind === 'home' ? -1 : 1) - (b.kind === 'home' ? -1 : 1));
  }

  const json = (response, status, body) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); };
  const readBody = request => new Promise((resolve, reject) => { let text = ''; request.on('data', chunk => { text += chunk; if (text.length > 12 * 1024 * 1024) { reject(new Error('Too large')); request.destroy(); } }); request.on('end', () => { try { resolve(text ? JSON.parse(text) : {}); } catch { reject(new Error('Bad request')); } }); });

  async function handle(request, response) {
    const url = new URL(request.url, 'http://phone');
    // The key arrives in the QR link and is kept in a cookie. The link keeps it too, because an app added to an iPhone's
    // home screen doesn't share Safari's cookies and opens the address it was saved from.
    let setCookie = null;
    if (url.searchParams.has('k')) {
      if (!sameKey(url.searchParams.get('k'))) { response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('This link is old. Scan the QR code in NEXUS again.'); return; }
      setCookie = `${COOKIE}=${key}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`;
      request.headers.cookie = `${COOKIE}=${key}`;
    }
    if (url.pathname === '/manifest.webmanifest') { response.writeHead(200, { 'Content-Type': 'application/manifest+json' }); response.end(JSON.stringify({ name: 'NEXUS', short_name: 'NEXUS', start_url: sameKey(cookieKey(request)) ? `/?k=${key}` : '/', display: 'standalone', background_color: '#050b18', theme_color: '#050b18', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }] })); return; }
    if (url.pathname === '/sw.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/' });
      response.end(`self.addEventListener('push', event => { let data = {}; try { data = event.data.json(); } catch {} event.waitUntil(self.registration.showNotification(data.title || 'NEXUS', { body: data.body || '', icon: '/icon.svg', badge: '/icon.svg', tag: data.tag || undefined, data: { url: data.url || '/' } })); });
self.addEventListener('notificationclick', event => { event.notification.close(); const target = (event.notification.data && event.notification.data.url) || '/'; event.waitUntil(clients.matchAll({ type: 'window' }).then(list => list.length ? list[0].navigate(target).then(client => (client || list[0]).focus()).catch(() => list[0].focus()) : clients.openWindow(target))); });`);
      return;
    }
    if (url.pathname === '/icon.svg') { response.writeHead(200, { 'Content-Type': 'image/svg+xml' }); response.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="22" fill="#0b1a36"/><text x="48" y="64" font-family="Segoe UI,Arial" font-size="52" font-weight="700" text-anchor="middle" fill="#38bdf8">N</text></svg>'); return; }
    if (!sameKey(cookieKey(request))) { response.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' }); response.end('<meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;background:#050b18;color:#eaf3ff;padding:24px"><h2>NEXUS</h2><p>Scan the QR code in NEXUS → Settings → Phone to open this on your phone.</p>'); return; }
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      response.writeHead(200, { ...(setCookie ? { 'Set-Cookie': setCookie } : {}), 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:" });
      response.end(await fs.promises.readFile(pageFile));
      return;
    }
    if (!url.pathname.startsWith('/api/')) { json(response, 404, { ok: false, message: 'Not found' }); return; }
    const route = `${request.method} ${url.pathname.slice(5)}`;
    try {
      // The chat streams its steps and answer as server-sent events, like the chat on the PC.
      if (route === 'POST chat') {
        const body = await readBody(request);
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        const sendEvent = event => response.write(`data: ${JSON.stringify(event)}\n\n`);
        await api.chat(Array.isArray(body.messages) ? body.messages.slice(-12) : [], sendEvent, () => response.writableEnded);
        response.end();
        return;
      }
      const handler = api.routes[route];
      if (!handler) { json(response, 404, { ok: false, message: 'Not found' }); return; }
      const body = request.method === 'POST' ? await readBody(request) : {};
      json(response, 200, await handler(body, url.searchParams));
    } catch (error) { logger?.warn(`phone page ${route}: ${error.message}`); if (!response.headersSent) json(response, 500, { ok: false, message: error.message }); else response.end(); }
  }

  async function start() {
    if (server) return status();
    await loadKey();
    server = http.createServer((request, response) => { handle(request, response).catch(() => { try { response.end(); } catch {} }); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '0.0.0.0', resolve); }).catch(error => { server = null; throw new Error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : error.message); });
    return status();
  }
  async function stop() { if (server) await new Promise(resolve => server.close(resolve)); server = null; return status(); }
  async function resetKey() { await newKey(); return status(); }
  function status() { return { on: Boolean(server), port, addresses: server ? addresses() : [] }; }
  return { start, stop, resetKey, status, loadKey };
}

module.exports = { createWebPhone, PORT };
