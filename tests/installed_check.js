// Opens the installed app with the real data and reports what it finds. Run after installing.
const { _electron } = require('playwright-core');
const path = require('path');
(async () => {
  const app = await _electron.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'Programs', 'NEXUS', 'NEXUS.exe') });
  const page = await app.firstWindow();
  await page.waitForFunction(() => typeof appSettings !== 'undefined' && appSettings && document.querySelector('.nav-btn.active'), null, { timeout: 40000 });
  await page.waitForFunction(() => !/Checking/.test(document.getElementById('status-ai-text').textContent), null, { timeout: 200000 });
  await page.waitForTimeout(6000);
  const invoke = (channel, ...args) => page.evaluate(([c, a]) => window.nexusBridge.invoke(c, ...a), [channel, args]);
  console.log('data folder:', await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData')));
  console.log('AI:', await page.textContent('#status-ai-text'), '| apps:', await page.textContent('#status-apps-text'));
  console.log('setup screen hidden:', await page.evaluate(() => document.getElementById('setup-screen').classList.contains('hidden')));
  console.log('conversations:', await page.evaluate(() => nexusProjects.length), '| helpers:', JSON.stringify((await invoke('system:diagnostics')).pythonModules));
  console.log('D2L items:', (await invoke('study:d2l-sources', '')).length);
  const status = await invoke('composio:status');
  console.log('composio:', JSON.stringify(status).slice(0, 400));
  if (status.verified) { const catalog = await invoke('composio:catalog'); console.log('catalog:', catalog.apps.length, 'apps,', catalog.accounts.filter(item => item.status === 'ACTIVE').length, 'active'); }
  const browser = await invoke('browser:open', 'https://example.com', false);
  console.log('browser:', browser.ok, browser.title || browser.message);
  const reply = await invoke('voice:voices');
  console.log('voices:', reply.voices?.length ?? reply.message);
  await app.close();
})().catch(error => console.log('FAILED', error.message.split('\n')[0])).finally(() => process.exit(0));
