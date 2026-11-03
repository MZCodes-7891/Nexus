const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const INSTALLER_URL = 'https://ollama.com/download/OllamaSetup.exe';
const RECOMMENDED_MODEL = 'qwen2.5:latest';
const GB = 1024 ** 3;

// Only an installer really signed by Ollama is ever run.
function verifySignature(file) {
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$s=Get-AuthenticodeSignature -LiteralPath $env:NEXUS_SETUP_FILE; "$($s.Status)|$($s.SignerCertificate.Subject)"'], { windowsHide: true, timeout: 60000, env: { ...process.env, NEXUS_SETUP_FILE: file } }, (error, stdout) => {
      const [status, subject = ''] = String(stdout).trim().split('|');
      resolve({ ok: !error && status === 'Valid' && /CN=Ollama Inc\./.test(subject), status, subject });
    });
  });
}
async function freeSpace(folder) {
  try { const stats = await fs.promises.statfs(folder); return stats.bavail * stats.bsize; }
  catch { return Infinity; }
}

// First-run setup: everything a command line would otherwise be needed for.
function createSetup({ models, getSettings, updateSettings, send, env = process.env }) {
  let activeDownload = null;
  const base = () => String(getSettings().ai.baseUrl).replace(/\/+$/, '');
  const ollamaExe = () => path.join(env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe');
  const progress = (step, data) => send('setup:progress', { step, ...data });

  async function status() {
    const ai = await models.test();
    return {
      provider: getSettings().ai.provider,
      ollamaInstalled: fs.existsSync(ollamaExe()),
      serverRunning: ai.ok,
      model: getSettings().ai.model,
      modelInstalled: Boolean(ai.installed),
      installedModels: (ai.models || []).map(item => item.name),
      ready: Boolean(ai.ready),
      engineProblem: Boolean(ai.ok && ai.installed && !ai.ready),
      message: ai.message,
      recommendedModel: RECOMMENDED_MODEL,
      setupDone: getSettings().general.setupDone
    };
  }
  async function waitForServer(seconds = 60) {
    for (let index = 0; index < seconds / 2; index++) {
      try { const response = await fetch(`${base()}/api/version`, { signal: AbortSignal.timeout(2000) }); if (response.ok) return true; } catch {}
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    return false;
  }
  async function installOllama() {
    if (activeDownload) throw new Error('A download is already running.');
    const folder = path.join(os.tmpdir(), `nexus-setup-${crypto.randomUUID()}`);
    await fs.promises.mkdir(folder, { recursive: true });
    if (await freeSpace(folder) < 6 * GB) throw new Error('Installing the AI engine needs about 6 GB of free disk space. Free some up and try again.');
    const file = path.join(folder, 'OllamaSetup.exe');
    activeDownload = new AbortController();
    try {
      const response = await fetch(env.NEXUS_OLLAMA_INSTALLER_URL || INSTALLER_URL, { signal: activeDownload.signal });
      if (!response.ok) throw new Error(`The download failed (HTTP ${response.status}). Check your internet connection.`);
      const total = Number(response.headers.get('content-length')) || 0;
      let received = 0;
      const counted = Readable.fromWeb(response.body);
      counted.on('data', chunk => { received += chunk.length; progress('ollama', { phase: 'Downloading the AI engine', received, total }); });
      await pipeline(counted, fs.createWriteStream(file));
      progress('ollama', { phase: 'Checking the download' });
      const signature = await verifySignature(file);
      if (!signature.ok) throw new Error('The download was not signed by Ollama, so it was not run.');
      progress('ollama', { phase: 'Installing the AI engine' });
      const code = await new Promise((resolve, reject) => {
        const child = spawn(file, ['/SILENT', '/NORESTART', '/SUPPRESSMSGBOXES'], { windowsHide: true });
        child.on('error', reject);
        child.on('close', resolve);
      });
      if (code !== 0) throw new Error(`The installer stopped with code ${code}. Your disk may be full.`);
      if (!await waitForServer()) {
        spawn(path.join(path.dirname(ollamaExe()), 'ollama app.exe'), [], { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {});
        if (!await waitForServer()) throw new Error('The AI engine installed, but did not start. Restart your computer and open Nexus again.');
      }
      return { ok: true, message: 'The AI engine is installed.' };
    } catch (error) {
      if (error.name === 'AbortError') return { ok: false, canceled: true, message: 'Canceled.' };
      throw error;
    } finally {
      activeDownload = null;
      await fs.promises.rm(folder, { recursive: true, force: true }).catch(() => {});
    }
  }
  async function pullModel(name = RECOMMENDED_MODEL) {
    if (activeDownload) throw new Error('A download is already running.');
    const modelName = String(name || RECOMMENDED_MODEL).trim().slice(0, 100);
    if (!/^[\w.:/-]+$/.test(modelName)) throw new Error('That is not a valid model name.');
    activeDownload = new AbortController();
    try {
      const response = await fetch(`${base()}/api/pull`, { method: 'POST', body: JSON.stringify({ name: modelName, stream: true }), signal: activeDownload.signal });
      if (!response.ok) throw new Error(`Ollama could not start the download (HTTP ${response.status}).`);
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const part = JSON.parse(line);
          if (part.error) throw new Error(/space|disk/i.test(part.error) ? 'There is not enough disk space for this model.' : `Ollama reported: ${part.error}`);
          if (part.status === 'success') finished = true;
          progress('model', { phase: 'Downloading the AI model', status: part.status, received: part.completed || 0, total: part.total || 0 });
        }
      }
      if (!finished) throw new Error('The download ended early. Try again; it picks up where it stopped.');
      await updateSettings({ ai: { model: modelName } });
      return { ok: true, model: modelName, message: `${modelName} is ready.` };
    } catch (error) {
      if (error.name === 'AbortError') return { ok: false, canceled: true, message: 'Canceled. Starting again picks up where it stopped.' };
      throw error;
    } finally { activeDownload = null; }
  }
  return { status, installOllama, pullModel, cancel() { activeDownload?.abort(); return { ok: true }; }, finish: name => updateSettings({ general: { setupDone: true, ...(name !== undefined ? { userName: String(name).trim().slice(0, 60) } : {}) } }) };
}

module.exports = { createSetup, verifySignature, RECOMMENDED_MODEL };
