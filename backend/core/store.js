const fs = require('fs');
const path = require('path');

// JSON file store: writes are serialized and atomic so a crash cannot leave a half-written data file.
class JsonStore {
  constructor(filePath, fallback) { this.filePath = filePath; this.fallback = fallback; this.queue = Promise.resolve(); this.cache = undefined; }
  clone(value) { return value === undefined ? value : JSON.parse(JSON.stringify(value)); }
  async read() {
    if (this.cache !== undefined) return this.clone(this.cache);
    try { this.cache = JSON.parse((await fs.promises.readFile(this.filePath, 'utf8')).replace(/^﻿/, '')); }
    catch (error) {
      // A corrupt file is kept aside rather than silently overwritten by the next save.
      if (error.code !== 'ENOENT') await fs.promises.rename(this.filePath, `${this.filePath}.corrupt-${Date.now()}`).catch(() => {});
      this.cache = this.clone(this.fallback);
    }
    return this.clone(this.cache);
  }
  write(value) {
    this.cache = this.clone(value);
    const data = JSON.stringify(value, null, 2);
    this.queue = this.queue.catch(() => {}).then(async () => {
      await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.${process.pid}.tmp`;
      await fs.promises.writeFile(temp, data, { mode: 0o600 });
      await fs.promises.rename(temp, this.filePath);
    });
    return this.queue;
  }
  async update(mutator) {
    const value = await this.read();
    const result = await mutator(value);
    await this.write(result === undefined ? value : result);
    return result === undefined ? value : result;
  }
  invalidate() { this.cache = undefined; }
}

// A store of records with string ids, which is what most Nexus features need.
class CollectionStore extends JsonStore {
  constructor(filePath) { super(filePath, []); }
  async list() { const value = await this.read(); return Array.isArray(value) ? value : []; }
  async get(id) { return (await this.list()).find(item => item.id === id) || null; }
  async upsert(item) { await this.update(items => { const index = items.findIndex(entry => entry.id === item.id); if (index >= 0) items[index] = item; else items.unshift(item); return items; }); return item; }
  async patch(id, changes) {
    let updated = null;
    await this.update(items => { const item = items.find(entry => entry.id === id); if (item) { Object.assign(item, changes, { updatedAt: new Date().toISOString() }); updated = this.clone(item); } return items; });
    return updated;
  }
  async remove(id) { let removed = false; await this.update(items => { const left = items.filter(entry => entry.id !== id); removed = left.length !== items.length; return left; }); return removed; }
}

module.exports = { JsonStore, CollectionStore };
