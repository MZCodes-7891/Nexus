const fs = require('fs');
const path = require('path');

// Smart home control through the person's own Home Assistant, which already supports most brands of device. Requests stay on their network unless their address says otherwise.
const CONTROLS = { light: ['toggle', 'turn_on', 'turn_off'], switch: ['toggle', 'turn_on', 'turn_off'], fan: ['toggle', 'turn_on', 'turn_off'], media_player: ['toggle', 'turn_on', 'turn_off', 'media_play_pause'], climate: ['turn_on', 'turn_off'], scene: ['turn_on'], cover: ['open_cover', 'close_cover'], lock: ['lock', 'unlock'] };
// These affect safety or security, so the AI always has to ask, whatever its other permissions say.
const SENSITIVE_DOMAINS = new Set(['lock', 'cover']);
const domainOf = id => String(id).split('.')[0];

function createSmartHome({ dataDir, safeStorage, getUrl, setUrl, fetchFn = (...args) => fetch(...args) }) {
  const secretPath = path.join(dataDir, 'smarthome-token.enc');
  async function readToken() {
    try { return (await safeStorage.decryptStringAsync(await fs.promises.readFile(secretPath))).result; } catch { return ''; }
  }
  async function request(url, token, route, options = {}) {
    let reply;
    try { reply = await fetchFn(`${url}${route}`, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000) }); }
    catch { throw new Error('Could not reach Home Assistant at that address. Check that it is running and on this network.'); }
    if (reply.status === 401 || reply.status === 403) throw new Error('Home Assistant rejected the access token.');
    if (!reply.ok) throw new Error(`Home Assistant answered with an error (${reply.status}).`);
    return reply.json();
  }
  async function connection() {
    const url = getUrl();
    const token = await readToken();
    if (!url || !token) throw new Error('Connect Home Assistant first, on the App Control page.');
    return { url, token };
  }
  async function connect({ url, token }) {
    const address = String(url || '').trim().replace(/\/+$/, '');
    const secret = String(token || '').trim();
    if (!/^https?:\/\/[^\s/]+/i.test(address)) return { ok: false, message: 'The address must start with http:// or https://, such as http://homeassistant.local:8123.' };
    if (!secret) return { ok: false, message: 'Enter a long-lived access token from your Home Assistant profile.' };
    if (!await safeStorage.isAsyncEncryptionAvailable()) return { ok: false, message: 'Windows secure storage is unavailable, so Nexus did not save the token.' };
    try { await request(address, secret, '/api/'); }
    catch (error) { return { ok: false, message: error.message }; }
    await fs.promises.mkdir(dataDir, { recursive: true });
    await fs.promises.writeFile(secretPath, await safeStorage.encryptStringAsync(secret), { mode: 0o600 });
    await setUrl(address);
    return { ok: true, message: 'Connected to Home Assistant.' };
  }
  async function disconnect() {
    await fs.promises.unlink(secretPath).catch(() => {});
    await setUrl('');
    return { ok: true };
  }
  async function status() { return { connected: Boolean(getUrl() && await readToken()), url: getUrl() }; }
  async function devices() {
    const { url, token } = await connection();
    const states = await request(url, token, '/api/states');
    return (Array.isArray(states) ? states : []).filter(item => CONTROLS[domainOf(item.entity_id)]).map(item => ({ id: item.entity_id, name: item.attributes?.friendly_name || item.entity_id, type: domainOf(item.entity_id), state: item.state, actions: CONTROLS[domainOf(item.entity_id)], sensitive: SENSITIVE_DOMAINS.has(domainOf(item.entity_id)) })).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  }
  async function control(id, action) {
    const device = String(id || '');
    const domain = domainOf(device);
    if (!/^[a-z_]+\.[a-z0-9_]+$/.test(device) || !CONTROLS[domain]) throw new Error('Nexus cannot control that device.');
    if (!CONTROLS[domain].includes(action)) throw new Error(`A ${domain} cannot do "${action}".`);
    const { url, token } = await connection();
    const service = action === 'toggle' && domain !== 'cover' ? 'homeassistant/toggle' : `${domain}/${action}`;
    await request(url, token, `/api/services/${service}`, { method: 'POST', body: JSON.stringify({ entity_id: device }) });
    return { ok: true, message: `Done: ${action.replace(/_/g, ' ')} ${device}.` };
  }
  // The AI hears a name like "bedroom light" rather than an id.
  async function findDevice(name) {
    const wanted = String(name || '').toLowerCase().trim();
    const all = await devices();
    return all.find(item => item.id === wanted || item.name.toLowerCase() === wanted) || all.find(item => item.name.toLowerCase().includes(wanted)) || all.find(item => wanted.split(/\s+/).every(word => item.name.toLowerCase().includes(word))) || null;
  }
  return { connect, disconnect, status, devices, control, findDevice };
}

module.exports = { createSmartHome, CONTROLS };
