const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'dist', 'renderer');
for (const name of fs.readdirSync(dir)) {
  if (!name.endsWith('.js')) continue;
  const file = path.join(dir, name);
  let s = fs.readFileSync(file, 'utf8');
  s = s.replace(/^"use strict";\r?\nObject\.defineProperty\(exports, "__esModule", \{ value: true \}\);\r?\n/, '"use strict";\n');
  s = s.replace(/^Object\.defineProperty\(exports, "__esModule", \{ value: true \}\);\r?\n/, '');
  fs.writeFileSync(file, s);
}
