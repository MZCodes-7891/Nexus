const path = require('path');
const os = require('os');
const { redact } = require('./logger');

// Actions that can't be taken back, or that speak for the person to someone else, or open a door. These still ask when everything else doesn't.
const CRITICAL_ACTION = /(delete|remove|trash|purge|destroy|send_email|send_message|send_draft|reply|forward|invite|share|purchase|pay|transfer|unlock|open_cover)/i;
function isCritical(tool, args) {
  if (tool.critical) return true;
  if (tool.name === 'smarthome_control') return CRITICAL_ACTION.test(String(args?.action || ''));
  // Connected-app actions name what they do; several can run at once.
  if (tool.category === 'integrations' && !/^discord_/.test(tool.name)) {
    const inner = Array.isArray(args?.tools) ? args.tools.map(item => item?.tool_slug) : [tool.name];
    return inner.some(slug => CRITICAL_ACTION.test(String(slug || '')));
  }
  return false;
}

// Risk is a property of the tool, policy a property of the category. "sensitive" asks unless the person chose to be asked only about critical actions.
function decide({ risk = 'read', category = 'other' }, policies = {}, { askLess = false, critical = false } = {}) {
  const policy = policies[category] || 'ask';
  if (policy === 'block') return 'block';
  if (risk === 'read') return 'allow';
  if (askLess) return critical ? 'ask' : 'allow';
  if (risk === 'sensitive') return 'ask';
  if (risk === 'write') return policy === 'allow' ? 'allow' : 'ask';
  return 'allow';
}

function createPermissions({ getSettings, confirm, logger }) {
  async function authorize(tool, args) {
    const { privacy } = getSettings();
    const verdict = decide({ category: tool.category, risk: tool.riskFor ? tool.riskFor(args) : tool.risk }, privacy.permissions, { askLess: privacy.askBeforeActions === 'critical', critical: isCritical(tool, args) });
    if (verdict === 'allow') return { allowed: true };
    if (verdict === 'block') return { allowed: false, reason: `The ${tool.category} category is blocked in Settings → Privacy. Tell the user how to change this.` };
    const accepted = await confirm({
      title: 'Allow Nexus to do this?',
      message: tool.confirmMessage ? tool.confirmMessage(args) : `Nexus wants to run ${tool.name}.`,
      detail: redact(JSON.stringify(args ?? {}, null, 2)).slice(0, 2500)
    });
    logger?.info(`permission ${accepted ? 'granted' : 'denied'}: ${tool.name}`);
    return accepted ? { allowed: true } : { allowed: false, reason: 'The user declined this action. Do not retry it; say that it was not done.' };
  }
  return { authorize };
}

// Folder boundaries for AI-driven file access. The user can add folders in Settings; system folders and secret stores stay off limits.
function createFileGuard({ getSettings, dataDir, home = os.homedir(), env = process.env }) {
  const normalize = value => path.resolve(String(value || '')).replace(/[\\/]+$/, '').toLowerCase();
  const expand = value => String(value || '').replace(/^~(?=$|[\\/])/, home).replace(/%([^%]+)%/g, (all, name) => env[name] ?? all);
  function defaultRoots() {
    const roots = ['Documents', 'Desktop', 'Downloads', 'Pictures', 'Music', 'Videos'].map(name => path.join(home, name));
    for (const name of ['OneDrive', env.OneDrive && path.basename(env.OneDrive)].filter(Boolean)) roots.push(path.join(home, name));
    return roots;
  }
  function roots() { return [...defaultRoots(), ...getSettings().privacy.allowedFolders.filter(item => typeof item === 'string')]; }
  function deniedReason(target) {
    const full = normalize(target);
    const segments = full.split(/[\\/]/);
    if (full === normalize(dataDir) || full.startsWith(`${normalize(dataDir)}${path.sep}`)) return 'Nexus private data cannot be accessed through file tools.';
    if (segments.some(part => ['.ssh', '.gnupg', '.aws', '.azure', 'credentials'].includes(part))) return 'Credential folders cannot be accessed.';
    if (/(^|[\\/])(\.env(\..+)?|id_rsa|id_ed25519|.*\.(pem|key|pfx|kdbx))$/i.test(full)) return 'Files that hold secrets cannot be accessed.';
    return '';
  }
  function resolve(target) {
    const raw = expand(target).trim();
    if (!raw) throw new Error('A file or folder path is required.');
    const full = path.resolve(path.isAbsolute(raw) ? raw : path.join(home, raw));
    const reason = deniedReason(full);
    if (reason) throw new Error(reason);
    const allowed = roots().some(root => { const base = normalize(root); return normalize(full) === base || normalize(full).startsWith(`${base}${path.sep}`); });
    if (!allowed) throw new Error(`"${full}" is outside the folders Nexus may use. Add it in Settings → Privacy → Allowed folders.`);
    return full;
  }
  return { resolve, roots, expand };
}

module.exports = { decide, isCritical, createPermissions, createFileGuard };
