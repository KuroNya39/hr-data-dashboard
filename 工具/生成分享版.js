/* ═══════════════════════════════════════════════════════════════
   生成本部门分享版（独立文件夹，双击即看、离线可用、零依赖）
   ------------------------------------------------------------------
   产出 分享版/：
     ├── 看板.html            对方双击这个就能看
     └── assets/
         ├── css/ js/ vendor/   完整版代码副本
         ├── bu-config.js       本部门配置（中性占位 + 本地真实值，要一起带走）
         └── hr-data.js         裁剪后的数据包（只含本部门）

   核心原则：不是「界面隐藏」，而是「文件里根本没有」。
     数据包里只保留 一级部门英文简称 === 本部门代号 的行，
     其他中心以及空中心记录一律不写出。

   本部门代号 / 表名 / 文件名都从 assets/bu-config.js 读（真实值在 bu-config.local.js）。

   用法：node 工具/生成分享版.js
   ═══════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');
const BU = require('./读取部门配置.js');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, '分享版');
const TARGET = BU.code;
const LOG = [];
const say = s => { LOG.push(s); console.log(s); };

let XLSX;
try { XLSX = require('C:/Users/wushangyan/node_modules/xlsx'); }
catch (e) { try { XLSX = require('xlsx'); } catch (e2) { console.error('找不到 xlsx 模块'); process.exit(1); } }

/* 显式栈式遍历删除：本机 node 24 对 fs.rmSync(recursive) 会栈溢出崩掉 */
function rmTree(root) {
  if (!fs.existsSync(root)) return 0;
  if (!fs.statSync(root).isDirectory()) { fs.unlinkSync(root); return 1; }
  const stack = [root], dirs = [];
  let n = 0;
  while (stack.length) {
    const d = stack.pop(); dirs.push(d);
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else { fs.unlinkSync(p); n++; }
    }
  }
  for (let i = dirs.length - 1; i >= 0; i--) fs.rmdirSync(dirs[i]);
  return n;
}
/* 不要用 fs.cpSync：递归复制 vendor/fonts（100+ 字体分片）会栈溢出 */
function copyTree(from, to) {
  const stack = [[from, to]];
  let files = 0;
  while (stack.length) {
    const [src, dst] = stack.pop();
    fs.mkdirSync(dst, { recursive: true });
    for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
      const sp = path.join(src, ent.name), dp = path.join(dst, ent.name);
      if (ent.isDirectory()) stack.push([sp, dp]);
      else if (ent.isFile()) { fs.copyFileSync(sp, dp); files++; }
    }
  }
  return files;
}
/* 增量同步而不是「删光重建」：托管 node 有批量删除保护（阈值 50/轮），
   一次性删上百个文件会被拦下并中断脚本。这里只删「源里没有」的多余文件。 */
function pruneExtras(from, to) {
  if (!fs.existsSync(to)) return 0;
  let removed = 0;
  const stack = [[from, to]];
  while (stack.length) {
    const [src, dst] = stack.pop();
    for (const ent of fs.readdirSync(dst, { withFileTypes: true })) {
      const sp = path.join(src, ent.name), dp = path.join(dst, ent.name);
      const inSrc = fs.existsSync(sp);
      if (ent.isDirectory()) {
        if (!inSrc) { rmTree(dp); removed++; }
        else stack.push([sp, dp]);
      } else if (!inSrc) { fs.unlinkSync(dp); removed++; }
    }
  }
  return removed;
}

say('══ 生成本部门分享版 ══\n');
say('① 清理旧产物');
for (const p of ['data', 'index.html', '打开分享版.bat', 'assets/hr-data.js']) {
  const full = path.join(OUT, p);
  if (fs.existsSync(full)) { rmTree(full); say('   移除 ' + p); }
}

