'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => { const target = path.join(dir, entry.name); return entry.isDirectory() ? files(target) : [target]; }); }
let checks = 0;
for (const dir of ['server', 'shared', 'miniprogram', 'dev', 'scripts', 'tests']) {
  for (const file of files(path.join(root, dir))) {
    if (file.endsWith('.js')) { const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' }); if (result.status !== 0) throw new Error(result.stderr); checks++; }
    if (file.endsWith('.json')) { JSON.parse(fs.readFileSync(file, 'utf8')); checks++; }
  }
}
for (const file of ['package.json', 'project.config.json']) { JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); checks++; }
const app = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'));
for (const page of app.pages) for (const extension of ['js', 'json', 'wxml', 'wxss']) { if (!fs.existsSync(path.join(root, 'miniprogram', `${page}.${extension}`))) throw new Error(`缺少小程序页面文件 ${page}.${extension}`); checks++; }
if (!fs.readFileSync(path.join(root, 'shared/presentation.js')).equals(fs.readFileSync(path.join(root, 'miniprogram/utils/presentation.js')))) throw new Error('共享展示模块不同步：请将 shared/presentation.js 复制到 miniprogram/utils/presentation.js');
console.log(`通过 ${checks + 1} 项静态检查：JS 语法、JSON 配置、页面完整性、共享资源同步。`);
