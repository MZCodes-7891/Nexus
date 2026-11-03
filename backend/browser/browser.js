const fs = require('fs');
const path = require('path');

function browserCandidates(env = process.env) {
  const pf = env.ProgramFiles || 'C:\\Program Files';
  const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = env.LOCALAPPDATA || '';
  return {
    chrome: [path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe')],
    edge: [path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe')],
    opera: [path.join(local, 'Programs', 'Opera GX', 'opera.exe'), path.join(pf, 'Opera GX', 'opera.exe'), path.join(pf86, 'Opera GX', 'opera.exe')],
    brave: [path.join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), path.join(local, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')]
  };
}
function detectBrowsers(env) { return Object.entries(browserCandidates(env)).flatMap(([id, list]) => { const exe = list.find(candidate => fs.existsSync(candidate)); return exe ? [{ id, path: exe }] : []; }); }

// A browser that has just started can keep interrupting its first tab with its own start page, sometimes for several seconds. Each retry uses the newest tab it has. Asking it for a new tab can hang, so that is avoided. Returns the tab that loaded.
async function gotoWithRetry(startPage, url, options) {
  let page = startPage;
  for (let attempt = 0; ; attempt++) {
    try { await page.goto(url, options); return page; }
    catch (error) {
      if (attempt >= 9 || !/ERR_ABORTED|interrupted by another navigation|has been closed/.test(error.message)) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000));
      page = page.context().pages().filter(item => !item.isClosed()).at(-1) || page;
    }
  }
}
// bringToFront can stall when a browser is still starting. Showing the window is not worth failing over.
function bringForward(page) { return Promise.race([page.bringToFront().catch(() => {}), new Promise(resolve => setTimeout(resolve, 5000))]); }

function checkedBrowserUrl(value) {
  let url;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(String(value || '')) ? String(value) : `https://${value}`); } catch { throw new Error('Enter a complete website address.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('NEXUS browser only opens http and https websites.');
  return url.href;
}

// Automation runs in Nexus's own browser profile, never the user's everyday one. Sign-ins are done by the user in the visible window.
function createBrowser({ dataDir, getPreferred, env = process.env, downloadsDir }) {
  const sessions = { hidden: null, visible: null };
  // Preferred browser first, then the rest, so one browser refusing to start doesn't stop the whole feature.
  function browserOrder() {
    const found = detectBrowsers(env);
    const preferred = getPreferred();
    // Opera GX first by default: Nexus's existing sign-ins live in its profile. Chrome can hang when automated, so it comes last.
    const rank = { opera: 0, edge: 1, brave: 2, chrome: 3 };
    return [...found.filter(item => item.id === preferred), ...found.filter(item => item.id !== preferred).sort((a, b) => rank[a.id] - rank[b.id])];
  }
  function executable() {
    const pick = browserOrder()[0];
    if (!pick) throw new Error('No supported browser was found. Install Chrome, Edge, Opera GX, or Brave.');
    return pick.path;
  }
  async function session(visible) {
    const key = visible ? 'visible' : 'hidden';
    const current = sessions[key];
    if (current && !current.page.isClosed()) return current;
    const { chromium } = require('playwright-core');
    executable();
    let context;
    let lastError;
    for (const { path: exe } of browserOrder()) {
      const suffix = /opera/i.test(exe) ? '' : `-${path.basename(exe, '.exe')}`;
      const profile = path.join(dataDir, `${visible ? 'NexusBrowserProfile' : 'NexusOperaResearchProfile'}${suffix}`);
      try {
        context = await chromium.launchPersistentContext(profile, {
          executablePath: exe, headless: !visible, timeout: 40000, acceptDownloads: true, viewport: visible ? null : { width: 1365, height: 900 },
          args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', ...(visible ? [] : ['--disable-background-networking'])]
        });
        break;
      } catch (error) { lastError = error; }
    }
    if (!context) throw new Error(`The browser could not be started: ${String(lastError?.message || '').split('\n')[0].slice(0, 200)}`);
    const entry = { context, page: context.pages()[0] || await context.newPage() };
    context.on('page', page => { entry.page = page; });
    context.on('close', () => { sessions[key] = null; });
    sessions[key] = entry;
    return entry;
  }
  // Visible wins when open: the page the user is looking at is the one requests refer to.
  async function currentPage() {
    if (sessions.visible && !sessions.visible.page.isClosed()) return sessions.visible;
    if (sessions.hidden && !sessions.hidden.page.isClosed()) return sessions.hidden;
    throw new Error('No browser page is open yet. Open a page first.');
  }
  async function open(url, visible = false) {
    const entry = await session(Boolean(visible));
    entry.page = await gotoWithRetry(entry.page, checkedBrowserUrl(url), { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (visible) await bringForward(entry.page);
    return { ok: true, title: await entry.page.title(), url: entry.page.url(), visible: Boolean(visible), message: `Opened ${entry.page.url()} in ${visible ? 'a visible Nexus browser window' : 'the hidden research session'}.` };
  }
  async function readPage() {
    const { page } = await currentPage();
    return { ok: true, title: await page.title(), url: page.url(), text: (await page.locator('body').innerText({ timeout: 15000 })).slice(0, 16000), links: (await page.locator('a[href]').evaluateAll(items => items.slice(0, 60).map(item => ({ text: (item.innerText || '').trim().slice(0, 80), href: item.href })).filter(item => item.text))) };
  }
  async function click(name) {
    const { page } = await currentPage();
    const label = String(name || '').slice(0, 180);
    await page.getByRole('button', { name: label }).or(page.getByRole('link', { name: label })).first().click({ timeout: 15000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    return { ok: true, title: await page.title(), url: page.url(), message: `Clicked "${label}".` };
  }
  async function fill(label, value) {
    const { page } = await currentPage();
    const input = page.getByLabel(String(label).slice(0, 180)).first();
    const attributes = await input.evaluate(element => ({ type: element.getAttribute('type') || '', autocomplete: element.getAttribute('autocomplete') || '', name: element.getAttribute('name') || '' })).catch(() => ({}));
    if (/password/i.test(attributes.type) || /password|cc-|one-time/i.test(attributes.autocomplete) || /pass|card|cvv|otp/i.test(attributes.name)) throw new Error('Nexus does not fill password, payment, or one-time-code fields. Enter those yourself in the browser window.');
    await input.fill(String(value).slice(0, 2000), { timeout: 15000 });
    return { ok: true, message: `Filled "${label}". Review the page before submitting.` };
  }
  async function download(url) {
    const { context, page } = await currentPage();
    const target = url ? checkedBrowserUrl(url) : page.url();
    const response = await context.request.get(target, { timeout: 60000 });
    if (!response.ok()) throw new Error(`The download failed with HTTP ${response.status()}.`);
    const body = await response.body();
    if (body.length > 200 * 1024 * 1024) throw new Error('The file is over the 200 MB limit.');
    await fs.promises.mkdir(downloadsDir, { recursive: true });
    const disposition = response.headers()['content-disposition'] || '';
    const name = (disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1] || path.basename(new URL(target).pathname) || 'download').replace(/[\\/:*?"<>|]/g, '_');
    let destination = path.join(downloadsDir, name);
    for (let index = 1; fs.existsSync(destination); index++) destination = path.join(downloadsDir, `${path.parse(name).name} (${index})${path.parse(name).ext}`);
    await fs.promises.writeFile(destination, body, { flag: 'wx' });
    return { ok: true, path: destination, size: body.length, message: `Downloaded to ${destination}` };
  }
  async function closeAll() { for (const key of Object.keys(sessions)) { await sessions[key]?.context.close().catch(() => {}); sessions[key] = null; } }
  return { order: () => browserOrder().map(item => item.path), open, readPage, click, fill, download, closeAll, executable, status: () => ({ open: Boolean(sessions.visible || sessions.hidden), url: (sessions.visible || sessions.hidden)?.page?.url?.() || '' }) };
}

module.exports = { gotoWithRetry, bringForward, createBrowser, detectBrowsers, checkedBrowserUrl };
