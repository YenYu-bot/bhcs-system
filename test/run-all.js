// 跑全部測試：node test/run-all.js
const { spawnSync } = require('child_process'); const fs = require('fs'); const path = require('path');
const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', env: process.env });
  const out = (r.stdout + r.stderr).trim().split('\n');
  const okLine = out.find(l => /test OK|SKIPPED/.test(l)) || '';
  const status = r.status === 0 ? 'PASS' : 'FAIL';
  if (r.status !== 0) failed++;
  console.log(`${status}  ${f}  ${okLine.replace(/^• /, '')}`);
  if (r.status !== 0) console.log(out.slice(-12).map(l => '      ' + l).join('\n'));
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
