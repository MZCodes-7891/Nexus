const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { CollectionStore, JsonStore } = require('../core/store');
const { readDocument } = require('./reader');

const SUPPORTED = ['.pdf', '.doc', '.docx', '.pptx', '.xlsx', '.txt', '.md', '.csv', '.json', '.html', '.htm'];
const STOP_WORDS = new Set('the a an and or of to in is are was were be been it this that for on with as by at from not but what which who how why when where does do did can could should would about into their there these those has have had you your i we they he she'.split(' '));
const tokenize = text => (String(text).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []).filter(word => !STOP_WORDS.has(word));

// Splits on paragraphs and keeps the [PDF PAGE n] / [SLIDE n] label with each chunk so answers can cite where text came from.
function chunkText(text, size = 1100, overlap = 150) {
  const chunks = [];
  let label = '';
  let current = '';
  const flush = () => { if (current.trim()) chunks.push({ text: current.trim(), location: label }); current = current.slice(-overlap); };
  for (const block of String(text).split(/\n\s*\n|(?=\[(?:PDF PAGE|SLIDE|SHEET) )/)) {
    const marker = block.match(/^\[((?:PDF PAGE|SLIDE|SHEET) [^\]]+)\]/);
    if (marker) { flush(); current = ''; label = marker[1].replace('PDF PAGE', 'page').replace('SLIDE', 'slide').replace('SHEET', 'sheet'); }
    const body = marker ? block.slice(marker[0].length) : block;
    if (current.length + body.length > size) flush();
    if (body.length > size) { for (let start = 0; start < body.length; start += size - overlap) { current += body.slice(start, start + size); flush(); } }
    else current += `${current ? '\n' : ''}${body}`;
  }
  flush();
  return chunks;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// Local document library: extracted text and a search index stay on this computer. BM25 always works; embeddings add meaning-based search when a local embedding model is configured.
function createDocumentLibrary({ dataDir, rootDir, guard, embed, getEmbeddingModel, logger }) {
  const documents = new CollectionStore(path.join(dataDir, 'documents.json'));
  const textDir = path.join(dataDir, 'document-text');
  const indexStore = new JsonStore(path.join(dataDir, 'document-index.json'), { chunks: {} });

  const textPath = id => path.join(textDir, `${id}.txt`);
  async function extract(filePath) { return readDocument(rootDir, filePath, 4000000); }
  async function add(filePath, { folder = '', fromPicker = false } = {}) {
    // Files chosen in the system file picker are an explicit grant; paths from the agent stay inside allowed folders.
    const full = fromPicker ? path.resolve(filePath) : guard.resolve(filePath);
    const extension = path.extname(full).toLowerCase();
    if (!SUPPORTED.includes(extension)) throw new Error(`${extension || 'This file type'} is not supported yet.`);
    const stat = await fs.promises.stat(full);
    if (stat.size > 100 * 1024 * 1024) throw new Error('This file is over the 100 MB limit.');
    const id = crypto.createHash('sha256').update(full.toLowerCase()).digest('hex').slice(0, 24);
    const existing = await documents.get(id);
    if (existing && existing.modified === stat.mtime.toISOString()) return existing;
    const result = await extract(full);
    await fs.promises.mkdir(textDir, { recursive: true });
    await fs.promises.writeFile(textPath(id), result.text, { mode: 0o600 });
    const chunks = chunkText(result.text);
    const record = { id, path: full, name: path.basename(full), extension, folder: folder || existing?.folder || '', size: stat.size, modified: stat.mtime.toISOString(), addedAt: existing?.addedAt || new Date().toISOString(), lastOpenedAt: existing?.lastOpenedAt || '', favorite: Boolean(existing?.favorite), pages: result.pages || 0, blankPages: result.blankPages || [], ocrPages: result.ocrPages || [], truncated: Boolean(result.truncated), chars: result.text.length, chunks: chunks.length, embedded: false };
    await documents.upsert(record);
    await indexStore.update(index => { index.chunks[id] = chunks.map(chunk => ({ ...chunk, terms: termCounts(chunk.text) })); return index; });
    embedDocument(id).catch(error => logger?.warn(`embedding skipped: ${error.message}`));
    return record;
  }
  function termCounts(text) { const counts = {}; for (const word of tokenize(text)) counts[word] = (counts[word] || 0) + 1; return counts; }
  async function embedDocument(id) {
    const model = getEmbeddingModel();
    if (!model) return false;
    const index = await indexStore.read();
    const chunks = index.chunks[id] || [];
    for (let start = 0; start < chunks.length; start += 32) {
      const vectors = await embed(model, chunks.slice(start, start + 32).map(chunk => chunk.text.slice(0, 2000)));
      vectors.forEach((vector, offset) => { chunks[start + offset].vector = vector.map(value => Number(value.toFixed(5))); });
    }
    await indexStore.write(index);
    await documents.patch(id, { embedded: true });
    return true;
  }
  async function remove(id) {
    await documents.remove(id);
    await fs.promises.unlink(textPath(id)).catch(() => {});
    await indexStore.update(index => { delete index.chunks[id]; return index; });
    return true;
  }
  async function search(query, { ids = null, limit = 8 } = {}) {
    const index = await indexStore.read();
    const docs = new Map((await documents.list()).map(doc => [doc.id, doc]));
    const terms = [...new Set(tokenize(query))];
    const candidates = [];
    for (const [id, chunks] of Object.entries(index.chunks)) {
      if (!docs.has(id) || (ids && !ids.includes(id))) continue;
      chunks.forEach(chunk => candidates.push({ id, chunk }));
    }
    if (!candidates.length) return [];
    const total = candidates.length;
    const averageLength = candidates.reduce((sum, item) => sum + item.chunk.text.length, 0) / total;
    const frequency = {};
    for (const term of terms) frequency[term] = candidates.filter(item => item.chunk.terms[term]).length;
    let queryVector = null;
    const model = getEmbeddingModel();
    if (model && candidates.some(item => item.chunk.vector)) { try { queryVector = (await embed(model, [query]))[0]; } catch (error) { logger?.warn(`semantic search unavailable: ${error.message}`); } }
    const scored = candidates.map(({ id, chunk }) => {
      let score = 0;
      for (const term of terms) {
        const tf = chunk.terms[term] || 0;
        if (!tf) continue;
        const idf = Math.log(1 + (total - frequency[term] + 0.5) / (frequency[term] + 0.5));
        score += idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * chunk.text.length / averageLength));
      }
      const semantic = queryVector && chunk.vector ? cosine(queryVector, chunk.vector) : 0;
      return { id, name: docs.get(id).name, path: docs.get(id).path, location: chunk.location, text: chunk.text, score: score + semantic * 6 };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }
  async function readText(id, maxChars = 16000) {
    const text = await fs.promises.readFile(textPath(id), 'utf8');
    await documents.patch(id, { lastOpenedAt: new Date().toISOString() });
    return { text: text.slice(0, maxChars), truncated: text.length > maxChars, total: text.length };
  }
  // Only the passages that answer the question go to the model, labelled so it can cite them.
  async function retrieveContext(query, ids, limit = 10) {
    const hits = await search(query, { ids, limit });
    if (!hits.length) return ids?.length ? `Selected documents contained nothing matching this question. Selected: ${(await documents.list()).filter(doc => ids.includes(doc.id)).map(doc => doc.name).join(', ')}.` : '';
    return `Passages retrieved from the user's selected documents. Cite the file and location in brackets when you use a fact.\n\n${hits.map(hit => `[${hit.name}${hit.location ? `, ${hit.location}` : ''}]\n${hit.text}`).join('\n\n')}`;
  }
  async function patch(id, changes) { const clean = {}; if (changes.favorite !== undefined) clean.favorite = Boolean(changes.favorite); if (changes.folder !== undefined) clean.folder = String(changes.folder).slice(0, 80); if (changes.opened) clean.lastOpenedAt = new Date().toISOString(); return documents.patch(id, clean); }
  async function reindexAllEmbeddings() { let count = 0; for (const doc of await documents.list()) if (await embedDocument(doc.id)) count++; return count; }
  return { add, remove, list: () => documents.list(), get: id => documents.get(id), search, readText, retrieveContext, patch, extract, reindexAllEmbeddings, SUPPORTED };
}

module.exports = { createDocumentLibrary, chunkText, tokenize, cosine, SUPPORTED };
