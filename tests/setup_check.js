// Tests the first-run setup screen against a stand-in Ollama. Run: node tests/setup_check.js
const { _electron } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const results = [];
const record = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${String(detail).slice(0, 220)})` : ''}`); };
const state = { models: [], engineBroken: false };
const fake = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/api/version') return response.end('{"version":"test"}');
  if (request.url === '/api/tags') return response.end(JSON.stringify({ models: state.models.map(name => ({ name })) }));
  if (request.url === '/api/show') return response.end(JSON.stringify({ capabilities: ['completion', 'tools'] }));
  if (request.url === '/api/generate') { if (state.engineBroken) { response.statusCode = 500; return response.end(JSON.stringify({ error: 'error starting llama-server: llama-server binary not found' })); } return response.end('{"done":true}'); }
  if (request.url === '/api/pull') {
    response.write(JSON.stringify({ status: 'pulling', completed: 50, total: 100 }) + '\n');
    return setTimeout(() => { state.models.push('qwen2.5:latest'); response.end(JSON.stringify({ status: 'success' }) + '\n'); }, 300);
  }
  if (request.url === '/installer') { response.setHeader('Content-Type', 'application/octet-stream'); return response.end(Buffer.from('this is not a signed program')); }
  response.statusCode = 404; response.end('{}');
});
async function launch(settings, env = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-setup-test-'));
  fs.writeFileSync(path.join(temp, 'settings.json'), JSON.stringify(settings));
  const app = await _electron.launch({ executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), args: ['.'], cwd: root, env: { ...process.env, NEXUS_USER_DATA: temp, NEXUS_TEST: '1', LOCALAPPDATA: path.join(temp, 'none'), ...env } });
  const page = await app.firstWindow();
  await page.waitForFunction(() => typeof appSettings !== 'undefined' && appSettings && document.querySelector('.nav-btn.active'), null, { timeout: 30000 });
  return { app, page, temp };
}
const shown = page => page.waitForSelector('#setup-screen:not(.hidden) .setup-card', { timeout: 30000 });
(async () => {
  await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${fake.address().port}`;

  // Nothing installed, and Ollama isn't running
  let run = await launch({ ai: { baseUrl: 'http://127.0.0.1:9', autoStartOllama: false } }, { NEXUS_OLLAMA_INSTALLER_URL: `${url}/installer` });
  await shown(run.page);
  record('setup appears when no AI engine exists', (await run.page.textContent('.setup-card')).includes('Install the AI engine'));
  await run.page.click('.setup-card .action-btn-primary');
  await run.page.waitForFunction(() => /not signed by Ollama|about 6 GB/.test(document.querySelector('.setup-card .status-line').textContent), null, { timeout: 30000 });
  // On a nearly full disk the app rightly stops before downloading, so the signature check can't be reached.
  if (/about 6 GB/.test(await run.page.textContent('.setup-card .status-line'))) console.log('NOTE  this disk has under 6 GB free, so the app refused for space and the unsigned-installer check did not run');
  else record('an unsigned installer is refused, not run', true);
  await run.page.click('.setup-card .integration-button:not(.danger)');
  await run.page.waitForFunction(() => document.getElementById('setup-screen').classList.contains('hidden'));
  record('setup can be skipped', true);
  await run.app.close();

  // A damaged engine, like the real one found on this computer
  state.models = ['qwen2.5:latest']; state.engineBroken = true;
  run = await launch({ ai: { baseUrl: url, model: 'qwen2.5:latest' } });
  await shown(run.page);
  record('a damaged engine offers a repair', (await run.page.textContent('.setup-card')).includes('Repair the AI engine'), await run.page.textContent('.setup-steps'));
  await run.app.close();

  // Engine fine, model missing: the download runs in the app, then the app is ready
  state.models = []; state.engineBroken = false;
  run = await launch({ ai: { baseUrl: url, model: 'qwen2.5:latest' } });
  await shown(run.page);
  await run.page.fill('.setup-card input', 'Sam');
  record('a missing model offers a download', (await run.page.textContent('.setup-card')).includes('Download the AI model'));
  await run.page.click('.setup-card .action-btn-primary');
  await run.page.waitForFunction(() => /Start using Nexus/.test(document.querySelector('.setup-card').textContent), null, { timeout: 30000 });
  record('the model downloads with a button and setup finishes', true);
  await run.page.click('.setup-card .action-btn-primary');
  await run.page.waitForFunction(() => document.getElementById('setup-screen').classList.contains('hidden'));
  const saved = JSON.parse(fs.readFileSync(path.join(run.temp, 'settings.json'), 'utf8'));
  record('your name and the finished setup are saved', saved.general.setupDone === true && saved.general.userName === 'Sam');
  record('the app reports the AI as ready', (await run.page.evaluate(() => window.nexusBridge.invoke('ollama:test'))).ready === true);
  await run.app.close();

  // Already working: the screen must never appear
  run = await launch({ ai: { baseUrl: url, model: 'qwen2.5:latest' } });
  await run.page.waitForTimeout(4000);
  record('setup stays away when everything works', await run.page.evaluate(() => document.getElementById('setup-screen').classList.contains('hidden')));
  await run.app.close();
})().catch(error => record('test run finished', false, error.message.split('\n')[0])).finally(() => {
  fake.close();
  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
});
