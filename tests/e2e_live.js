// Live tests for computer control, browser actions, automations, and multi-step requests, on a throwaway copy of the app's data.
// Run: node tests/e2e_live.js [name filter]. Briefly opens Notepad; skips that part if Notepad is already open.
const { _electron } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync, spawn } = require('child_process');

const root = path.join(__dirname, '..');
const realData = path.join(process.env.APPDATA, 'nexus');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-app-'));
// Kept apart from the app's data folder, which file tools rightly refuse to touch.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-home-'));
for (const name of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(home, name), { recursive: true });
for (const name of ['Local State', 'composio-api-key.enc', 'composio-user-id']) { const from = path.join(realData, name); if (fs.existsSync(from)) fs.cpSync(from, path.join(temp, name)); }
fs.writeFileSync(path.join(temp, 'settings.json'), JSON.stringify({ general: { setupDone: true } }));

const only = process.argv.slice(2);
const results = [];
const record = (name, ok, detail = '') => { results.push(Boolean(ok)); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${String(detail).replace(/\s+/g, ' ').slice(0, 260)})` : ''}`); };
const step = async (name, work) => { if (only.length && !only.some(item => name.toLowerCase().includes(item.toLowerCase()))) return; try { await work(); } catch (error) { record(name, false, error.message.split('\n').slice(0, 3).join(' / ')); } };
let electronApp, page;
const pageErrors = [];
async function launch(env = {}) {
  electronApp = await _electron.launch({ executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), args: ['.'], cwd: root, env: { ...process.env, NEXUS_USER_DATA: temp, NEXUS_TEST: '1', USERPROFILE: home, ...env } });
  page = await electronApp.firstWindow();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.waitForFunction(() => typeof appSettings !== 'undefined' && appSettings && document.querySelector('.nav-btn.active'), null, { timeout: 30000 });
  await electronApp.evaluate(({ shell, dialog }) => {
    globalThis.__opened = []; globalThis.__prompts = [];
    shell.openExternal = async url => { globalThis.__opened.push(url); };
    dialog.showMessageBox = async (_window, options) => { globalThis.__prompts.push(options.message); return { response: 1 }; };
  });
}
const invoke = (channel, ...args) => page.evaluate(([c, a]) => window.nexusBridge.invoke(c, ...a), [channel, args]);
const tool = (name, args = {}) => electronApp.evaluate(async (_electron, [toolName, toolArgs]) => {
  try { return await globalThis.__nexus.registry.get(toolName).handler(toolArgs, { logger: null }); }
  catch (error) { return { ok: false, thrown: true, error: error.message }; }
}, [name, args]);
async function ask(text) {
  await page.evaluate(() => { go('chat'); createProject(false); document.getElementById('spoken-response-toggle').checked = false; });
  await page.fill('#chat-input', text);
  await page.press('#chat-input', 'Enter');
  await page.waitForFunction(() => aiBusy, null, { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !aiBusy, null, { timeout: 280000 });
  return page.evaluate(() => { const message = currentProject().messages.at(-1); return { content: message?.content || '', actions: message?.actions || [] }; });
}
const run = reply => `${reply.actions.map(action => `${action.tool}:${action.ok ? 'ok' : 'fail'}`).join(',') || 'no tools'} | ${reply.content.slice(0, 120)}`;

function buildPdf(bodies) {
  const parts = ['%PDF-1.4\n'];
  let length = parts[0].length;
  const offsets = [];
  bodies.forEach((body, index) => {
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, 'latin1'), Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'), Buffer.from('\nendobj\n', 'latin1')]);
    offsets.push(length); parts.push(chunk); length += chunk.length;
  });
  const xref = `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n${offsets.map(at => `${String(at).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`;
  return Buffer.concat([...parts.map(part => (Buffer.isBuffer(part) ? part : Buffer.from(part, 'latin1'))), Buffer.from(xref, 'latin1')]);
}
function scannedPdf(sentence) {
  const jpg = path.join(temp, 'scan.jpg');
  const script = "Add-Type -AssemblyName System.Drawing;$b=New-Object Drawing.Bitmap 1700,500;$g=[Drawing.Graphics]::FromImage($b);$g.Clear([Drawing.Color]::White);$g.TextRenderingHint='AntiAlias';$f=New-Object Drawing.Font('Arial',44);$g.DrawString($env:NEXUS_TEXT,$f,[Drawing.Brushes]::Black,(New-Object Drawing.RectangleF(40,60,1620,400)));$b.Save($env:NEXUS_OUT,[Drawing.Imaging.ImageFormat]::Jpeg)";
  execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { env: { ...process.env, NEXUS_TEXT: sentence, NEXUS_OUT: jpg } });
  const data = fs.readFileSync(jpg);
  const image = Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1700 /Height 500 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]);
  const content = 'q 612 0 0 180 0 600 cm /Im0 Do Q';
  return buildPdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>', `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, image]);
}
function textPdf(text) {
  const stream = text.match(/[^.]+\./g).map((line, index) => `BT /F1 11 Tf 40 ${760 - index * 20} Td (${line.trim()}) Tj ET`).join('\n');
  return buildPdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']);
}

