// Leaves a note for the installed NEXUS to show and say: node build/tell-nexus.js "Title" "Details".
const fs = require('fs');
const path = require('path');
const folder = path.join(process.env.APPDATA, 'nexus', 'claude-notes');
fs.mkdirSync(folder, { recursive: true });
const [title = 'Claude is done', body = ''] = process.argv.slice(2);
fs.writeFileSync(path.join(folder, `${Date.now()}.json`), JSON.stringify({ title, body }));
console.log('note left for NEXUS:', title);
