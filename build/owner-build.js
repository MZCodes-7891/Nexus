// Builds the owner's own copy of NEXUS into dist-mine/, with every section, public or private.
const { spawnSync } = require('child_process');
const path = require('path');
const cli = path.join(__dirname, '..', 'node_modules', 'electron-builder', 'cli.js');
const result = spawnSync(process.execPath, [cli, '--config', 'build/builder.config.js', '--publish', 'never'], { cwd: path.join(__dirname, '..'), stdio: 'inherit', env: { ...process.env, NEXUS_OWNER_BUILD: '1' } });
process.exit(result.status ?? 1);
