const fs = require('fs');
const path = require('path');

// Sections are self-contained pages in sections/<id>/. Each one says in section.json whether it is public.
// Private sections stay out of GitHub and out of the release installer, and only the owner's own build has them.
const VALID_ID = /^[a-z][a-z0-9-]{1,30}$/;

function readSection(folder) {
  const id = path.basename(folder);
  if (!VALID_ID.test(id)) return null;
  try {
    const info = JSON.parse(fs.readFileSync(path.join(folder, 'section.json'), 'utf8'));
    return {
      id,
      title: String(info.title || id).slice(0, 40),
      description: String(info.description || '').slice(0, 200),
      icon: Array.isArray(info.icon) ? info.icon.map(String).slice(0, 8) : [],
      public: info.public === true,
      page: fs.existsSync(path.join(folder, 'page.js')),
      style: fs.existsSync(path.join(folder, 'style.css')),
      backend: fs.existsSync(path.join(folder, 'backend.js'))
    };
  } catch { return null; }
}

function listSections(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => readSection(path.join(dir, entry.name))).filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
}

// The ids of sections that must not be published, for the public commit and the release build.
const privateIds = dir => listSections(dir).filter(section => !section.public).map(section => section.id);

function createSections({ dir, sourceDir, handle, context, logger }) {
  const loaded = [];
  const hooks = [];
  for (const section of listSections(dir)) {
    if (section.backend) {
      try {
        // Each section's handlers are named section:<id>:<name>, so sections can't clash with the app or each other.
        const scopedHandle = (name, handler) => handle(`section:${section.id}:${name}`, handler);
        const api = require(path.join(dir, section.id, 'backend.js'))({ ...context, handle: scopedHandle, folder: path.join(context.dataDir, 'sections', section.id) });
        if (api && (api.briefing || api.whatNow || api.dayBlocks)) hooks.push(api);
      } catch (error) { logger?.warn(`section ${section.id} could not load: ${error.message}`); continue; }
    }
    loaded.push(section);
  }
  // Switching public or private changes the section's source, so it only works where the source is: in development, or in the owner's own build.
  const editable = Boolean(sourceDir && fs.existsSync(path.join(sourceDir, 'sections')));
  function setPublic(id, value) {
    if (!editable) return { ok: false, message: 'Only your own copy of NEXUS, built from your project folder, can change this.' };
    if (!VALID_ID.test(String(id))) return { ok: false, message: 'Unknown section.' };
    const file = path.join(sourceDir, 'sections', id, 'section.json');
    if (!fs.existsSync(file)) return { ok: false, message: 'That section is not in your project folder.' };
    const info = JSON.parse(fs.readFileSync(file, 'utf8'));
    info.public = Boolean(value);
    fs.writeFileSync(file, `${JSON.stringify(info, null, 2)}\n`);
    const entry = loaded.find(item => item.id === id);
    if (entry) entry.public = Boolean(value);
    return { ok: true, message: value ? 'Public: it goes to GitHub and into the release with the next update.' : 'Private: it stays on your PC and out of GitHub and the release.' };
  }
  const collect = async (name, ...args) => (await Promise.all(hooks.filter(api => api[name]).map(api => api[name](...args).catch(() => [])))).flat();
  return { list: () => ({ sections: loaded, editable }), setPublic, briefing: () => collect('briefing'), whatNow: () => collect('whatNow'), dayBlocks: date => collect('dayBlocks', date) };
}

module.exports = { createSections, listSections, privateIds };
