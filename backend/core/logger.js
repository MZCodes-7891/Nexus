const fs = require('fs');
const path = require('path');

const SECRET_PATTERNS = [
  /\b(ak|sk|pk|rk)[-_][A-Za-z0-9_-]{8,}/g,
  /\b(bearer)\s+[A-Za-z0-9._~+/-]{8,}/gi,
  /((?:api[_-]?key|token|secret|password|passwd|authorization)["'\s]*[:=]\s*)["']?[^\s"',}]{4,}/gi
];

// Removes anything shaped like a credential so logs and error messages can never leak one.
function redact(value) {
  let text = typeof value === 'string' ? value : (() => { try { return JSON.stringify(value); } catch { return String(value); } })();
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, (match, first) => /^(ak|sk|pk|rk)$/i.test(first || '') ? '[redacted]' : `${/^bearer$/i.test(first || '') ? first : first || ''} [redacted]`);
  return text;
}

// Structured variant for tool arguments: secret-named keys are blanked and long values shortened for history views.
function redactDeep(value, depth = 0) {
  if (typeof value === 'string') return redact(value).slice(0, 1000);
  if (Array.isArray(value)) return depth > 4 ? [] : value.slice(0, 30).map(item => redactDeep(item, depth + 1));
  if (value && typeof value === 'object') {
    if (depth > 4) return {};
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /pass(word|wd)?|secret|token|api[_-]?key|authorization|cookie/i.test(key) ? '[redacted]' : redactDeep(item, depth + 1)]));
  }
  return value;
}

function createLogger({ logDir, isDebug = () => false, maxBytes = 2 * 1024 * 1024 }) {
  const file = path.join(logDir, 'nexus.log');
  let ready = false;
  function write(level, parts) {
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${parts.map(redact).join(' ')}\n`;
    try {
      if (!ready) { fs.mkdirSync(logDir, { recursive: true }); ready = true; }
      if (fs.existsSync(file) && fs.statSync(file).size > maxBytes) fs.renameSync(file, `${file}.1`);
      fs.appendFileSync(file, line, { mode: 0o600 });
    } catch {}
    if (level === 'error' || isDebug()) process.stdout.write?.(line);
  }
  return {
    file,
    info: (...parts) => write('info', parts),
    warn: (...parts) => write('warn', parts),
    error: (...parts) => write('error', parts),
    debug: (...parts) => { if (isDebug()) write('debug', parts); },
    async tail(lines = 300) { try { return (await fs.promises.readFile(file, 'utf8')).split(/\r?\n/).slice(-lines).join('\n'); } catch { return ''; } }
  };
}

module.exports = { redact, redactDeep, createLogger };
