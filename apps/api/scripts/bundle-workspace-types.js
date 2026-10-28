const fs = require('fs');
const path = require('path');

const target = path.resolve('node_modules/@medlab/shared-types');
const source = path.resolve('../../packages/shared-types');

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.join(target, 'dist'), { recursive: true });
fs.copyFileSync(path.join(source, 'package.json'), path.join(target, 'package.json'));
fs.cpSync(path.join(source, 'dist'), path.join(target, 'dist'), { recursive: true });
