const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// The installed app carries its helpers as one bundled program; running from source uses Python directly.
function bundledHelper() {
  if (process.env.NEXUS_PYTHON || !process.resourcesPath) return '';
  const helper = path.join(process.resourcesPath, 'helper', 'nexus-helper.exe');
  return fs.existsSync(helper) ? helper : '';
}

// One place that decides which Python runs Nexus's helper scripts. Previously voice and PDF reading could use different interpreters.
function resolvePython(env = process.env) {
  if (env.NEXUS_PYTHON) return env.NEXUS_PYTHON;
  const local = env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Python', 'bin', 'python.exe');
  if (local && fs.existsSync(local)) return local;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function helperCommand(rootDir, script, args) {
  const helper = bundledHelper();
  if (helper && !path.isAbsolute(script)) return { file: helper, args: [script, ...args.map(String)] };
  return { file: resolvePython(), args: [path.isAbsolute(script) ? script : path.join(rootDir, script), ...args.map(String)] };
}
const helperEnv = () => ({ ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' });

function runPythonJson(rootDir, script, args = [], { timeout = 120000, maxBuffer = 32 * 1024 * 1024 } = {}) {
  const command = helperCommand(rootDir, script, args);
  return new Promise((resolve, reject) => {
    execFile(command.file, command.args, { windowsHide: true, timeout, maxBuffer, env: helperEnv() }, (error, stdout, stderr) => {
      let result;
      try { result = JSON.parse(String(stdout || '').trim().split(/\r?\n/).at(-1) || '{}'); }
      catch { return reject(new Error(error?.code === 'ENOENT' ? 'Python was not found. Install Python 3 or set NEXUS_PYTHON.' : String(stderr || error?.message || 'The helper returned unreadable output.').slice(0, 500))); }
      if (result.error) return reject(new Error(result.error));
      if (error) return reject(new Error(String(stderr || error.message).slice(0, 500)));
      resolve(result);
    });
  });
}

function spawnPython(rootDir, script, args = []) {
  const command = helperCommand(rootDir, script, args);
  return spawn(command.file, command.args, { windowsHide: true, env: helperEnv() });
}

// What the Diagnostics page reports, whichever way the helpers are provided.
function checkHelpers(rootDir) {
  const helper = bundledHelper();
  const command = helper ? { file: helper, args: ['--check'] } : { file: resolvePython(), args: [path.join(rootDir, 'nexus_helper.py'), '--check'] };
  return new Promise(resolve => {
    execFile(command.file, command.args, { windowsHide: true, timeout: 30000, env: helperEnv() }, (error, stdout) => {
      try { resolve({ bundled: Boolean(helper), ...JSON.parse(String(stdout).trim().split(/\r?\n/).at(-1)) }); }
      catch { resolve({ bundled: Boolean(helper), error: error?.message || 'The helpers could not be run.' }); }
    });
  });
}

module.exports = { resolvePython, runPythonJson, spawnPython, checkHelpers, bundledHelper };