const READING = 'Biodiversity is the variety of life found in an ecosystem. Keystone species such as sea otters hold kelp forest ecosystems together. Invasive species like zebra mussels reduce biodiversity by outcompeting native organisms. Producers capture energy from sunlight and pass it to consumers through food webs.';
const siteLog = [];
const site = http.createServer((request, response) => {
  const url = request.url;
  if (url.startsWith('/d2l/api/versions')) { response.setHeader('Content-Type', 'application/json'); return response.end(JSON.stringify([{ ProductCode: 'lp', LatestVersion: '1.43' }, { ProductCode: 'le', LatestVersion: '1.74' }])); }
  if (url.includes('/enrollments/myenrollments')) { response.setHeader('Content-Type', 'application/json'); return response.end(JSON.stringify({ Items: [{ OrgUnit: { Id: 555, Name: 'Science 9', Code: 'SCI9' }, Access: { IsActive: true } }, { OrgUnit: { Id: 666, Name: 'Math 9', Code: 'MAT9' }, Access: { IsActive: true } }] })); }
  if (url.includes('/555/dropbox/folders')) { response.setHeader('Content-Type', 'application/json'); return response.end(JSON.stringify([{ Id: 1, Name: 'Biodiversity lab report', DueDate: new Date(Date.now() + 5 * 86400000).toISOString(), IsHidden: false }, { Id: 2, Name: 'Hidden draft', IsHidden: true }])); }
  if (url.includes('/666/dropbox/folders')) { response.statusCode = 403; return response.end('{}'); }
  if (/DirectFileTopicDownload$/.test(url)) { response.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="biodiversity.pdf"' }); return response.end(textPdf(READING)); }
  response.setHeader('Content-Type', 'text/html');
  if (/viewContent/.test(url)) return response.end('<title>Biodiversity Reading - Science 9</title><pre>Course Home\nContent\nPDF document</pre>');
  if (url === '/') return response.end('<title>Content - Science 9</title><a href="/d2l/le/content/555/viewContent/777/View">Biodiversity Reading</a>');
  if (url === '/form') return response.end('<title>Form</title><label for=n>Nickname</label><input id=n name=nick><label for=p>Password</label><input id=p type=password name=pw><button onclick="document.title=\'Sent \'+document.getElementById(\'n\').value">Submit</button><a href="/file.txt">Get file</a>');
  if (url === '/file.txt') { response.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename="notes.txt"' }); return response.end('downloaded text'); }
  siteLog.push(url); response.statusCode = 404; response.end('');
});
// An OpenAI-compatible endpoint that answers with a real streamed tool call, then text.
const seenAuth = [];
const endpoint = http.createServer((request, response) => {
  let body = '';
  request.on('data', chunk => { body += chunk; });
  request.on('end', () => {
    seenAuth.push(request.headers.authorization || '');
    if (request.url === '/v1/models') { response.setHeader('Content-Type', 'application/json'); return response.end(JSON.stringify({ data: [{ id: 'test-model' }] })); }
    const parsed = JSON.parse(body || '{}');
    response.setHeader('Content-Type', 'text/event-stream');
    const send = delta => response.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
    if ((parsed.messages || []).some(message => message.role === 'tool')) { send({ content: 'The task ' }); send({ content: 'was added.' }); }
    else if ((parsed.tools || []).length) { send({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'nexus_work_create_task', arguments: '{"title":"From the' } }] }); send({ tool_calls: [{ index: 0, function: { arguments: ' endpoint"}' } }] }); }
    else send({ content: 'Hello from the endpoint.' });
    response.end('data: [DONE]\n\n');
  });
});

