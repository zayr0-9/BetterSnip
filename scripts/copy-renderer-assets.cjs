const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src', 'renderer');
const outDir = path.join(__dirname, '..', 'dist', 'renderer');
fs.mkdirSync(outDir, { recursive: true });

for (const name of fs.readdirSync(srcDir)) {
  if (!name.endsWith('.html')) continue;
  fs.copyFileSync(path.join(srcDir, name), path.join(outDir, name));
}
