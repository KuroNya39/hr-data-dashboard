/* ═══════════════════════════════════════════════════════════════
   生成浏览器数据包 assets/hr-data.js（或 分享版/assets/hr-data.js）
   ------------------------------------------------------------------
   为什么要有这一步：
     双击 HTML（file:// 协议）时浏览器禁止 fetch 本地 Excel，
     但 <script src> 不受这个限制。所以把 Excel 预先转成一个
     JS 文件，页面用 <script> 引进来 —— 双击即看，零依赖。

   存的是 AOA（数组的数组，即 sheet_to_json 的 header:1 形态），
   浏览器端用 XLSX.utils.aoa_to_sheet 就能还原成 workbook，
   直接喂给现有的 ingestWorkbook，解析逻辑一行都不用改。

   用法：
     node 工具/生成数据包.js              → 全量（完整版）
     node 工具/生成数据包.js --swc        → 仅 SWC（分享版）
     node 工具/生成数据包.js --swc --out <文件>

   数据来源（2026-09-12 起）：
     data/HR看板数据源.xlsx —— 一个文件装全部。按 sheet 名拆成四路：
       人员数据 / 绩效-* / 台账-* / 部门编制·指标目标·月度快照·招聘计划·SWC花名册
     **人员例外**：优先取 data/ 里的 KPA*.xls 原文件（HTML 要看新鲜的原表），
     汇总表里的「人员数据」只是给 Excel 版看板用的副本，找不到原文件时才回落到它。
     找不到汇总表时自动回落到旧的分散文件，行为与改造前一致。
   ═══════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const ARGS = process.argv.slice(2);
const SWC_ONLY = ARGS.includes('--swc');
const OUT_ARG = ARGS.indexOf('--out');
const OUT = OUT_ARG >= 0 ? path.resolve(ARGS[OUT_ARG + 1])
  : (SWC_ONLY ? path.join(ROOT, '分享版', 'assets', 'hr-data.js')
              : path.join(ROOT, 'assets', 'hr-data.js'));
const TARGET = 'SWC';
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

/* ── 人员裁剪 ──
   ids 非空 = 按「SWC花名册」的工号白名单裁（她手动维护发谁不发谁）；
   ids 为空 = 按「一级部门英文简称 === SWC」裁。 */
function trimEmpSheets(sheets, ids) {
  let keptN = 0, dropN = 0;
  const otherCenters = new Set();
  const out = sheets.map(([name, aoa]) => {
    let hIdx = 0;
    for (let i = 0; i < Math.min(aoa.length, 10); i++) {
      if (aoa[i] && aoa[i].some(c => String(c).includes('员工编号'))) { hIdx = i; break; }
    }
    const header = aoa[hIdx] || [];
    const ci = header.findIndex(h => String(h).includes('一级部门英文简称'));
    const iId = header.findIndex(h => String(h).includes('员工编号'));
    const iName = header.findIndex(h => String(h).includes('员工姓名'));
    if (!ids && ci < 0) { say('   ⚠ sheet「' + name + '」找不到「一级部门英文简称」列，原样保留'); return [name, aoa]; }
    const used = new Set();
    const keep = aoa.slice(hIdx + 1).filter(r => {
      if (!r || !r.length) return false;
      if (!r[iId] && !r[iName]) return false;
      if (ids) {
        const id = String(r[iId] == null ? '' : r[iId]).trim();
        if (id && ids.has(id)) { keptN++; used.add(id); return true; }
        dropN++;
        return false;
      }
      const c = String(r[ci] == null ? '' : r[ci]).trim();
      if (c === TARGET) { keptN++; return true; }
      dropN++;
      if (c) otherCenters.add(c);
      return false;
    });
    const miss = ids ? [...ids].filter(x => !used.has(x)) : [];
    return [name, [...aoa.slice(0, hIdx + 1), ...keep], miss];
  });
  return { sheets: out.map(x => [x[0], x[1]]), missing: out.length ? out[0][2] : [], keptN, dropN, otherCenters };
}

