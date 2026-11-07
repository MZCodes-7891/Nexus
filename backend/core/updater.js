// Keeps installed copies up to date from the NEXUS releases on GitHub. A new version downloads in the background and installs the next time NEXUS closes, or right away if the person presses Restart.
const CHECK_EVERY_MS = 4 * 60 * 60000;

function createUpdater({ app, getSettings, notify, send, logger, ownerBuild = false, loadUpdater = () => require('electron-updater').autoUpdater }) {
  let updater = null;
  let state = { status: 'idle', message: '', version: '' };
  const set = changes => { state = { ...state, ...changes }; send?.('system:update-status', state); };
  const enabled = () => app.isPackaged && !ownerBuild && !process.env.NEXUS_TEST && getSettings().general.autoUpdate !== false;

  function load() {
    if (updater) return updater;
    updater = loadUpdater();
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    // The first NEXUS releases were marked as pre-releases on GitHub, so those count too.
    updater.allowPrerelease = true;
    updater.logger = { info: () => {}, warn: message => logger?.warn(`updater: ${message}`), error: message => logger?.warn(`updater: ${message}`), debug: () => {} };
    updater.on('checking-for-update', () => set({ status: 'checking', message: 'Checking for updates…' }));
    updater.on('update-not-available', () => set({ status: 'current', message: `You have the newest version (${app.getVersion()}).` }));
    updater.on('update-available', info => set({ status: 'downloading', version: info.version, message: `Downloading version ${info.version}…` }));
    updater.on('download-progress', progress => set({ status: 'downloading', message: `Downloading version ${state.version}: ${Math.round(progress.percent || 0)}%` }));
    updater.on('update-downloaded', info => {
      set({ status: 'ready', version: info.version, message: `Version ${info.version} is ready. It installs when NEXUS restarts.` });
      notify?.({ title: 'NEXUS update ready', body: `Version ${info.version} installs the next time NEXUS restarts. You can restart it now from Settings.` });
    });
    updater.on('error', error => set({ status: 'error', message: /404|latest\.yml|Cannot find/i.test(String(error?.message)) ? 'No update information was found in the NEXUS releases yet.' : /net::|ENOTFOUND|ETIMEDOUT|ECONNRESET/i.test(String(error?.message)) ? 'Nexus could not reach GitHub to check for updates.' : `The update check failed: ${String(error?.message || error).slice(0, 160)}` }));
    return updater;
  }

  async function check({ manual = false } = {}) {
    if (!app.isPackaged || process.env.NEXUS_TEST) return { ok: false, ...state, message: 'Updates only work in the installed NEXUS app.' };
    if (ownerBuild) return { ok: false, ...state, message: 'This is your own build, with your private sections, so it updates when Claude installs a new one rather than from GitHub.' };
    if (!manual && !enabled()) return { ok: false, ...state };
    try { await load().checkForUpdates(); return { ok: true, ...state }; }
    catch (error) { logger?.warn(`update check: ${error.message}`); return { ok: false, ...state }; }
  }
  function start() {
    if (!enabled()) return;
    setTimeout(() => check(), 30000);
    setInterval(() => check(), CHECK_EVERY_MS);
  }
  function restart() {
    if (state.status !== 'ready' || !updater) return { ok: false, message: 'No update is ready to install.' };
    // Silent install, then NEXUS opens again.
    setImmediate(() => updater.quitAndInstall(true, true));
    return { ok: true };
  }
  return { start, check, restart, status: () => ({ ...state, ...(ownerBuild && !state.message ? { message: `Version ${app.getVersion()}, your own build with private sections. It updates when Claude installs a new one, not from GitHub.` } : {}), current: app.getVersion(), enabled: enabled(), ownerBuild }) };
}

module.exports = { createUpdater };
