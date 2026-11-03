// Copies the bundled helper into the packaged app. A missing helper stops the build, because the app can't read documents or use voice without it.
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  const helper = path.join(process.env.LOCALAPPDATA || '', 'nexus-build', 'dist', 'nexus-helper');
  if (!fs.existsSync(path.join(helper, 'nexus-helper.exe'))) throw new Error(`The bundled helper was not found at ${helper}. Run npm run build:helper first.`);
  const target = path.join(context.appOutDir, 'resources', 'helper');
  await fs.promises.rm(target, { recursive: true, force: true });
  await fs.promises.cp(helper, target, { recursive: true });
};
