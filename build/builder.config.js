// Packaging settings. The release build leaves out private sections; the owner's own build has all of them,
// remembers where its source is so sections can be switched between public and private, and never updates from GitHub.
const path = require('path');
const pkg = require('../package.json');
const { privateIds } = require('../backend/core/sections');

const root = path.resolve(__dirname, '..');
const owner = process.env.NEXUS_OWNER_BUILD === '1';
const hidden = owner ? [] : privateIds(path.join(root, 'sections'));

module.exports = {
  ...pkg.build,
  files: [...pkg.build.files, 'sections/**', ...hidden.map(id => `!sections/${id}/**`)],
  ...(owner ? { directories: { ...pkg.build.directories, output: 'dist-mine' }, extraMetadata: { nexusOwner: true, nexusSource: root } } : {})
};
