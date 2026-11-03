// Read-only live check of the real Composio account: lists accounts, reads a tool's schema and upcoming calendar events. Never prints the key.
// Run: node_modules\electron\dist\electron.exe tests\composio_live.js
const { app, safeStorage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const real = path.join(process.env.APPDATA, 'nexus');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-composio-'));
fs.copyFileSync(path.join(real, 'Local State'), path.join(temp, 'Local State'));
app.setPath('userData', temp);

app.whenReady().then(async () => {
  try {
    const key = (await safeStorage.decryptStringAsync(fs.readFileSync(path.join(real, 'composio-api-key.enc')))).result;
    const { Composio } = await import('@composio/core');
    const client = new Composio({ apiKey: key, allowTracking: false, logLevel: 'error' });
    for (const slug of ['GOOGLECALENDAR_CREATE_EVENT', 'GOOGLECALENDAR_DELETE_EVENT']) {
      const tool = await client.tools.getRawComposioToolBySlug(slug);
      const schema = tool.inputParameters || tool.input_parameters || {};
      console.log(slug, 'required:', JSON.stringify(schema.required), 'params:', Object.entries(schema.properties || {}).slice(0, 14).map(([name, value]) => `${name}:${value.type}`).join(', '));
    }
    const spotify = await client.toolkits.get('spotify').catch(() => null);
    console.log('spotify toolkit:', Boolean(spotify));
  } catch (error) { console.log('FAILED:', String(error.message || error).slice(0, 400)); }
  app.exit(0);
});
