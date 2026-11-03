const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { CollectionStore } = require('../core/store');

const SEED_APPS = [
  { name: 'Google Chrome', type: 'exe', target: '', detect: 'chrome', icon: '🌐', category: 'Browsers', favorite: true },
  { name: 'Google Docs', type: 'url', target: 'https://docs.google.com', icon: '📄', category: 'School', favorite: true },
  { name: 'Google Slides', type: 'url', target: 'https://slides.google.com', icon: '📊', category: 'School', favorite: false },
  { name: 'D2L', type: 'url', target: '', detect: 'd2l', icon: '🎓', category: 'School', favorite: true },
  { name: 'Spotify', type: 'url', target: 'https://open.spotify.com', detect: 'spotify', icon: '🎵', category: 'Media', favorite: false },
  { name: 'YouTube', type: 'url', target: 'https://www.youtube.com', icon: '▶️', category: 'Media', favorite: false }
];

function chromeCandidates(env = process.env) {
  return [path.join(env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')];
}

function validateApp(input) {
  const name = String(input?.name || '').trim().slice(0, 60);
  if (!name) throw new Error('An application needs a name.');
  const type = input?.type === 'exe' ? 'exe' : 'url';
  const target = String(input?.target || '').trim();
  if (!target) throw new Error(type === 'url' ? 'Enter the website address.' : 'Choose the application file.');
  if (type === 'url') {
    let url;
    try { url = new URL(/^[a-z]+:/i.test(target) ? target : `https://${target}`); } catch { throw new Error('That website address is not valid.'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Website shortcuts must use http or https.');
    return { name, type, target: url.href };
  }
  if (!path.isAbsolute(target)) throw new Error('Use the full path to the application.');
  if (!/\.(exe|lnk|bat|cmd|appref-ms)$/i.test(target)) throw new Error('Choose an .exe or shortcut file.');
  return { name, type, target };
}

function createLauncher({ dataDir, openExternal, openPath, getSchoolUrl, env = process.env, emitChange = () => {} }) {
  const store = new CollectionStore(path.join(dataDir, 'apps.json'));
  const iconDir = path.join(dataDir, 'app-icons');
  let seeded = false;

  async function ensureSeeded() {
    if (seeded) return;
    seeded = true;
    if ((await store.read()).length || fs.existsSync(store.filePath)) return;
    const now = new Date().toISOString();
    await store.write(SEED_APPS.map((app, index) => ({ id: crypto.randomUUID(), name: app.name, type: app.type, target: app.target, detect: app.detect || '', icon: app.icon, iconPath: '', category: app.category, favorite: app.favorite, order: index, createdAt: now, lastOpenedAt: '', openCount: 0 })));
  }
  // Seeded apps with no fixed target resolve at launch, so a Chrome install or school link set later just works.
  async function resolveTarget(app) {
    if (app.target) return { type: app.type, target: app.target };
    if (app.detect === 'chrome') {
      const exe = chromeCandidates(env).find(candidate => fs.existsSync(candidate));
      if (exe) return { type: 'exe', target: exe };
      throw new Error('Google Chrome was not found on this computer. Edit this tile to point at its location.');
    }
    if (app.detect === 'd2l') {
      const url = await getSchoolUrl();
      if (url) return { type: 'url', target: url };
      throw new Error('Your D2L address is not set yet. Save your school link in the Study Center.');
    }
    throw new Error(`${app.name} has no target. Edit this tile to add one.`);
  }
  async function list() { await ensureSeeded(); return (await store.list()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)); }
  async function add(input) {
    const clean = validateApp(input);
    const apps = await list();
    if (apps.some(app => app.name.toLowerCase() === clean.name.toLowerCase())) throw new Error(`There is already an app named ${clean.name}.`);
    const app = { id: crypto.randomUUID(), ...clean, detect: '', icon: String(input.icon || (clean.type === 'url' ? '🔗' : '🖥️')).slice(0, 8), iconPath: '', category: String(input.category || 'Other').trim().slice(0, 30) || 'Other', favorite: Boolean(input.favorite), order: apps.length, createdAt: new Date().toISOString(), lastOpenedAt: '', openCount: 0 };
    if (input.iconFile) app.iconPath = await importIcon(input.iconFile, app.id);
    await store.write([...apps, app]);
    emitChange();
    return app;
  }
  async function update(id, input) {
    const apps = await list();
    const app = apps.find(item => item.id === id);
    if (!app) throw new Error('That application is no longer in the list.');
    if (input.name !== undefined || input.target !== undefined || input.type !== undefined) {
      const clean = validateApp({ name: input.name ?? app.name, type: input.type ?? app.type, target: input.target ?? app.target });
      if (apps.some(item => item.id !== id && item.name.toLowerCase() === clean.name.toLowerCase())) throw new Error(`There is already an app named ${clean.name}.`);
      Object.assign(app, clean, { detect: '' });
    }
    if (input.icon !== undefined) app.icon = String(input.icon).slice(0, 8);
    if (input.category !== undefined) app.category = String(input.category).trim().slice(0, 30) || 'Other';
    if (input.favorite !== undefined) app.favorite = Boolean(input.favorite);
    if (input.iconFile) app.iconPath = await importIcon(input.iconFile, app.id);
    if (input.clearIcon) app.iconPath = '';
    await store.write(apps);
    emitChange();
    return app;
  }
  async function remove(id) { await list(); const removed = await store.remove(id); emitChange(); return removed; }
  async function reorder(ids) {
    const apps = await list();
    const position = new Map(ids.map((id, index) => [id, index]));
    for (const app of apps) app.order = position.has(app.id) ? position.get(app.id) : apps.length;
    await store.write(apps);
    return list();
  }
  async function importIcon(file, id) {
    const extension = path.extname(String(file)).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.ico', '.svg', '.webp'].includes(extension)) throw new Error('Icons must be PNG, JPG, ICO, SVG, or WebP files.');
    if ((await fs.promises.stat(file)).size > 2 * 1024 * 1024) throw new Error('Icons must be under 2 MB.');
    await fs.promises.mkdir(iconDir, { recursive: true });
    const destination = path.join(iconDir, `${id}${extension}`);
    await fs.promises.copyFile(file, destination);
    return destination;
  }
  async function launch(id) {
    const app = (await list()).find(item => item.id === id);
    if (!app) throw new Error('That application is no longer in the list.');
    const { type, target } = await resolveTarget(app);
    if (type === 'url') await openExternal(target);
    else {
      if (!fs.existsSync(target)) throw new Error(`${target} no longer exists. Edit this tile to fix its location.`);
      const failure = await openPath(target);
      if (failure) throw new Error(failure);
    }
    await store.patch(id, { lastOpenedAt: new Date().toISOString(), openCount: (app.openCount || 0) + 1 });
    emitChange();
    return { ok: true, name: app.name, target, type, message: `Opened ${app.name}.` };
  }
  function bestMatch(apps, name) {
    const wanted = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!wanted) return null;
    const key = app => app.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return apps.find(app => key(app) === wanted) || apps.find(app => key(app).includes(wanted) || wanted.includes(key(app))) || null;
  }
  async function launchByName(name) {
    const app = bestMatch(await list(), name);
    if (app) return launch(app.id);
    const installed = bestMatch((await detectInstalled()).map(item => ({ ...item, name: item.name })), name);
    if (installed?.appId) {
      // Store apps have no shortcut file; Windows opens them by their app ID.
      if (!/^[\w.\-!{}]+$/.test(installed.appId)) return { ok: false, error: 'That app has an unusual ID, so Nexus did not open it.' };
      await new Promise((resolve, reject) => execFile('explorer.exe', [`shell:AppsFolder\\${installed.appId}`], { windowsHide: true }, error => (error && error.code !== 1 ? reject(error) : resolve())));
      return { ok: true, name: installed.name, type: 'store', message: `Opened ${installed.name}.` };
    }
    if (installed) {
      const failure = await openPath(installed.target);
      if (failure) throw new Error(failure);
      return { ok: true, name: installed.name, target: installed.target, type: 'exe', message: `Opened ${installed.name} from the Start menu.` };
    }
    return { ok: false, error: `No app called "${name}" was found in My Apps or the Start menu.` };
  }
  let installedCache = null;
  function storeApps() {
    if (process.platform !== 'win32' || env.NEXUS_TEST) return Promise.resolve([]);
    return new Promise(resolve => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-StartApps | Where-Object { $_.AppID -like "*!*" } | Select-Object Name, AppID | ConvertTo-Json -Compress'], { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve([]);
      try { const parsed = JSON.parse(stdout || '[]'); resolve((Array.isArray(parsed) ? parsed : [parsed]).filter(item => item?.Name && item?.AppID).map(item => ({ name: String(item.Name), appId: String(item.AppID) }))); }
      catch { resolve([]); }
    }));
  }
  // Installed apps come from Start Menu shortcuts: the same list Windows itself shows.
  async function detectInstalled(refresh = false) {
    if (installedCache && !refresh) return installedCache;
    const roots = [path.join(env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'), path.join(env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs')];
    const found = new Map();
    const walk = async (folder, depth) => {
      let entries = [];
      try { entries = await fs.promises.readdir(folder, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(folder, entry.name);
        if (entry.isDirectory() && depth < 3) await walk(full, depth + 1);
        else if (/\.lnk$/i.test(entry.name) && !/uninstall|readme|help|documentation|license|website/i.test(entry.name)) {
          const name = entry.name.replace(/\.lnk$/i, '');
          if (!found.has(name.toLowerCase())) found.set(name.toLowerCase(), { name, target: full, category: path.basename(folder) === 'Programs' ? 'Other' : path.basename(folder).slice(0, 30) });
        }
      }
    };
    for (const root of roots) await walk(root, 0);
    // Microsoft Store apps, such as WhatsApp, never appear as shortcuts. Windows lists them with an app ID instead.
    for (const app of await storeApps()) if (!found.has(app.name.toLowerCase())) found.set(app.name.toLowerCase(), { name: app.name, appId: app.appId, category: 'Store' });
    installedCache = Array.from(found.values()).sort((a, b) => a.name.localeCompare(b.name));
    return installedCache;
  }
  return { list, add, update, remove, reorder, launch, launchByName, detectInstalled, resolveTarget, bestMatch, chromeCandidates: () => chromeCandidates(env) };
}

module.exports = { createLauncher, validateApp, SEED_APPS };