/* 从「SWC人员名单」sheet 里取工号白名单（旧名 SWC花名册 也认） */
function rosterIdsOf(manualSheets) {
  if (!manualSheets) return null;
  const hit = manualSheets.find(([n]) => /^SWC人员名单/.test(n) || /花名册/.test(n));
  if (!hit) return null;
  const aoa = hit[1] || [];
  if (aoa.length < 2) return null;
  let h = 0;
  for (let i = 0; i < Math.min(aoa.length, 6); i++) {
    if (aoa[i] && aoa[i].some(c => String(c).includes('员工编号'))) { h = i; break; }
  }
  const iId = (aoa[h] || []).findIndex(c => String(c).includes('员工编号'));
  if (iId < 0) return null;
  const ids = new Set();
  aoa.slice(h + 1).forEach(r => {
    const v = String((r && r[iId]) == null ? '' : r[iId]).trim();
    if (v) ids.add(v);
  });
  return ids.size ? ids : null;
}

/* ── 绩效裁剪：按「中心」列过滤，没有该列就按 SWC 工号白名单 ── */
function trimPerfSheets(sheets, swcIds) {
  let keptN = 0;
  const out = sheets.map(([name, aoa]) => {
    let h = -1, iId = -1, iCenter = -1;
    for (let i = 0; i < Math.min(aoa.length, 12); i++) {
      if (!aoa[i]) continue;
      const c = aoa[i].findIndex(x => /工号|员工编号/.test(String(x)));
      if (c >= 0) { h = i; iId = c; iCenter = aoa[i].findIndex(x => /中心/.test(String(x))); break; }
    }
    if (h < 0) return [name, aoa];           // 纯说明页，原样带过
    const body = aoa.slice(h + 1).filter(r => {
      if (!r || !r.length) return false;
      if (iCenter >= 0) {
        const c = String(r[iCenter] == null ? '' : r[iCenter]).trim();
        if (c) return c === TARGET;
      }
      const id = String(r[iId] == null ? '' : r[iId]).trim();
      return id ? swcIds.has(id) : false;
    });
    keptN += body.length;
    /* 表头之后那些「工号列为空」的说明行也留着 */
    const tail = aoa.slice(h + 1)
      .filter(r => !r || !r.length || !String(r[iId] == null ? '' : r[iId]).trim())
      .slice(0, 12);
    return [name, [...aoa.slice(0, h + 1), ...body, ...(tail.length ? [[''], ...tail] : [])]];
  });
  return { sheets: out, keptN };
}

/* ═══ 主流程 ═══ */
say(SWC_ONLY ? '【分享版数据包 · 仅 SWC】' : '【完整版数据包 · 全量】');

/* 汇总表里各 sheet 的归属判定（2026-09-12 晚起 = SWC人力看板.xlsx，用户手工维护）。
   浏览器端 data.js 用同一套谓词 —— 
   两边必须一致，否则「生成数据包」和「从 data 文件夹读取」会读出不同的东西。
   ⚠ roster 必须锚定 ^SWC人员名单：本年度入职名单 / 高潜名单 / C型干部名单 都含「名单」，
     宽松匹配会把它们误当分享白名单。
   ⚠ ledger 谓词要排除 绩效考评明细（那两张是绩效表），但要放行 绩效B-C人员情况（台账）。 */
