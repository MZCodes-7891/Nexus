const fs = require('fs');
const path = require('path');

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json', '.html', '.htm', '.log', '.xml', '.yaml', '.yml', '.ini', '.tsv']);
const SKIP_FOLDERS = new Set(['node_modules', '.git', '__pycache__', 'appdata', '$recycle.bin', 'system volume information']);
const ORGANIZE_GROUPS = { Documents: ['.pdf', '.doc', '.docx', '.txt', '.md', '.rtf', '.odt'], Presentations: ['.ppt', '.pptx', '.key', '.odp'], Spreadsheets: ['.xls', '.xlsx', '.csv', '.ods'], Images: ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.heic'], Videos: ['.mp4', '.mov', '.avi', '.mkv', '.webm'], Audio: ['.mp3', '.wav', '.flac', '.m4a', '.ogg'], Archives: ['.zip', '.rar', '.7z', '.tar', '.gz'], Installers: ['.exe', '.msi'] };

function describe(full, stat) { return { path: full, name: path.basename(full), isFolder: stat.isDirectory(), size: stat.size, modified: stat.mtime.toISOString() }; }

// File operations for the agent and UI. Read and write are separate functions, and nothing here overwrites or deletes.
function createFiles({ guard }) {
  async function list(folder) {
    const full = guard.resolve(folder);
    const entries = await fs.promises.readdir(full, { withFileTypes: true });
    const items = [];
    for (const entry of entries.slice(0, 400)) {
      if (entry.name.startsWith('.') || entry.name === 'desktop.ini') continue;
      try { items.push(describe(path.join(full, entry.name), await fs.promises.stat(path.join(full, entry.name)))); } catch {}
    }
    return items.sort((a, b) => Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name));
  }
  // Bounded walk across allowed folders; it reports when limits cut the search short rather than implying the results are complete.
  async function find({ query = '', extensions = [], folder = '', modifiedWithinDays = 0, limit = 50, signal } = {}) {
    const started = Date.now();
    const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    const wantedExt = (Array.isArray(extensions) ? extensions : [extensions]).filter(Boolean).map(item => `.${String(item).replace(/^\./, '').toLowerCase()}`);
    const cutoff = modifiedWithinDays ? Date.now() - Number(modifiedWithinDays) * 86400000 : 0;
    const roots = folder ? [guard.resolve(folder)] : guard.roots().filter(root => fs.existsSync(root));
    const results = [];
    const seen = new Set();
    let visited = 0;
    let truncated = false;
    const queue = [...roots];
    while (queue.length) {
      if (signal?.aborted || visited > 60000 || Date.now() - started > 25000) { truncated = true; break; }
      const current = queue.shift();
      const key = current.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      let entries = [];
      try { entries = await fs.promises.readdir(current, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        visited++;
        if (entry.name.startsWith('.') || entry.name.startsWith('~$')) continue;
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) { if (!SKIP_FOLDERS.has(entry.name.toLowerCase())) queue.push(full); continue; }
        const name = entry.name.toLowerCase();
        if (wantedExt.length && !wantedExt.includes(path.extname(name))) continue;
        if (terms.length && !terms.every(term => name.includes(term))) continue;
        let stat;
        try { stat = await fs.promises.stat(full); } catch { continue; }
        if (cutoff && stat.mtimeMs < cutoff) continue;
        results.push(describe(full, stat));
      }
    }
    results.sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
    return { results: results.slice(0, limit), total: results.length, truncated, searchedFolders: roots };
  }
  async function readText(target, maxChars = 12000) {
    const full = guard.resolve(target);
    if (!TEXT_EXTENSIONS.has(path.extname(full).toLowerCase())) throw new Error('Use documents_read for PDF, Word, PowerPoint, and Excel files.');
    const stat = await fs.promises.stat(full);
    if (stat.size > 20 * 1024 * 1024) throw new Error('This text file is over the 20 MB limit.');
    const text = await fs.promises.readFile(full, 'utf8');
    return { path: full, text: text.slice(0, maxChars), truncated: text.length > maxChars };
  }
  async function createFolder(target) {
    const full = guard.resolve(target);
    if (fs.existsSync(full)) return { ok: true, path: full, existed: true, message: `The folder already exists: ${full}` };
    await fs.promises.mkdir(full, { recursive: true });
    return { ok: true, path: full, message: `Created folder ${full}` };
  }
  function assertFree(destination) { if (fs.existsSync(destination)) throw new Error(`Nothing was changed because "${destination}" already exists.`); }
  async function rename(target, newName) {
    const full = guard.resolve(target);
    if (/[\\/:*?"<>|]/.test(String(newName)) || !String(newName).trim()) throw new Error('The new name contains characters Windows does not allow.');
    const destination = guard.resolve(path.join(path.dirname(full), String(newName).trim()));
    assertFree(destination);
    await fs.promises.rename(full, destination);
    return { ok: true, from: full, to: destination, message: `Renamed to ${path.basename(destination)}` };
  }
  async function move(target, folder) {
    const full = guard.resolve(target);
    const destinationFolder = guard.resolve(folder);
    await fs.promises.mkdir(destinationFolder, { recursive: true });
    const destination = path.join(destinationFolder, path.basename(full));
    assertFree(destination);
    try { await fs.promises.rename(full, destination); }
    catch (error) {
      if (error.code !== 'EXDEV') throw error;
      await fs.promises.copyFile(full, destination, fs.constants.COPYFILE_EXCL);
      await fs.promises.unlink(full);
    }
    return { ok: true, from: full, to: destination, message: `Moved ${path.basename(full)} to ${destinationFolder}` };
  }
  async function writeNewText(target, content) {
    const full = guard.resolve(target);
    assertFree(full);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, String(content), { flag: 'wx' });
    return { ok: true, path: full, message: `Saved ${full}` };
  }
  // Organizing is two-step on purpose: a preview the user can read, then an apply that only runs what was previewed.
  async function organizePreview(folder) {
    const full = guard.resolve(folder);
    const items = (await list(full)).filter(item => !item.isFolder);
    const moves = [];
    for (const item of items) {
      const extension = path.extname(item.name).toLowerCase();
      const group = Object.entries(ORGANIZE_GROUPS).find(([, list]) => list.includes(extension))?.[0];
      if (group) moves.push({ file: item.path, name: item.name, toFolder: path.join(full, group) });
    }
    return { folder: full, moves, skipped: items.length - moves.length };
  }
  async function organizeApply(moves) {
    const done = [];
    const failed = [];
    for (const item of Array.isArray(moves) ? moves.slice(0, 500) : []) {
      try { await move(item.file, item.toFolder); done.push(item.file); }
      catch (error) { failed.push({ file: item.file, error: error.message }); }
    }
    return { ok: failed.length === 0, moved: done.length, failed, message: `Moved ${done.length} file(s)${failed.length ? `; ${failed.length} could not be moved` : ''}.` };
  }
  return { list, find, readText, createFolder, rename, move, writeNewText, organizePreview, organizeApply };
}

module.exports = { createFiles, ORGANIZE_GROUPS };
