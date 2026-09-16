/* ═══════════════════════════════════════════════════════════════
   读本部门配置，供 node 侧的生成脚本共用。

   浏览器那边由 看板.html 用两个 <script> 引入（bu-config.js → bu-config.local.js），
   这里用同一组文件，保证两边取到的是同一份值：
     assets/bu-config.js        中性占位，随仓库公开
     assets/bu-config.local.js  真实值，不入库（缺失时静默跳过，用占位值跑）
   ═══════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const win = {};
for (const f of ['bu-config.js', 'bu-config.local.js']) {
  const p = path.join(ROOT, 'assets', f);
  if (!fs.existsSync(p)) continue;
  /* 两个文件都是「给 window 赋值」的浏览器写法，这里造一个 window 再取值 */
  new Function('window', fs.readFileSync(p, 'utf8'))(win);
}
if (!win.BU) {
  console.error('读不到 assets/bu-config.js —— 这个文件必须存在（它是随仓库公开的中性占位）。');
  process.exit(1);
}
module.exports = win.BU;