const SHEET = {
  emp:    sn => /^人员数据/.test(sn),
  perf:   sn => /绩效考评明细/.test(sn),
  roster: sn => /^SWC人员名单/.test(sn) || /花名册/.test(sn),
  manual: sn => /^(部门编制|指标目标|月度快照|招聘计划|工作分工)$/.test(sn),
  ledger: sn => !/绩效考评明细/.test(sn) && /组织架构|人员情况|校招需求|外包名单|外包评价|入职名单|招聘未达成|储备干部|高潜|部门梯队|C型干部|校招名单/.test(sn),
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
const CONS = path.join(DATA, 'SWC人力看板.xlsx');

if (fs.existsSync(CONS)) {
  say('① 原数据表：SWC人力看板.xlsx');
  const wb = readBook(CONS);
  books.perf = splitOf(wb, SHEET.perf);
  books.ledger = splitOf(wb, SHEET.ledger);
  const manNames = wb.SheetNames.filter(sn => SHEET.manual(sn) || SHEET.roster(sn));
  books.manual = manNames.length ? manNames.map(n => [n, aoaOfSheet(wb.Sheets[n])]) : null;
  files.manual = 'SWC人力看板.xlsx';
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
    files.emp = 'HR看板数据源.xlsx · 人员数据';
    books.emp = empFromCons;
    say('② 人员：汇总表里的「人员数据」sheet（没找到 data/KPA*.xls）');
  } else say('② 人员：✗ 没有可用的人员数据');
} else {
  say('① 原数据表：找不到 data/SWC人力看板.xlsx，回落到分散的原文件');
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

/* 裁剪 */
let otherCenters = new Set();
let usedRoster = null;
if (SWC_ONLY) {
  const rosIds = rosterIdsOf(books.manual);
  say('⑤ 裁剪为仅 SWC' + (rosIds ? '（按 SWC人员名单，' + rosIds.size + ' 个工号）' : '（按一级部门英文简称列）'));
  usedRoster = rosIds;
  const r = trimEmpSheets(books.emp, rosIds);
  books.emp = r.sheets;
  otherCenters = r.otherCenters;
  say('   人员：保留 ' + r.keptN + ' 行 · 剔除 ' + r.dropN + ' 行'
    + (rosIds ? '' : ' · 剔除中心 ' + r.otherCenters.size + ' 个'));
  if (!rosIds && otherCenters.size) say('   剔除的中心：' + [...otherCenters].sort().join(' '));
  if (rosIds && r.missing.length) {
    say('   ⚠ SWC人员名单里有 ' + r.missing.length + ' 个工号在人员数据里找不到（可能已离职或被移出导出）：');
    say('     ' + r.missing.slice(0, 20).join(' ') + (r.missing.length > 20 ? ' …' : ''));
  }
  if (books.perf) {
    const ids = new Set();
    books.emp.forEach(([, aoa]) => {
      let h = 0;
      for (let i = 0; i < Math.min(aoa.length, 10); i++) {
        if (aoa[i] && aoa[i].some(c => String(c).includes('员工编号'))) { h = i; break; }
      }
      const iId = (aoa[h] || []).findIndex(x => String(x).includes('员工编号'));
      if (iId >= 0) aoa.slice(h + 1).forEach(r => { if (r && r[iId]) ids.add(String(r[iId]).trim()); });
    });
    const p = trimPerfSheets(books.perf, ids);
    books.perf = p.sheets;
    say('   绩效：保留 ' + p.keptN + ' 条');
  }
}

const pack = {
  v: 1,
  scope: SWC_ONLY ? 'swc' : 'full',
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

/* ── 分享版安全自检 ──
   判据只有一个：决定中心归属的那一列（一级部门英文简称）的值必须是 SWC。
   不要对整个 JSON 做全文正则 —— 别的字段里会出现与中心简称同名的值、
   成本中心描述里也可能包含其他中心的字样，全文扫会大量误报，把真问题淹掉。 */
if (SWC_ONLY) {
  say('\n══ 安全自检 ══');
  let leak = 0, checked = 0;
  books.emp.forEach(([name, aoa]) => {
    let h = 0;
    for (let i = 0; i < Math.min(aoa.length, 10); i++) {
      if (aoa[i] && aoa[i].some(c => String(c).includes('员工编号'))) { h = i; break; }
    }
    const header = aoa[h] || [];
    const iId = header.findIndex(x => String(x).includes('员工编号'));
    const ci = header.findIndex(x => String(x).includes('一级部门英文简称'));
    if (usedRoster && iId < 0) { say('   ✗ sheet「' + name + '」找不到「员工编号」列，无法验证'); leak++; return; }
    if (!usedRoster && ci < 0) { say('   ✗ sheet「' + name + '」找不到「一级部门英文简称」列，无法验证'); leak++; return; }
    aoa.slice(h + 1).forEach(r => {
      if (!r || !r.length) return;
      checked++;
      if (usedRoster) {
        const id = String(r[iId] == null ? '' : r[iId]).trim();
        if (!id || !usedRoster.has(id)) leak++;
      } else if (String(r[ci] == null ? '' : r[ci]).trim() !== TARGET) leak++;
    });
  });
  say('   人员数据复核：共 ' + checked + ' 行 · 越界行 ' + leak + ' 行'
    + (usedRoster ? '（判据：工号是否在 SWC人员名单内）' : '（判据：一级部门英文简称是否为 SWC）'));
  say(leak === 0 ? '   ✔ 通过：分享版人员数据完全落在允许范围内' : '   ✗ 发现 ' + leak + ' 处问题');
}
