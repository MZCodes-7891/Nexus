// Makes the commit that goes to GitHub: the current code without private sections, on top of what GitHub has,
// then checks it for private files and personal details. Run: node build/public-commit.js, then push the github-upload branch.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { privateIds } = require('../backend/core/sections');

const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const index = path.join(os.tmpdir(), `nexus-public-index-${process.pid}`);
const git = (args, env = {}) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } }).trim();

const hidden = privateIds(path.join(root, 'sections'));
git(['read-tree', 'HEAD'], { GIT_INDEX_FILE: index });
for (const id of hidden) git(['rm', '--cached', '-r', '-q', '--ignore-unmatch', `sections/${id}`], { GIT_INDEX_FILE: index });
const tree = git(['write-tree'], { GIT_INDEX_FILE: index });
fs.rmSync(index, { force: true });

const parent = git(['rev-parse', 'github-upload']);
const author = { GIT_AUTHOR_NAME: 'NEXUS', GIT_AUTHOR_EMAIL: 'nexus@users.noreply.github.com', GIT_COMMITTER_NAME: 'NEXUS', GIT_COMMITTER_EMAIL: 'nexus@users.noreply.github.com' };
if (git(['rev-parse', `${parent}^{tree}`]) === tree) { console.log('GitHub already has this code.'); process.exit(0); }
const message = process.argv[2] || `NEXUS ${version}`;
const commit = git(['commit-tree', tree, '-p', parent, '-m', `${message}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`], author);
git(['branch', '-f', 'github-upload', commit]);

const names = git(['ls-tree', '-r', '--name-only', 'github-upload']).split('\n');
const leaks = names.filter(name => hidden.some(id => name.startsWith(`sections/${id}/`)) || /TROUBLESHOOTING|\.enc$|(^|\/)\.env|dist(-mine)?\/|settings\.json$|conversations|phone-link|writing-style\.json/i.test(name));
// The owner's name and email come from this PC at run time, so they are never written into the published code.
const escape = text => String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ownerEmail = (() => { try { return git(['log', '-1', '--format=%ae', 'HEAD']); } catch { return ''; } })();
const own = [os.userInfo().username, ownerEmail.split('@')[0]].filter(item => item && item.length >= 3).map(escape);
const secrets = /gmail\.com|C:\\\\?Users|ghp_|gho_|ak_[A-Za-z0-9]{10}|discord(app)?\.com\/api\/webhooks|[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27,}/i;
const ownPattern = own.length ? new RegExp(own.join('|'), 'i') : null;
const pattern = { test: line => secrets.test(line) || Boolean(ownPattern && ownPattern.test(line)) };
const details = [];
for (const name of names) {
  if (name === 'package-lock.json' || /\.(png|ico|jpg)$/i.test(name)) continue;
  git(['show', `github-upload:${name}`]).split('\n').forEach((line, number) => { if (pattern.test(line) && !/secret path C:|const secrets = /.test(line)) details.push(`${name}:${number + 1}: ${line.trim().slice(0, 110)}`); });
}
console.log(`github-upload is now ${commit.slice(0, 7)}: ${names.length} files, private sections left out: ${hidden.join(', ') || 'none'}`);
console.log('private files:', leaks.length ? leaks : 'none');
console.log('personal details:', details.length ? details : 'none');
if (leaks.length || details.length) process.exit(2);