(async () => {
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => endpoint.listen(0, '127.0.0.1', resolve));
  const siteUrl = `http://127.0.0.1:${site.address().port}`;
  const endpointUrl = `http://127.0.0.1:${endpoint.address().port}/v1`;
  await launch();

  await step('browser actions', async () => {
    const opened = await tool('browser_open', { url: `${siteUrl}/form` });
    record('browser opens a page', opened.ok === true, opened.error || opened.title);
    const filled = await tool('browser_fill', { label: 'Nickname', value: 'Sam' });
    record('browser fills a form field', filled.ok === true, filled.error || filled.message);
    const refused = await tool('browser_fill', { label: 'Password', value: 'hunter2' });
    record('browser refuses a password field', refused.ok === false && /does not fill/i.test(refused.error), refused.error);
    const clicked = await tool('browser_click', { name: 'Submit' });
    record('browser clicks a button, and the page reacts', clicked.ok === true && clicked.title === 'Sent Sam', clicked.title || clicked.error);
    const read = await tool('browser_read_page');
    record('browser reads links on the page', read.ok === true && read.links.some(link => /file\.txt/.test(link.href)), read.error);
    const downloaded = await tool('browser_download', { url: `${siteUrl}/file.txt` });
    record('browser downloads a file', downloaded.ok === true && fs.readFileSync(downloaded.path, 'utf8') === 'downloaded text', downloaded.error || downloaded.path);
    const again = await tool('browser_download', { url: `${siteUrl}/file.txt` });
    record('a second download does not overwrite', again.ok === true && again.path !== downloaded.path, again.path);
  });

  await step('computer control', async () => {
    const running = execFileSync('tasklist.exe', ['/FI', 'IMAGENAME eq notepad.exe', '/NH']).toString();
    if (/notepad\.exe/i.test(running)) { console.log('NOTE  Notepad is already open, so the live window tests were skipped to protect your work.'); return; }
    const first = spawn('notepad.exe', [], { detached: true });
    await page.waitForTimeout(2500);
    const list = await tool('computer_list_running');
    record('sees running apps', list.ok && list.apps.some(item => /notepad/i.test(item.name)), list.apps?.map(item => item.name).slice(0, 8).join(', '));
    const controls = await tool('computer_ui_list', { window: 'notepad' });
    record('reads another app\'s controls', controls.ok === true && controls.controls.length > 0, controls.error || controls.controls?.slice(0, 5).map(item => item.name).join(', '));
    const typed = await tool('computer_ui_type', { window: 'notepad', text: 'typed by nexus' });
    record('types into another app', typed.ok === true, typed.error || typed.message);
    const reread = await tool('computer_ui_list', { window: 'notepad' });
    record('the typed text is really there', JSON.stringify(reread.controls || []).includes('typed by nexus'));
    // Text is unsaved now, so this window is force-closed by the test itself, not by Nexus.
    try { execFileSync('taskkill.exe', ['/PID', String(first.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    await page.waitForTimeout(800);
    const second = spawn('notepad.exe', [], { detached: true });
    await page.waitForTimeout(2000);
    const click = await tool('computer_ui_click', { window: 'notepad', control: 'Close' });
    await page.waitForTimeout(1200);
    const closedByClick = !/notepad\.exe/i.test(execFileSync('tasklist.exe', ['/FI', 'IMAGENAME eq notepad.exe', '/NH']).toString());
    record('clicks a button in another app', click.ok === true && closedByClick, click.error || click.message);
    if (!closedByClick) { try { execFileSync('taskkill.exe', ['/PID', String(second.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }
    spawn('notepad.exe', [], { detached: true });
    await page.waitForTimeout(2000);
    const closed = await tool('computer_close_app', { name: 'notepad' });
    await page.waitForTimeout(1200);
    record('closes an app politely', closed.ok === true && !/notepad\.exe/i.test(execFileSync('tasklist.exe', ['/FI', 'IMAGENAME eq notepad.exe', '/NH']).toString()), closed.error || closed.message);
    try { execFileSync('taskkill.exe', ['/IM', 'notepad.exe', '/F'], { stdio: 'ignore' }); } catch {}
    if (!/Calculator/i.test(execFileSync('tasklist.exe').toString())) {
      spawn('calc.exe', [], { detached: true, stdio: 'ignore' });
      await page.waitForTimeout(4000);
      const modern = await tool('computer_ui_list', { window: 'Calculator' });
      record('reads a modern app\'s controls', modern.ok === true && modern.controls.some(item => /Close Calculator/.test(item.name)), modern.error || `${modern.controls?.length} controls`);
      const closeCalc = await tool('computer_ui_click', { window: 'Calculator', control: 'Close Calculator' });
      await page.waitForTimeout(1500);
      record('clicks a button in a modern app', closeCalc.ok === true && !/CalculatorApp/i.test(execFileSync('tasklist.exe').toString()), closeCalc.error || closeCalc.message);
      try { execFileSync('taskkill.exe', ['/IM', 'CalculatorApp.exe', '/F'], { stdio: 'ignore' }); } catch {}
    }
    const blocked = await tool('computer_close_app', { name: 'explorer' });
    record('refuses to close Windows system processes', blocked.ok === false && /system process/.test(blocked.error), blocked.error);
  });

  await step('scripts and files', async () => {
    const marker = path.join(temp, 'script-ran.txt');
    const script = path.join(temp, 'hello.ps1');
    fs.writeFileSync(script, `Set-Content -LiteralPath '${marker}' 'ran'; Write-Output 'hello from script'`);
    const unapproved = await tool('computer_run_script', { name: 'hello' });
    record('an unapproved script is refused', unapproved.ok === false && !fs.existsSync(marker), unapproved.error);
    await invoke('settings:update', { privacy: { approvedScripts: [{ name: 'hello', path: script }] } });
    const approved = await tool('computer_run_script', { name: 'hello' });
    record('an approved script runs', approved.ok === true && fs.existsSync(marker), approved.error || approved.output);
    const docs = path.join(home, 'Documents');
    fs.writeFileSync(path.join(docs, 'draft.txt'), 'x');
    record('renames a file', (await tool('files_rename', { path: path.join(docs, 'draft.txt'), newName: 'final.txt' })).ok === true && fs.existsSync(path.join(docs, 'final.txt')));
    record('moves a file', (await tool('files_move', { path: path.join(docs, 'final.txt'), folder: path.join(docs, 'Sorted') })).ok === true && fs.existsSync(path.join(docs, 'Sorted', 'final.txt')));
    const outside = await tool('files_read_text', { path: 'C:\\Windows\\win.ini' });
    record('file tools stay out of system folders', outside.ok === false && /outside/.test(outside.error), outside.error);
  });

  await step('scanned pdf', async () => {
    const file = path.join(home, 'Documents', 'scanned.pdf');
    fs.writeFileSync(file, scannedPdf('The mitochondria convert glucose into usable energy for the cell.'));
    const doc = await invoke('documents:add-path', file);
    const preview = doc.id ? await invoke('documents:preview', doc.id) : { text: '' };
    record('a scanned PDF is read with Windows text recognition', /mitochondria/i.test(preview.text) && doc.ocrPages?.length === 1, doc.message || preview.text);
    const answer = await invoke('documents:search', 'glucose energy');
    record('recognized text is searchable', answer.some(hit => hit.name === 'scanned.pdf'));
  });

  await step('apps and tray', async () => {
    await page.evaluate(() => go('apps'));
    await page.waitForFunction(() => document.querySelectorAll('#apps-grid .app-tile').length >= 6);
    const before = await page.$$eval('#apps-grid .app-name', items => items.map(item => item.textContent));
    await page.dragAndDrop('#apps-grid .app-tile:nth-child(6)', '#apps-grid .app-tile:nth-child(1)');
    await page.waitForTimeout(600);
    const after = await page.$$eval('#apps-grid .app-name', items => items.map(item => item.textContent));
    record('dragging rearranges tiles and is saved', after[0] === before[5] && (await invoke('apps:list'))[0].name === before[5], after.slice(0, 3).join(', '));
    const app = (await invoke('apps:list')).find(item => item.name === 'Spotify');
    await invoke('apps:update', app.id, { iconFile: path.join(root, 'build', 'icon.png') });
    await page.evaluate(() => refreshApps());
    await page.waitForFunction(() => { const image = document.querySelector('#apps-grid .app-tile[aria-label="Open Spotify"] img'); return image && image.complete && image.naturalWidth > 0; }, null, { timeout: 8000 });
    record('an ordinary image works as a custom app icon', true);
    await invoke('settings:update', { general: { closeToTray: true } });
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await page.waitForTimeout(600);
    const hidden = await electronApp.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; return window && !window.isVisible(); });
    record('closing keeps Nexus running in the tray when enabled', hidden === true);
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
    await invoke('settings:update', { general: { closeToTray: false } });
  });

  await step('backup', async () => {
    const backup = path.join(temp, 'backup.json');
    await electronApp.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, backup);
    await invoke('memory:remember', 'Backup test memory');
    const saved = await invoke('system:backup');
    const text = fs.readFileSync(backup, 'utf8');
    record('backup is created without keys', saved.ok === true && /Backup test memory/.test(text) && !/composio-api-key/.test(text), saved.message);
    await invoke('memory:remove', (await invoke('memory:list')).find(item => /Backup test/.test(item.text)).id);
    await electronApp.evaluate(({ app }) => { app.relaunch = () => { globalThis.__relaunched = true; }; app.exit = () => {}; });
    const restored = await invoke('system:restore');
    const memories = JSON.parse(fs.readFileSync(path.join(temp, 'nexus-memories.json'), 'utf8'));
    record('restore brings data back', restored.ok === true && memories.some(item => /Backup test/.test(item.text)) && await electronApp.evaluate(() => globalThis.__relaunched === true), restored.message);
    record('restore keeps a safety copy', fs.readdirSync(temp).some(name => name.startsWith('pre-restore-')));
    await electronApp.close();
    await launch();
  });

  await step('login item', async () => {
    await electronApp.close();
    await launch({ NEXUS_ALLOW_LOGIN_ITEM: '1' });
    await invoke('settings:update', { general: { launchAtLogin: true } });
    const on = await electronApp.evaluate(({ app }) => app.getLoginItemSettings().openAtLogin);
    await invoke('settings:update', { general: { launchAtLogin: false } });
    const off = await electronApp.evaluate(({ app }) => app.getLoginItemSettings().openAtLogin);
    record('start with Windows switches on and off', on === true && off === false);
    await electronApp.close();
    await launch();
  });

  await step('automations', async () => {
    const next = new Date(Date.now() + 75000);
    const time = `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`;
    await invoke('automations:create', { name: 'Timed', trigger: { type: 'schedule', time, days: [next.getDay()] }, steps: [{ tool: 'notify_user', args: { title: 'Timed automation ran', body: 'ok' } }] });
    await invoke('automations:create', { name: 'File science PDFs', trigger: { type: 'file_download', extensions: ['pdf'] }, conditions: [{ type: 'file_name_contains', text: 'science' }], steps: [{ tool: 'files_offer_filing', args: { file: '{{file}}', folder: 'School' } }] });
    await electronApp.close();
    await launch();
    const downloads = path.join(home, 'Downloads');
    fs.writeFileSync(path.join(downloads, 'math homework.pdf'), 'x');
    fs.writeFileSync(path.join(downloads, 'science notes.pdf'), 'x');
    await page.waitForFunction(() => true);
    for (let index = 0; index < 20 && !fs.existsSync(path.join(home, 'Documents', 'School', 'science notes.pdf')); index++) await page.waitForTimeout(500);
    record('a matching download triggers the automation and asks first', fs.existsSync(path.join(home, 'Documents', 'School', 'science notes.pdf')) && (await electronApp.evaluate(() => globalThis.__prompts)).some(message => /science notes/.test(message)));
    record('a condition filters out other downloads', fs.existsSync(path.join(downloads, 'math homework.pdf')));
    let ran = false;
    for (let index = 0; index < 45 && !ran; index++) { await page.waitForTimeout(3000); ran = (await invoke('notifications:list')).some(item => item.title === 'Timed automation ran'); }
    record('a scheduled automation fires on time inside the app', ran, time);
  });

  await step('wake phrase', async () => {
    await electronApp.close();
    const counter = path.join(temp, 'wake-count.txt');
    const script = path.join(temp, 'wake.js');
    fs.writeFileSync(script, `const fs=require('fs');const f=${JSON.stringify(counter)};const n=fs.existsSync(f)?Number(fs.readFileSync(f,'utf8')):0;fs.writeFileSync(f,String(n+1));setTimeout(()=>console.log(n===0?'just some background talking':'hey nexus what is two plus two'),200);`);
    await launch({ NEXUS_PYTHON: process.execPath, NEXUS_VOICE_SCRIPT: script });
    await page.evaluate(() => { go('chat'); createProject(false); document.getElementById('spoken-response-toggle').checked = false; setWakeWordListening(true); });
    await page.waitForFunction(() => [...document.querySelectorAll('#chat-box .user-msg')].some(item => /two plus two/.test(item.textContent)), null, { timeout: 30000 });
    const users = await page.$$eval('#chat-box .user-msg', items => items.map(item => item.textContent));
    record('the wake phrase triggers a request; other talk is ignored', users.length === 1 && !/hey nexus/i.test(users[0]) && !/background/.test(users.join()), users.join(' | '));
    await page.evaluate(() => setWakeWordListening(false));
    await page.waitForFunction(() => !aiBusy, null, { timeout: 120000 });
    await electronApp.close();
    // Hands-free: a misheard wake phrase still counts, and Nexus listens for a follow-up without it.
    const followCounter = path.join(temp, 'wake-follow-count.txt');
    const followScript = path.join(temp, 'wake-follow.js');
    fs.writeFileSync(followScript, `const fs=require('fs');const f=${JSON.stringify(followCounter)};const n=fs.existsSync(f)?Number(fs.readFileSync(f,'utf8')):0;fs.writeFileSync(f,String(n+1));fs.appendFileSync(f+'.args',JSON.stringify(process.argv.slice(2))+'\\n');setTimeout(()=>console.log(n===0?'hey Lexus what is two plus two':n===1?'and what is three plus three':'ERROR: No speech detected.'),200);`);
    await launch({ NEXUS_PYTHON: process.execPath, NEXUS_VOICE_SCRIPT: followScript });
    await page.evaluate(() => { go('chat'); createProject(false); document.getElementById('spoken-response-toggle').checked = false; setWakeWordListening(true); });
    await page.waitForFunction(() => [...document.querySelectorAll('#chat-box .user-msg')].some(item => /three plus three/.test(item.textContent)), null, { timeout: 90000 }).then(() => record('a misheard wake phrase works, and a follow-up needs no wake phrase', true), error => record('a misheard wake phrase works, and a follow-up needs no wake phrase', false, error.message.split('\n')[0]));
    const listened = fs.readFileSync(`${followCounter}.args`, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    record('the follow-up listens briefly, then goes back to waiting', listened[1]?.includes('--wait') && !listened[0]?.includes('--wait') && await page.evaluate(() => wakeWordActive && !document.getElementById('wake-pill').classList.contains('hidden')), JSON.stringify(listened.slice(0, 3)));
    await page.evaluate(() => setWakeWordListening(false));
    await page.waitForFunction(() => !aiBusy, null, { timeout: 120000 });
    await electronApp.close();
    const pauseCounter = path.join(temp, 'wake-pause-count.txt');
    const pauseScript = path.join(temp, 'wake-pause.js');
    fs.writeFileSync(pauseScript, `const fs=require('fs');const f=${JSON.stringify(pauseCounter)};const n=fs.existsSync(f)?Number(fs.readFileSync(f,'utf8')):0;fs.writeFileSync(f,String(n+1));setTimeout(()=>console.log(n===0?'hey nexus':n===1?'what is three plus three':'ERROR: No speech detected.'),200);`);
    await launch({ NEXUS_PYTHON: process.execPath, NEXUS_VOICE_SCRIPT: pauseScript });
    await page.evaluate(() => { go('chat'); createProject(false); document.getElementById('spoken-response-toggle').checked = false; setWakeWordListening(true); });
    await page.waitForFunction(() => [...document.querySelectorAll('#chat-box .user-msg')].some(item => /three plus three/.test(item.textContent)), null, { timeout: 30000 }).then(() => record('a request after a bare wake phrase is sent', true), error => record('a request after a bare wake phrase is sent', false, error.message));
    await page.evaluate(() => setWakeWordListening(false));
    await page.waitForFunction(() => !aiBusy, null, { timeout: 120000 });
    await electronApp.close();
    await launch();
  });

  await step('other provider', async () => {
    await invoke('settings:update', { ai: { provider: 'openai', openaiBaseUrl: endpointUrl, model: 'test-model' } });
    await invoke('settings:save-ai-key', 'sk-test-endpoint-key');
    const status = await invoke('ollama:test');
    record('an OpenAI-compatible endpoint connects', status.ready === true, status.message);
    const reply = await ask('Add a task for me.');
    record('streaming and tool calls work on that endpoint', reply.actions.some(action => action.tool === 'nexus_work_create_task' && action.ok) && reply.content === 'The task was added.' && (await invoke('tasks:list')).some(item => item.text === 'From the endpoint'), run(reply));
    record('the API key is sent to the endpoint', seenAuth.includes('Bearer sk-test-endpoint-key'));
    record('the API key is not stored in plain text', !JSON.stringify(fs.readFileSync(path.join(temp, 'settings.json'), 'utf8')).includes('sk-test-endpoint-key') && !(await invoke('settings:get')).settings.ai.apiKey);
    await invoke('settings:save-ai-key', '');
    await invoke('settings:update', { ai: { provider: 'ollama', model: 'qwen2.5:latest' } });
    await invoke('settings:update', { ai: { toolMode: 'json' } });
    const textMode = await ask('Set a reminder to water the plants tomorrow at 9 AM.');
    record('text-based tool calling works with the real model', (await invoke('reminders:list')).some(item => /plant/i.test(item.text)), run(textMode));
    await invoke('settings:update', { ai: { toolMode: 'auto' } });
  });

  await step('d2l chain', async () => {
    await electronApp.close();
    fs.writeFileSync(path.join(temp, 'd2l-settings.json'), JSON.stringify({ url: siteUrl }));
    await launch();
    const first = await ask('Open D2L, read the science course that opens there, then make me a study guide on biodiversity for Science.');
    const usedFirst = first.actions.filter(action => action.ok).map(action => action.tool);
    // A real school needs a sign-in here, so the AI may rightly stop and ask. The request must then finish once the user says they're in.
    let reply = first;
    if (!usedFirst.includes('study_create_guide')) {
      await page.fill('#chat-input', 'I am signed in and the Science course is open. Read it now and make the biodiversity study guide for Science.');
      await page.press('#chat-input', 'Enter');
      await page.waitForFunction(() => aiBusy, null, { timeout: 5000 }).catch(() => {});
      await page.waitForFunction(() => !aiBusy, null, { timeout: 280000 });
      const later = await page.evaluate(() => currentProject().messages.at(-1));
      reply = { ...first, content: later.content, actions: [...first.actions, ...(later.actions || later.toolCalls || [])] };
      console.log(`NOTE  the AI stopped after opening D2L; follow-up used ${JSON.stringify((later.actions || later.toolCalls || []).map(action => action.tool))}`);
    }
    const tools = reply.actions.filter(action => action.ok).map(action => action.tool);
    const guides = await invoke('study:guides');
    record('multi-step request: D2L to study guide', ['school_open_d2l', 'school_read_open_course', 'study_create_guide'].every(name => tools.includes(name)) && guides.some(guide => /keystone|otter|biodiversity/i.test(guide.content)), run(reply));
    const sources = await invoke('study:d2l-sources', '');
    record('D2L material is sorted by course', sources.some(item => item.course === 'Science 9' && item.usable), sources.map(item => `${item.title}=${item.course}`).join('; '));
    const courses = await invoke('school:courses');
    record('courses are listed from D2L\'s own API', courses.ok === true && courses.courses.length === 2, courses.error || courses.courses?.map(item => item.name).join(', '));
    const imported = await invoke('school:import-assignments');
    record('assignments import, skipping hidden ones, and report a course that failed', imported.ok === true && imported.added === 1 && imported.failedCourses.includes('Math 9'), imported.message);
    const events = await invoke('calendar:list', {});
    record('due dates appear on the calendar', events.some(event => event.title === 'Biodiversity lab report' && event.kind === 'assignment'));
    const twice = await invoke('school:import-assignments');
    record('importing again adds no duplicates', twice.added === 0);
    await page.evaluate(() => { go('school'); openStudyTab('assignments'); });
    await page.waitForFunction(() => /Biodiversity lab report/.test(document.getElementById('study-tab-assignments').textContent));
    record('the Assignments tab shows them', true);
  });

  await step('research chain', async () => {
    const reply = await ask('Research what photosynthesis is on the web, then create a PowerPoint presentation about it with 3 slides using what you found.');
    const folder = path.join(home, 'Documents', 'Nexus');
    const made = fs.existsSync(folder) && fs.readdirSync(folder).some(name => name.endsWith('.pptx'));
    record('multi-step request: research to presentation', reply.actions.some(action => /research_report|web_search|web_read_page/.test(action.tool) && action.ok) && made, run(reply));
    const spotify = await ask('Find my Study Beats playlist on Spotify.');
    const opened = await electronApp.evaluate(() => globalThis.__opened);
    record('Spotify opens at the playlist search', opened.some(url => /open\.spotify\.com\/search\/Study/i.test(url)), run(spotify));
  });

  record('no uncaught errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  await electronApp.close();
})().catch(error => record('test run completed', false, error.message.split('\n')[0])).finally(() => {
  site.close(); endpoint.close();
  try { fs.rmSync(temp, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); } catch {}
  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
});
