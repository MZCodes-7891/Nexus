// Checks the built Windows app really runs, including the Python helpers it unpacks. Run after: npm run build
const { _electron } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');
// Python is hidden from the app, to prove the bundled helpers work on a computer without it.
const cleanEnv = { ...process.env, PATH: 'C:\\Windows\\System32;C:\\Windows', LOCALAPPDATA: path.join(os.tmpdir(), 'no-python-here') };
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-pack-'));
const doc = path.join(temp, 'sample.txt');
fs.writeFileSync(doc, 'Packaged builds can read documents.');
(async () => {
  const app = await _electron.launch({ executablePath: path.join(__dirname, '..', 'dist', 'win-unpacked', 'NEXUS.exe'), env: { ...cleanEnv, NEXUS_USER_DATA: temp, NEXUS_TEST: '1' } });
  const page = await app.firstWindow();
  await page.waitForFunction(() => typeof appSettings !== 'undefined' && appSettings && document.querySelector('.nav-btn.active'), null, { timeout: 30000 });
  console.log('title:', await page.title(), '| pages:', (await page.$$('.nav-btn')).length);
  const ai = await page.evaluate(() => window.nexusBridge.invoke('ollama:test'));
  console.log('AI:', ai.message);
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, doc);
  const added = await page.evaluate(() => window.nexusBridge.invoke('documents:add'));
  console.log('Python helper from package:', added.added?.[0]?.name || JSON.stringify(added));
  const voices = await page.evaluate(() => window.nexusBridge.invoke('voice:voices'));
  console.log('voices:', voices.voices?.length ?? voices.message);
  const devices = await page.evaluate(() => window.nexusBridge.invoke('voice:devices'));
  console.log('microphones:', devices.devices?.length ?? devices.message);
  const diagnostics = await page.evaluate(() => window.nexusBridge.invoke('system:diagnostics'));
  console.log('helpers:', JSON.stringify(diagnostics.pythonModules));
  // Reaching Composio's own "rejected" answer proves the SDK and everything it depends on were packaged.
  const key = await page.evaluate(() => window.nexusBridge.invoke('composio:save-key', 'not-a-real-key'));
  console.log('composio SDK loads:', /rejected/i.test(key.message), '|', String(key.message).slice(0, 70));
  const browser = await page.evaluate(() => window.nexusBridge.invoke('browser:open', 'https://example.com', false));
  console.log('browser:', browser.ok, browser.title || browser.message);
  await app.close();
})().catch(error => console.log('FAILED', error.message.split('\n')[0])).finally(() => { try { fs.rmSync(temp, { recursive: true, force: true }); } catch {} process.exit(0); });
