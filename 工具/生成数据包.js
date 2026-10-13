/* ═══════════════════════════════════════════════════════════════
   生成浏览器数据包 assets/hr-data.js
   ------------------------------------------------------------------
   为什么要有这一步：
     双击 HTML（file:// 协议）时浏览器禁止 fetch 本地 Excel，
     但 <script src> 不受这个限制。所以把 Excel 预先转成一个
     JS 文件，页面用 <script> 引进来 —— 双击即看，零依赖。

   存的是 AOA（数组的数组，即 sheet_to_json 的 header:1 形态），
   浏览器端用 XLSX.utils.aoa_to_sheet 就能还原成 workbook，
   直接喂给现有的 ingestWorkbook，解析逻辑一行都不用改。

   用法：
     node 工具/生成数据包.js              → 写出 assets/hr-data.js
     node 工具/生成数据包.js --out <文件>  → 写到别处（备份、对比用）

   本部门代号 / 表名 / 文件名都从 assets/bu-config.js 读（真实值在 bu-config.local.js）。

   数据来源（2026-09-12 起）：
     data/ 下那张汇总表 —— 一个文件装全部。按 sheet 名拆成四路：
       人员数据 / 绩效-* / 台账-* / 部门编制·指标目标·月度快照·招聘计划·花名册
     **人员例外**：优先取 data/ 里的 KPA*.xls 原文件（HTML 要看新鲜的原表），
     汇总表里的「人员数据」只是给 Excel 版看板用的副本，找不到原文件时才回落到它。
     找不到汇总表时自动回落到旧的分散文件，行为与改造前一致。
   ═══════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const BU = require('./读取部门配置.js');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const ARGS = process.argv.slice(2);
const OUT_ARG = ARGS.indexOf('--out');
const OUT = OUT_ARG >= 0 ? path.resolve(ARGS[OUT_ARG + 1])
                : path.join(ROOT, 'assets', 'hr-data.js');
const LOG = [];
const say = s => { LOG.push(s); console.log(s); };

let XLSX;
try { XLSX = require('C:/Users/wushangyan/node_modules/xlsx'); }
catch (e) { try { XLSX = require('xlsx'); } catch (e2) { console.error('找不到 xlsx 模块'); process.exit(1); } }

/* 按修改时间取最新的一份（KPA 导出的文件名带时间戳，data/ 里可能同时留着新旧两份） */
function findFile(re) {
  const cands = fs.readdirSync(DATA)
    .filter(n => re.test(n) && !n.startsWith('~$'))
    .map(n => ({ n, t: fs.statSync(path.join(DATA, n)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!cands.length) return null;
  if (cands.length > 1) {
    say('   ⚠ 同类文件有 ' + cands.length + ' 份，取最新修改的一份：');
    cands.forEach(c => say('       ' + (c.n === cands[0].n ? '✔ 采用' : '  忽略') + ' ' + c.n));
    say('       （建议把不用的移出 data/，免得混淆）');
  }
  return path.join(DATA, cands[0].n);
}

/* sheet → AOA。必须先按「实际存在的单元格」裁剪 !ref：
   台账 sheet 会声明假范围（上百万行），直接 sheet_to_json 会把内存打爆。 */
function aoaOfSheet(ws, maxRows) {
  if (!ws || !ws['!ref']) return [];
  let range;
  try { range = XLSX.utils.decode_range(ws['!ref']); } catch (e) { return []; }
  let lastR = range.s.r, lastC = range.s.c;
  for (const k of Object.keys(ws)) {
    if (k[0] === '!') continue;
    const c = ws[k];
    if (!c || c.v === '' || c.v == null) continue;
    try {
      const p = XLSX.utils.decode_cell(k);
      if (p.r > lastR) lastR = p.r;
      if (p.c > lastC) lastC = p.c;
    } catch (e) {}
  }
  const cap = maxRows || 20000;
  if (lastR - range.s.r > cap) lastR = range.s.r + cap;
  ws['!ref'] = XLSX.utils.encode_range({ s: range.s, e: { r: lastR, c: Math.min(lastC, range.e.c) } });
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
}
function bookOf(wb) {
  return wb.SheetNames.map(n => [n, aoaOfSheet(wb.Sheets[n])]);
}
function readBook(file) { return XLSX.readFile(file, { cellDates: false }); }

say('【完整版数据包 · 全量】');
/* 汇总表里各 sheet 的归属判定（表名见 bu-config.js 的 book，用户手工维护）。
   浏览器端 data.js 用同一套谓词 ——
   两边必须一致，否则「生成数据包」和「从 data 文件夹读取」会读出不同的东西。
   ⚠ roster 的花名册名必须锚定 sheet 名开头（见 bu-config.js 的 rosterSheet）：
     本年度入职名单 / 高潜名单 / C型干部名单 都含「名单」，
     宽松匹配会把它们误当花名册。
   ⚠ ledger 谓词要排除 绩效考评明细（那两张是绩效表），但要放行 绩效B-C人员情况（台账）。 */
const SHEET = {
  emp:    sn => /^人员数据/.test(sn),
  perf:   sn => /绩效考评明细/.test(sn),
  roster: sn => BU.rosterSheet.test(sn) || /花名册/.test(sn),
  manual: sn => /^(部门编制|指标目标|月度快照|招聘计划|工作分工)$/.test(sn),
  ledger: sn => !/绩效考评明细/.test(sn) && /组织架构|人员情况|校招需求|外包名单|外包评价|入职名单|招聘未达成|储备干部|高潜|部门梯队|C型干部|校招名单|OD名单/.test(sn),
};
function splitOf(wb, pred) {
  const names = wb.SheetNames.filter(pred);
  return names.length ? names.map(n => [n, aoaOfSheet(wb.Sheets[n])]) : null;
}
function empRowCount(sheets) {
  if (!sheets || !sheets.length) return -1;
  const aoa = sheets[0][1] || [];
  let h = 0;
  for (let i = 0; i < Math.min(aoa.length, 10); i++) {
    if (aoa[i] && aoa[i].some(c => String(c).includes('员工编号'))) { h = i; break; }
  }
  return Math.max(aoa.length - h - 1, 0);
}

const files = {};
const books = {};
const CONS = path.join(DATA, BU.book);

if (fs.existsSync(CONS)) {
  say('① 原数据表：' + BU.book);
  const wb = readBook(CONS);
  books.perf = splitOf(wb, SHEET.perf);
  books.ledger = splitOf(wb, SHEET.ledger);
  const manNames = wb.SheetNames.filter(sn => SHEET.manual(sn) || SHEET.roster(sn));
  books.manual = manNames.length ? manNames.map(n => [n, aoaOfSheet(wb.Sheets[n])]) : null;
  files.manual = BU.book;
  say('   绩效 ' + (books.perf ? books.perf.map(p => p[0]).join('/') : '无')
    + ' · 台账 ' + (books.ledger ? books.ledger.length + ' 张' : '无')
    + ' · 手工 ' + (books.manual ? books.manual.length + ' 张' : '无'));

  /* 人员：**data/ 里的 KPA 原文件优先**。
     汇总表里的「人员数据」sheet 是给 Excel 版看板用的副本，HTML 读原表更新鲜。
     原文件不在时才回落到副本，免得人员数据整个空掉。 */
  const empFromCons = splitOf(wb, SHEET.emp);
  const empFile = findFile(/^KPA.*\.xls$/i);
  if (empFile) {
    const fromFile = bookOf(readBook(empFile));
    files.emp = path.basename(empFile);
    books.emp = fromFile;
    say('② 人员：' + files.emp + '（KPA 原文件优先）');
    const nFile = empRowCount(fromFile), nCons = empRowCount(empFromCons);
    if (nCons >= 0 && nFile !== nCons) {
      say('   ⚠ 汇总表里的「人员数据」是 ' + nCons + ' 行，KPA 原文件是 ' + nFile + ' 行 —— 两边不一致。');
      say('     看板会以 KPA 原文件为准；要让 Excel 版看板也对上，请把新导出的 KPA 重新粘进汇总表。');
    }
  } else if (empFromCons) {
    files.emp = '<文件名已脱敏>.xlsx · 人员数据';
    books.emp = empFromCons;
    say('② 人员：汇总表里的「人员数据」sheet（没找到 data/KPA*.xls）');
  } else say('② 人员：✗ 没有可用的人员数据');
} else {
  say('① 原数据表：找不到 data/' + BU.book + '，回落到分散的原文件');
  say('   （建议先跑一次  node 工具/建汇总表.js ）');

  const empFile = findFile(/^KPA.*\.xls$/i);
  if (!empFile) { say('✗ 未找到 data/KPA*.xls'); process.exit(1); }
  files.emp = path.basename(empFile);
  say('② 人员：' + files.emp);
  books.emp = bookOf(readBook(empFile));

  const perfFile = findFile(/绩效考评结果汇总.*\.xlsx$/i);
  if (perfFile) {
    files.perf = path.basename(perfFile);
    say('③ 绩效：' + files.perf);
    books.perf = bookOf(readBook(perfFile));
  } else say('③ 绩效：未找到，跳过');

  const ledgerFile = findFile(/人才现状.*\.xlsx$/i);
  if (ledgerFile) {
    files.ledger = path.basename(ledgerFile);
    say('④ 台账：' + files.ledger);
    books.ledger = bookOf(readBook(ledgerFile));
  } else say('④ 台账：未找到，跳过');

  const legacy = path.join(DATA, '看板数据源.xlsx');
  if (fs.existsSync(legacy)) {
    files.manual = '看板数据源.xlsx';
    say('⑤ 手工数据源：' + files.manual);
    books.manual = bookOf(readBook(legacy));
  } else say('⑤ 手工数据源：未找到，跳过');
}

const pack = {
  v: 1,
  scope: 'full',
  built: new Date().toISOString(),
  files,
  books,
};
const js = '/* 自动生成，请勿手动编辑。来源：data/ 目录下的 Excel */\n'
  + 'window.HR_DATA=' + JSON.stringify(pack) + ';\n';

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, js, 'utf8');
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
say('\n✔ 已写出 ' + path.relative(ROOT, OUT) + '（' + kb + ' KB）');