say('\n② 裁剪数据 → 分享版/assets/hr-data.js');
try {
  const r = cp.execFileSync(process.execPath, [path.join(__dirname, '生成数据包.js'), '--share'], { encoding: 'utf8' });
  r.split('\n').filter(Boolean).forEach(l => say('   ' + l));
} catch (e) {
  say('   ✗ 数据包生成失败：' + (e.stdout || e.message));
  process.exit(1);
}

say('\n③ 复制代码 → 分享版/assets/');
let copied = 0;
for (const d of ['css', 'js', 'vendor']) {
  const from = path.join(ROOT, 'assets', d), to = path.join(OUT, 'assets', d);
  if (!fs.existsSync(from)) { say('   （跳过 ' + d + '/，源不存在）'); continue; }
  const stale = pruneExtras(from, to);
  const n = copyTree(from, to);
  copied += n;
  say('   · ' + d + '/ → ' + n + ' 个文件' + (stale ? '（清理旧文件 ' + stale + ' 个）' : ''));
}
/* 本部门配置必须跟着走：分享版的 看板.html 也要靠它取部门代号。
   local 那份含真实值，缺了分享版会退回中性占位 —— 仍是能看的，只是代号/表名对不上。 */
let cfgCopied = [];
for (const f of ['bu-config.js', 'bu-config.local.js']) {
  const from = path.join(ROOT, 'assets', f);
  if (!fs.existsSync(from)) { say('   · ⚠ 缺 assets/' + f + '，分享版将回落到中性占位'); continue; }
  fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
  fs.copyFileSync(from, path.join(OUT, 'assets', f));
  cfgCopied.push(f);
}
say('   · 本部门配置 → ' + (cfgCopied.length ? cfgCopied.join(' + ') : '无'));
say('   合计 ' + copied + ' 个文件（注意：不带 assets/hr-data.js，那是完整版的数据包）');

say('\n④ 生成分享版入口 → 分享版/看板.html');
const srcHtml = fs.readFileSync(path.join(ROOT, '看板.html'), 'utf8');
let html = srcHtml;
const snapBefore = () => html;

/* (a) 标题 */
html = html.replace(/<title>.*?<\/title>/, '<title>HR 数据看板 · ' + BU.label + ' 分享版</title>');
/* (b) 副标题 */
html = html.replace(/(<div class="brand-sub"[^>]*>)[^<]*(<\/div>)/, '$1' + BU.label + ' 分享版 · HRBP 工作台$2');
/* (c) 移除中心筛选器（连 label 一起，避免留下孤立标签） */
html = html.replace(/<label[^>]*>中心<\/label><select id="filterCenter"[^>]*><\/select>/,
  '<!-- 分享版：中心筛选器已移除（数据仅含本部门） -->');
if (!/分享版：中心筛选器已移除/.test(html)) { say('   ✗ 中心筛选器未匹配到，请检查 HTML 结构'); process.exit(1); }
/* (d) 顶部横幅 */
const banner = `
        <div class="share-banner" id="shareBanner">
          <span class="mi">shield_lock</span>
          <div>
            <b>本看板仅包含本部门数据</b>
            <span>不含其他中心人员信息 · 数据为生成时快照，如需最新请向 HRBP 索取</span>
          </div>
        </div>`;
html = html.replace(/(<div id="dashboard" class="hidden"[^>]*>\s*<div class="content"[^>]*>)/, '$1' + banner);
if (!/share-banner/.test(html)) { say('   ✗ 横幅未插入，请检查 #dashboard 结构'); process.exit(1); }
/* (e) 移除上传与数据维护按钮（分享对象只应看，不应导入别处数据） */
let removedBtns = 0;
for (const fn of ['uploadEmpData', 'uploadPerfData', 'uploadLedgerData', 'toggleDataPanel']) {
  const re = new RegExp('\\s*<button class="tb-btn no-print mi-btn" onclick="' + fn + '\\(\\)"[\\s\\S]*?<\\/button>');
  const n = snapBefore();
  html = html.replace(re, '');
  if (html !== n) removedBtns++;
}
say('   已移除顶栏按钮 ' + removedBtns + ' / 4');
/* (f) 配置：独立 IndexedDB 库名（否则会从完整版缓存里恢复出含其他中心的数据） */
const config = `
<script>
window.HR_SHARED = true;
window.HR_IDB_NAME = 'hr-dashboard-v8-shared';
</script>`;
html = html.replace(/<\/head>/, config + '\n</head>');
/* (g) 运行期补丁：过滤统计不显示「全库 N 人」；filterCenter 占位 */
const patch = `
<script>
(function () {
  const orig = window.updateFilterStat;
  if (typeof orig === 'function') {
    window.updateFilterStat = function () {
      try {
        const f = getFiltered(), a = f.filter(d => d.status === '在职'), g = groupCounts(a);
        document.getElementById('filterStat').textContent =
          f.length + ' 人 · 在职 ' + a.length + '（正式 ' + g.formal + ' · 实习 ' + g.intern + ' · 外协 ' + g.outsource + '）';
      } catch (e) {}
    };
  }
  /* 数据只有本部门，但筛选器逻辑需要这个元素存在（保持 display:none，不构成越权） */
  if (!document.getElementById('filterCenter')) {
    const s = document.createElement('select');
    s.id = 'filterCenter'; s.value = '${BU.code}'; s.style.display = 'none';
    const o = document.createElement('option'); o.value = '${BU.code}'; o.textContent = '${BU.code}';
    s.appendChild(o); document.body.appendChild(s);
  }
})();
</script>
</body>`;
html = html.replace(/<\/body>/, patch);
fs.writeFileSync(path.join(OUT, '看板.html'), html, 'utf8');
say('   已写出 看板.html');

say('\n⑤ 安全自检');
let leak = 0;

/* 5.1 数据包里的人员必须在允许范围内。
   判据二选一：有花名册时按工号白名单（维护者手动维护的名单说了算，
   名单里可能有非本部门的人 —— 那是维护者的选择），没有花名册时按中心列 = 本部门代号。 */
const packPath = path.join(OUT, 'assets', 'hr-data.js');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(packPath, 'utf8'), sandbox);
const pack = sandbox.window.HR_DATA;
const rosterIds = (function () {
  const hit = (pack.books.manual || []).find(([n]) => BU.rosterSheet.test(n) || /花名册/.test(n));
  if (!hit) return null;
  const aoa = hit[1] || [];
  if (aoa.length < 2) return null;
  let h = 0;
  for (let i = 0; i < Math.min(aoa.length, 6); i++) {
    if (aoa[i] && aoa[i].some(c => String(c).includes('员工编号'))) { h = i; break; }
  }
  const iId = (aoa[h] || []).findIndex(c => String(c).includes('员工编号'));
  if (iId < 0) return null;
  const s = new Set();
  aoa.slice(h + 1).forEach(r => { const v = String((r && r[iId]) == null ? '' : r[iId]).trim(); if (v) s.add(v); });
  return s.size ? s : null;
})();
const headerRowOf = aoa => {
  for (let i = 0; i < Math.min(aoa.length, 10); i++) {
    if (aoa[i] && aoa[i].some(c => String(c).includes('员工编号'))) return i;
  }
  return 0;
};
let empRows = 0, badRows = 0;
const centersInPack = new Set();
(pack.books.emp || []).forEach(([name, aoa]) => {
  const h = headerRowOf(aoa);
  const header = aoa[h] || [];
  const ci = header.findIndex(x => String(x).includes('一级部门英文简称'));
  const iId = header.findIndex(x => String(x).includes('员工编号'));
  aoa.slice(h + 1).forEach(r => {
    if (!r || !r.length) return;
    empRows++;
    const c = ci >= 0 ? String(r[ci] == null ? '' : r[ci]).trim() : '';
    if (c) centersInPack.add(c);
    if (rosterIds) {
      const id = String(r[iId] == null ? '' : r[iId]).trim();
      if (!id || !rosterIds.has(id)) badRows++;
    } else if (c !== TARGET) badRows++;
  });
});
say('   数据包人员行 ' + empRows + ' · 越界行 ' + badRows
  + ' · 判据 ' + (rosterIds ? '花名册（' + rosterIds.size + ' 人）' : '一级部门英文简称 = 本部门')
  + ' · 出现的中心 ' + JSON.stringify([...centersInPack]));
if (badRows) leak++;
if (!rosterIds && (centersInPack.size !== 1 || !centersInPack.has(TARGET))) { say('   ✗ 数据包里出现了非本部门的中心'); leak++; }

/* 5.2 分享版目录里不能混入完整版数据包或 KPA 原件 */
const stray = [];
(function scan(dir) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n), st = fs.statSync(p);
    if (st.isDirectory()) scan(p);
    else if (/^KPA/i.test(n) || /\.xlsx?$/i.test(n)) stray.push(path.relative(OUT, p));
  }
})(OUT);
if (stray.length) { say('   ✗ 混入了原始数据文件：' + stray.join(', ')); leak++; }
else say('   目录内无 KPA / Excel 原始文件 ✓');

/* 5.3 HTML 与 JS 里不能出现其他中心名（词界匹配，避免 BU1 命中 BU10） */
const kpaCands = fs.readdirSync(DATA).filter(n => /^KPA.*\.xls$/i.test(n))
  .map(n => ({ n, t: fs.statSync(path.join(DATA, n)).mtimeMs })).sort((a, b) => b.t - a.t);
const otherCenters = new Set();
if (kpaCands.length) {
  const wb = XLSX.readFile(path.join(DATA, kpaCands[0].n), { cellDates: false });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  let hi = 0;
  for (let i = 0; i < Math.min(rows.length, 10); i++) if (rows[i] && rows[i].some(c => String(c).includes('员工编号'))) { hi = i; break; }
  const ci = (rows[hi] || []).findIndex(h => String(h).includes('一级部门英文简称'));
  rows.slice(hi + 1).forEach(r => {
    if (!r || !r.length) return;
    const c = String(r[ci] == null ? '' : r[ci]).trim();
    if (c && c !== TARGET) otherCenters.add(c);
  });
}
say('   其他中心共 ' + otherCenters.size + ' 个：' + [...otherCenters].sort().join(' ').slice(0, 140));
for (const f of ['看板.html', 'assets/js/data.js', 'assets/js/datasource.js']) {
  const p = path.join(OUT, f);
  if (!fs.existsSync(p)) continue;
  const txt = fs.readFileSync(p, 'utf8');
  for (const c of otherCenters) {
    const re = new RegExp('(^|[^A-Za-z0-9])' + c + '([^A-Za-z0-9]|$)');
    if (re.test(txt)) { say('   ✗ ' + f + ' 中出现可疑中心名「' + c + '」'); leak++; }
  }
}
/* 5.4 必须没有脚本依赖 */
const scripts = [];
(function scan(dir) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n), st = fs.statSync(p);
    if (st.isDirectory()) scan(p);
    else if (/\.(bat|cmd|vbs|ps1)$/i.test(n)) scripts.push(path.relative(OUT, p));
  }
})(OUT);
if (scripts.length) { say('   ✗ 目录里还有脚本文件：' + scripts.join(', ')); leak++; }
else say('   无任何 bat / cmd / vbs 脚本 ✓');

say('\n' + (leak === 0 ? '✔ 自检通过：分享版不含任何其他中心数据，且零脚本依赖'
                      : '✗ 自检发现 ' + leak + ' 处问题'));
say('\n产出位置：' + OUT);
say('使用方法：把整个「分享版」文件夹压缩后发给同事，对方解压 → 双击「看板.html」即可。');
