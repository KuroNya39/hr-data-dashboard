/* ═══════════════════════════════════════════════════════════════
   v8 data.js — IndexedDB 持久化 · 文件上传解析 · 筛选器 · 页面切换
   ═══════════════════════════════════════════════════════════════ */

/* ── IndexedDB 本地缓存（刷新免重传） ── */
/* 库名可被分享版覆盖：分享版必须用独立的库，
   否则它会从完整版留下的快照里恢复出「含其他中心」的数据，
   物理裁剪的防护就被自己的缓存绕过去了 */
const IDB_NAME = (typeof window !== 'undefined' && window.HR_IDB_NAME) || 'hr-dashboard-v8';
function idbOpen() {
  return new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('no idb'));
    const rq = indexedDB.open(IDB_NAME, 1);
    rq.onupgradeneeded = e => e.target.result.createObjectStore('kv');
    rq.onsuccess = e => res(e.target.result);
    rq.onerror = () => rej(rq.error);
  });
}
/* 统一的时间戳写法，几处提示它们显示的是同一件事 */
function nowStamp() {
  return new Date().toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}
async function saveSnapshot() {
  try {
    const db = await idbOpen();
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put({
      rawData, perfData, perfMeta, perfFileLoaded,
      ledgerData, ledgerSavedAt,
      /* 记下这份快照是基于哪个版本的数据包生成的：
         下次打开时如果数据包的 built 变了，说明数据更新过，就改读数据包而不是这份旧快照 */
      packBuilt: (window.HR_DATA && window.HR_DATA.built) || null,
      savedAt: nowStamp(),
    }, 'snapshot');
    /* 必须等事务真正结束：put() 只是把请求排进队列，不 await 的话
       配额不足、结构化克隆失败这类异步错误根本进不了下面的 catch，快照会静默丢失 */
    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
  } catch (e) { console.warn('快照保存失败', e); }
}
async function restoreSnapshot() {
  try {
    const db = await idbOpen();
    return await new Promise((res, rej) => {
      const rq = db.transaction('kv').objectStore('kv').get('snapshot');
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror = () => rej(rq.error);
    });
  } catch (e) { return null; }
}
async function clearSnapshot() {
  try {
    const db = await idbOpen();
    db.transaction('kv', 'readwrite').objectStore('kv').delete('snapshot');
  } catch (e) {}
  location.reload();
}

/* ── 文件读取 ── */
function readWorkbook(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = e => {
      try { res(XLSX.read(new Uint8Array(e.target.result), { type:'array', cellDates:false })); }
      catch (err) { rej(err); }
    };
    reader.onerror = () => rej(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/* ── 内联数据包（assets/hr-data.js，用 <script> 引入） ──
   双击打开看板走的是 file:// 协议，浏览器禁止 fetch 本地 Excel；
   但 <script src> 不受这个限制。所以数据预先转成一份数据包，
   页面引进来即可用 —— 不需要任何本地服务、不需要 bat、不需要 Python。

   数据包里存的是 AOA（数组的数组）。这里用 aoa_to_sheet 还原成 workbook，
   直接复用下面的 ingestWorkbook，解析口径与「拖文件进来」完全一致。 */
let _packedBooks = { emp: null, perf: null, ledger: null, manual: null };
function packSheetToWorkbook(sheets) {
  const wb = { SheetNames: [], Sheets: {} };
  for (const [name, aoa] of (sheets || [])) {
    if (!name) continue;
    wb.SheetNames.push(name);
    try { wb.Sheets[name] = XLSX.utils.aoa_to_sheet(aoa || []); } catch (e) {}
  }
  return wb;
}
function wbToPack(wb) {
  return wb.SheetNames.map(n => [n, XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', blankrows: false })]);
}
function hasPack() {
  return !!(typeof window !== 'undefined' && window.HR_DATA && window.HR_DATA.books && window.HR_DATA.books.emp);
}

/* 台账工作簿识别（SWC最新人才现状-*.xlsx，9 个业务 sheet） */
const LEDGER_SIGNALS = ['组织架构','人员情况','校招需求','外包名单','外包评价','入职名单','招聘未达成','储备干部','高潜','部门梯队','C型干部','校招名单'];
function looksLikeLedger(wb) {
  return wb.SheetNames.filter(sn => LEDGER_SIGNALS.some(s => sn.includes(s))).length >= 2;
}

/* ═══════════ 汇总表（data/SWC人力看板.xlsx，2026-09-12 晚起）═══════════
   用户手工维护的唯一原数据表（13 张 sheet），人员花名册基准仍是 data/KPA*.xls：
     SWC人员名单（分享白名单，用户从 KPA 手动复制） /
     干部梯队·人才梯队 26H1绩效考评明细 / 绩效B-C人员情况 /
     C型干部名单 · 储备干部名单 · 高潜名单 · 招聘未达成需求 · 27届校招需求 ·
     26届校招名单 · 本年度入职名单 · 外包评价 · 部门梯队
   解析器各自只认自己那几张 sheet，所以先把整份拆成子工作簿再喂进去 ——
   直接把整份丢给 ingestWorkbook 会被 looksLikeLedger() 命中（里面躺着 9+ 张台账 sheet），
   整个文件被当成台账处理，人员数据一条都读不到。

   ⚠ 这一组谓词必须和 工具/生成数据包.js 里的 SHEET 逐字一致，
     否则「生成数据包」和「从 data 文件夹读取」会读出不同结果。
   ⚠ isRosterSheet 用 ^SWC人员名单 锚定：本年度入职名单 / 高潜名单 / C型干部名单
     都含「名单」，宽松匹配会把它们误当分享白名单。 */
const CONSOLIDATED_NAME = 'SWC人力看板.xlsx';
const isEmpSheet    = sn => /^人员数据/.test(sn);
const isPerfSheet   = sn => /绩效考评明细/.test(sn);
const isRosterSheet = sn => /^SWC人员名单/.test(sn) || /花名册/.test(sn);
const isManualSheet = sn => /^(部门编制|指标目标|月度快照|招聘计划|工作分工)$/.test(sn);
const isLedgerSheet = sn => !/绩效考评明细/.test(sn) && LEDGER_SIGNALS.some(s => sn.includes(s));
function looksLikeConsolidated(wb) {
  const n = wb.SheetNames;
  /* 注意：这张表里**没有**人员数据 sheet（人员一律走 KPA 原文件），所以不能要求 isEmpSheet */
  return n.filter(isLedgerSheet).length >= 2 || n.some(isManualSheet) ||
    (n.some(isPerfSheet) && n.some(isRosterSheet));
}
/* 只保留满足条件的 sheet，其余原样丢掉 —— 返回值可以直接喂给各解析器 */
function subWorkbook(wb, pred) {
  const out = { SheetNames: [], Sheets: {} };
  (wb.SheetNames || []).forEach(sn => {
    if (pred(sn) && wb.Sheets[sn]) { out.SheetNames.push(sn); out.Sheets[sn] = wb.Sheets[sn]; }
  });
  return out;
}
/* 把汇总表拆成四路，分别走各自的解析器 */
async function ingestConsolidated(wb, stats) {
  /* ① 台账 */
  const lw = subWorkbook(wb, isLedgerSheet);
  if (lw.SheetNames.length) {
    try {
      ledgerData = parseLedgerWorkbook(lw);
      ledgerSavedAt = nowStamp();
      stats.ledgerFiles++;
      _packedBooks.ledger = wbToPack(lw);
    } catch (e) { console.warn('汇总表·台账解析失败：', e); }
  }
  /* ② 绩效 */
  const pw = subWorkbook(wb, isPerfSheet);
  if (pw.SheetNames.length) {
    try {
      const nc = parsePerfWorkbook(pw);
      if (nc > 0) { stats.perfCount += nc; perfFileLoaded = true; stats.perfFiles++; _packedBooks.perf = wbToPack(pw); }
    } catch (e) { console.warn('汇总表·绩效解析失败：', e); }
  }
  /* ③ 人员（走通用识别，保留「按工号覆盖合并」的语义） */
  const ew = subWorkbook(wb, isEmpSheet);
  if (ew.SheetNames.length) {
    stats.currentName = CONSOLIDATED_NAME;
    await ingestWorkbook(ew, stats);
  }
  /* ④ 手工四张表 + SWC花名册 */
  const mw = subWorkbook(wb, sn => isManualSheet(sn) || isRosterSheet(sn));
  if (mw.SheetNames.length) {
    try {
      const ds = parseDataSourceWorkbook(mw);
      ds.file = CONSOLIDATED_NAME;
      adoptDataSource(ds, true);
    } catch (e) { console.warn('汇总表·手工数据源解析失败：', e); }
  }
}
/* 从已加载的数据包里取 SWC花名册的工号集合（分享时「发谁不发谁」的名单） */
function rosterIdsFromPack() {
  const packs = [];
  if (_packedBooks.manual) packs.push(_packedBooks.manual);
  if (window.HR_DATA && window.HR_DATA.books && window.HR_DATA.books.manual) packs.push(window.HR_DATA.books.manual);
  for (const sheets of packs) {
    const hit = (sheets || []).find(([n]) => /^SWC人员名单/.test(n) || /花名册/.test(n));
    if (!hit) continue;
    const aoa = hit[1] || [];
    if (aoa.length < 2) continue;
    let h = 0;
    for (let i = 0; i < Math.min(aoa.length, 6); i++) {
      if (aoa[i] && aoa[i].some(c => String(c).includes('员工编号'))) { h = i; break; }
    }
    const iId = (aoa[h] || []).findIndex(c => String(c).includes('员工编号'));
    if (iId < 0) continue;
    const ids = new Set();
    aoa.slice(h + 1).forEach(r => {
      const v = String((r && r[iId]) == null ? '' : r[iId]).trim();
      if (v) ids.add(v);
    });
    if (ids.size) return ids;
  }
  return null;
}

async function ingestWorkbook(wb, stats) {
  // ① 台账文件优先识别
  if (looksLikeLedger(wb)) {
    ledgerData = parseLedgerWorkbook(wb);
    ledgerSavedAt = nowStamp();
    stats.ledgerFiles++;
    _packedBooks.ledger = wbToPack(wb);   // 此时 !ref 已被 sheetRowsSafe 裁过，范围是干净的
    return;
  }
  // ② 人员主数据
  let isEmp = false;
  for (const sn of wb.SheetNames) {
    const json = XLSX.utils.sheet_to_json(wb.Sheets[sn], { raw:true, defval:'' });
    if (json && json.length >= 3) {
      const rows = json.map(parseRow).filter(d => d.id && d.name);
      if (rows.length > 0) {
        isEmp = true;
        /* 按工号「覆盖更新」，而不是「已存在就丢弃」：
           重新上传一份改过的表（员工转正了、换部门了、离职了）时，
           丢弃会让界面永远停在旧数据上，而且没有任何提示 —— 看着像上传没生效 */
        const idx = new Map(rawData.map((d, i) => [d.id, i]));
        rows.forEach(r => {
          if (idx.has(r.id)) { rawData[idx.get(r.id)] = r; stats.updated++; }
          else { idx.set(r.id, rawData.length); rawData.push(r); stats.added++; }
        });
        stats.empFiles++;
        _packedBooks.emp = wbToPack(wb);
        break;
      }
    }
  }
  // ③ 绩效文件
  if (!isEmp || /绩效|perf/i.test(stats.currentName || '')) {
    const nc = parsePerfWorkbook(wb);
    if (nc > 0) { stats.perfCount += nc; perfFileLoaded = true; stats.perfFiles++; _packedBooks.perf = wbToPack(wb); }
  }
}

async function handleFiles(fileList) {
  const files = [...fileList].filter(f => /\.(xlsx|xls)$/i.test(f.name));
  if (!files.length) { showToast('未找到 Excel 文件', true); return; }
  document.getElementById('uploadHint').textContent = `正在解析 ${files.length} 个文件…`;
  const stats = { empFiles:0, perfFiles:0, perfCount:0, ledgerFiles:0, added:0, updated:0, failed:[] };
  for (const f of files) {
    try {
      stats.currentName = f.name;
      const wb = await readWorkbook(f);
      /* 汇总表要先拆再喂：整份丢进去会被当成台账（见 ingestConsolidated 的注释） */
      if (looksLikeConsolidated(wb)) await ingestConsolidated(wb, stats);
      else await ingestWorkbook(wb, stats);
    }
    catch (err) { stats.failed.push(f.name); console.error('读取失败:', f.name, err); }
  }
  /* 三样都空才算失败。只丢台账、或只丢绩效也是有效上传 ——
     以前一律按「没有人员数据」直接 return，台账页就永远进不去了 */
  if (!rawData.length && !stats.perfCount && !stats.ledgerFiles) {
    showToast('未能识别有效数据，请检查文件格式', true);
    document.getElementById('uploadHint').textContent = '解析失败：未找到含「员工编号+姓名」的人员数据，也未识别到绩效或台账'
      + (stats.failed.length ? `（无法读取：${stats.failed.join('、')}）` : '');
    return;
  }
  if (stats.perfCount > 0) attachPerfData();
  const bits = [];
  if (stats.empFiles) bits.push(`人员 ${rawData.length} 条${stats.updated ? `（更新 ${stats.updated} 条）` : ''}`);
  if (stats.perfCount) bits.push(`绩效 ${stats.perfCount} 条`);
  if (stats.ledgerFiles) bits.push(`台账 ${ledgerData ? ledgerBoardCount() : 0} 块`);
  document.getElementById('uploadHint').textContent = '已解析：' + bits.join(' · ');
  await onDataLoaded();
  // 读不出来的文件必须说出来，只写 console 的话界面上看到的是「已加载」的全绿提示
  showToast(`已加载：${bits.join('、')}` + (stats.failed.length ? `；无法读取 ${stats.failed.length} 个文件：${stats.failed.join('、')}` : ''),
    stats.failed.length > 0);
}

function ledgerBoardCount() {
  if (!ledgerData) return 0;
  let n = 0;
  if (ledgerData.summary) n++;
  if (ledgerData.recruitOpen.length) n++;
  if (ledgerData.bcPeople.length) n++;
  if (ledgerData.reserveCandidates.length) n++;
  if (ledgerData.highPotential.length) n++;
  if (ledgerData.outsource.active.length || ledgerData.outsource.left.length) n++;
  if (ledgerData.onboard.length) n++;
  if (ledgerData.campus27.length) n++;
  if (ledgerData.deptTier.length) n++;
  return n;
}

function uploadEmpData() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.xls,.xlsx,.csv'; input.multiple = true;
  input.onchange = () => input.files.length && handleFiles(input.files);
  input.click();
}
function uploadPerfData() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.xls,.xlsx'; input.multiple = true;
  input.onchange = async () => {
    if (!input.files.length) return;
    let n = 0;
    for (const f of input.files) {
      try { n += parsePerfWorkbook(await readWorkbook(f)); } catch (err) { showToast('绩效文件解析失败：' + f.name, true); }
    }
    /* perfFileLoaded 也得置上：它决定顶栏那个绿点亮不亮，
       以前只有走整批上传才会置，单点「上传绩效数据」进来后绿点一直不亮 */
    if (n > 0) { perfFileLoaded = true; attachPerfData(); await onDataLoaded(); showToast(`新增绩效记录 ${n} 条`); }
    else showToast('未识别到绩效数据', true);
  };
  input.click();
}
function uploadLedgerData() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.xls,.xlsx'; input.multiple = false;
  input.onchange = async () => {
    if (!input.files.length) return;
    try {
      const wb = await readWorkbook(input.files[0]);
      if (!looksLikeLedger(wb)) { showToast('这不是台账文件（未识别到台账 sheet）', true); return; }
      ledgerData = parseLedgerWorkbook(wb);
      ledgerSavedAt = nowStamp();
      await onDataLoaded();
      showToast(`台账已更新：${ledgerBoardCount()} 个板块`);
    } catch (e) { showToast('台账解析失败：' + e.message, true); }
  };
  input.click();
}

/* ── 数据就绪 ── */
async function onDataLoaded(restored) {
  document.getElementById('page-upload').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  buildDeptPairs();                 // 部门标签须先于筛选器填充
  populateStaticFilters();
  refreshFilterOptions('__init__');
  lockDefaultCenter();              // 默认锁定 SWC（可在筛选器切换）
  updatePerfStatus();
  if (!restored) dataSavedAt = nowStamp();
  refreshAll();
  if (!restored) await saveSnapshot();
}
/* 默认中心锁定 SWC：仅当当前为「全部」且数据里存在 SWC */
function lockDefaultCenter(force) {
  const sel = document.getElementById('filterCenter');
  if (!sel) return;
  const hasSWC = [...sel.options].some(o => o.value === 'SWC');
  if (hasSWC && (force || sel.value === 'all')) {
    sel.value = 'SWC';
    refreshFilterOptions('center');
  }
}
function updatePerfStatus() {
  const el = document.getElementById('perfStatus');
  const dot = document.getElementById('perfDot');
  if (perfFileLoaded && perfMeta.count > 0) {
    el.style.display = 'inline';
    el.style.fontSize = '12px';
    el.style.color = 'var(--ink-3)';
    el.textContent = `绩效覆盖 ${perfMeta.count} 人${perfMeta.centers.length ? '（' + perfMeta.centers.join('/') + ' 梯队）' : ''}`;
    dot.className = 'btn-dot loaded';
  } else { el.style.display = 'none'; dot.className = 'btn-dot'; }
  const ldot = document.getElementById('ledgerDot');
  if (ldot) ldot.className = ledgerData ? 'btn-dot loaded' : 'btn-dot';
  // 人员数据那个绿点此前没有任何代码去点亮它，传完还是灰的，看着像没传上
  const edot = document.getElementById('empDot');
  if (edot) edot.className = rawData.length ? 'btn-dot loaded' : 'btn-dot';
}

/* ── 筛选器（人群 + 5 维互联） ── */
const FILTER_DEFS = [
  { key:'group',    id:'filterGroup',    fn: d => staffGroupOf(d), labelFn: v => GROUP_LABEL[v] || v, isGroup:true },
  { key:'status',   id:'filterStatus',   fn: d => d.status },
  { key:'center',   id:'filterCenter',   fn: d => d.center },
  { key:'dept',     id:'filterDept',     fn: d => d.deptEn || d.dept },
  { key:'location', id:'filterLocation', fn: d => d.workLocation },
  { key:'type',     id:'filterType',     fn: d => d.empType },
];
function getFilterValues(excludeKey) {
  const v = { fromDate:'', toDate:'' };
  FILTER_DEFS.forEach(f => {
    const val = excludeKey === f.key ? 'all' : document.getElementById(f.id).value;
    v[f.key] = (!val || val === '') ? 'all' : val;
  });
  v.fromDate = excludeKey === 'date' ? '' : document.getElementById('filterDateFrom').value;
  v.toDate = excludeKey === 'date' ? '' : document.getElementById('filterDateTo').value;
  return v;
}
function getFiltered(excludeKey) {
  const f = getFilterValues(excludeKey);
  return rawData.filter(d => {
    if (f.group !== 'all' && staffGroupOf(d) !== f.group) return false;
    if (f.status !== 'all' && d.status !== f.status) return false;
    if (f.center !== 'all' && d.center !== f.center) return false;
    if (f.dept !== 'all' && (d.deptEn || d.dept) !== f.dept) return false;
    if (f.location !== 'all' && d.workLocation !== f.location) return false;
    if (f.type !== 'all' && d.empType !== f.type) return false;
    if (f.fromDate && (!d.joinDate || d.joinDate < f.fromDate)) return false;
    if (f.toDate && (!d.joinDate || d.joinDate > f.toDate)) return false;
    return true;
  });
}
function populateStaticFilters() {
  const statusSel = document.getElementById('filterStatus');
  statusSel.innerHTML = '<option value="all">全部</option><option>在职</option><option>离职</option>';
}
function refreshFilterOptions(changedKey) {
  FILTER_DEFS.forEach(f => {
    if (f.key === changedKey) return;
    const data = getFiltered(f.key);
    const vals = [...new Set(data.map(f.fn).filter(Boolean))].sort();
    const sel = document.getElementById(f.id);
    if (!sel) return;
    const cur = sel.value;
    const label = v => f.labelFn ? f.labelFn(v) : (f.key === 'dept' ? getDeptLabel(v) : v);
    sel.innerHTML = '<option value="all">全部</option>' +
      vals.map(v => `<option value="${esc(v)}">${esc(label(v))}</option>`).join('');
    sel.value = (cur !== 'all' && vals.includes(cur)) ? cur : 'all';
  });
}
function onFilterChange(changedKey) {
  refreshFilterOptions(changedKey);
  refreshAll();
}
function resetFilters() {
  FILTER_DEFS.forEach(f => { const s = document.getElementById(f.id); if (s) s.value = 'all'; });
  document.getElementById('filterDateFrom').value = '';
  document.getElementById('filterDateTo').value = '';
  refreshFilterOptions('__init__');
  lockDefaultCenter(true);
  refreshAll();
}
function updateFilterStat() {
  const filtered = getFiltered();
  const act = filtered.filter(d => d.status === '在职');
  const g = groupCounts(act);
  document.getElementById('filterStat').textContent =
    `${filtered.length} 人 · 在职 ${act.length}（正式 ${g.formal} · 实习 ${g.intern} · 外协 ${g.outsource}）· 全库 ${rawData.length}`;
}

/* ── 页面切换 ── */
const PAGE_TITLES = {
  overview:['总览','三类人群 · 核心人力指标'], structure:['组织与用工','部门下钻 · 职级与用工结构'],
  demographics:['人员结构','年龄 · 学历 · 地点 · 经验'], turnover:['人员流动','正式员工离职率与三块流出'],
  ops:['转正与合同','试用期与协议到期管理'], talent:['梯队绩效盘点','九宫格 · 排名 · 投入'],
  health:['职级健康度','金字塔与双通道'], ledger:['HR 工作台账','招聘缺口 · 末位改进 · 储备干部 · 高潜'],
  employee:['员工明细','全字段列表 · 列筛选 · 导出'],
  brief:['简报模式','一页汇报 · 打印存 PDF'],
  /* ── 新菜单（一级 + 二级）── */
  people:['人员概览','现在的人怎么样 · 规模 · 结构 · 变化 · 预警'],
  move:['人员异动','人员流动 · 转正与合同'],
  recruit_overview:['招聘概览','建设中'], recruit_need:['招聘需求','建设中'],
  campus_overview:['校招概览','建设中'], campus_need:['校招需求','建设中'], campus_emp:['校招生','建设中'],
  talent_overview:['人才概览','建设中'], talent_list:['梯队名单','建设中'], talent_perf:['梯队绩效','梯队盘点 · 九宫格 · 排名'],
  cadre_overview:['干部概览','建设中'], cadre_list:['干部名单','建设中'], cadre_perf:['干部绩效','建设中'],
  perf_overview:['绩效概览','建设中'], perf_alert:['绩效预警','建设中'],
  outsource_overview:['外包概览','建设中'], outsource_emp:['外包人员','建设中'], outsource_eval:['外包评价','建设中'],
};
/* 二级菜单归属（切换页面时自动展开对应分组并高亮） */
const PAGE_GROUPS = {
  people:'people', move:'people', employee:'people',
  recruit_overview:'recruit', recruit_need:'recruit',
  campus_overview:'campus', campus_need:'campus', campus_emp:'campus',
  talent_overview:'talent', talent_list:'talent', talent_perf:'talent',
  cadre_overview:'cadre', cadre_list:'cadre', cadre_perf:'cadre',
  perf_overview:'perf', perf_alert:'perf',
  outsource_overview:'outsource', outsource_emp:'outsource', outsource_eval:'outsource',
};
/* 一个菜单项承载多个现有页面（人员异动 = 人员流动 + 转正与合同；梯队绩效 = 旧梯队绩效盘点页） */
const PAGE_MULTI = { move:['turnover','ops'], talent_perf:['talent'] };
/* 未实现菜单 → 通用占位页 */
const PLACEHOLDER_PAGES = new Set([
  'recruit_overview','recruit_need',
  'campus_overview','campus_need','campus_emp',
  'talent_overview','talent_list',
  'cadre_overview','cadre_list','cadre_perf',
  'perf_overview','perf_alert',
  'outsource_overview','outsource_emp','outsource_eval',
]);
/* 每个占位页的说明（说明该模块将来会放什么数据，来自台账 sheet） */
const PLACEHOLDER_DESC = {
  recruit_overview:['招聘概览','招聘进度总览与达成情况。', '数据来源：招聘未达成需求 / 27届校招需求'],
  recruit_need:['招聘需求','招聘需求清单与缺口跟踪。', '数据来源：招聘未达成需求'],
  campus_overview:['校招概览','校招进度与批次总览。', '数据来源：27届校招需求 / 26届校招名单'],
  campus_need:['校招需求','校招需求计划与缺口。', '数据来源：27届校招需求'],
  campus_emp:['校招生','校招生名单与状态跟踪。', '数据来源：26届校招名单'],
  talent_overview:['人才概览','人才盘点总览与结构分布。', '数据来源：储备干部名单 / 高潜名单 / 人才梯队绩效'],
  talent_list:['梯队名单','人才梯队成员名单。', '数据来源：储备干部名单 / 高潜名单'],
  cadre_overview:['干部概览','C 型干部总览与结构分布。', '数据来源：C型干部名单 / 干部梯队绩效'],
  cadre_list:['干部名单','C 型干部名单。', '数据来源：C型干部名单'],
  cadre_perf:['干部绩效','C 型干部绩效盘点。', '数据来源：干部梯队26H1绩效考评明细'],
  perf_overview:['绩效概览','绩效等级分布与趋势总览。', '数据来源：人才/干部梯队绩效明细'],
  perf_alert:['绩效预警','末位绩效与改进名单。', '数据来源：绩效B-C人员情况'],
  outsource_overview:['外包概览','外包规模与成本结构。', '数据来源：外包人员 / 外包评价'],
  outsource_emp:['外包人员','外包人员名单。', '数据来源：外包人员'],
  outsource_eval:['外包评价','外包评价记录。', '数据来源：外包评价'],
};
function toggleNavGroup(headBtn) {
  const group = headBtn.closest('.nav-group');
  if (group) group.classList.toggle('open');
}
function renderPlaceholder(name) {
  const d = PLACEHOLDER_DESC[name] || [PAGE_TITLES[name] && PAGE_TITLES[name][0] || name, '', ''];
  const t = document.getElementById('phTitle');
  const desc = document.getElementById('phDesc');
  const hint = document.getElementById('phHint');
  if (t) t.textContent = d[0];
  if (desc) desc.textContent = d[1] || '该模块正在建设中，敬请期待。';
  if (hint) hint.textContent = d[2] || '';
}
function switchPage(name) {
  if (typeof closeFilterPopup === 'function') closeFilterPopup();
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === name));
  /* 高亮并自动展开所在二级分组 */
  const g = PAGE_GROUPS[name];
  document.querySelectorAll('.nav-group').forEach(el => {
    const inGroup = g && el.dataset.group === g;
    /* 只有点进某个分组的页才动展开/收起；总览等无分组页只清 head 高亮，
       不动用户的折叠状态（否则点一下总览所有分组全被改掉） */
    if (g) el.classList.toggle('open', inGroup);
    const head = el.querySelector('.nav-group-head');
    if (head) head.classList.toggle('active', inGroup);
  });
  if (PLACEHOLDER_PAGES.has(name)) renderPlaceholder(name);
  /* 占位页没有自己的 section，落到通用 #page-placeholder */
  const ids = PLACEHOLDER_PAGES.has(name) ? ['placeholder'] : (PAGE_MULTI[name] || [name]);
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('hidden', !ids.includes(p.id.replace('page-', ''))));
  const t = PAGE_TITLES[name] || [name, ''];
  document.getElementById('pageTitle').textContent = t[0];
  document.getElementById('pageBreadcrumb').textContent = t[1];
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('mobileOverlay').classList.remove('open');
  refreshAll();
  setTimeout(() => Object.values(chartInstances).forEach(c => c && c.resize && c.resize()), 80);
}
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('mobileOverlay').classList.toggle('open');
}

/* ── 全局刷新 ── */
function refreshAll() {
  // 只丢了台账文件时也要能看台账页，所以这里不能直接 return
  if (!rawData.length) { renderLedger(); return; }
  const filtered = getFiltered();
  const active = filtered.filter(d => d.status === '在职');
  const allActive = rawData.filter(d => d.status === '在职');
  /* 离职人数必须和「在职」用同一个筛选口径。
     以前这里是 rawData（全库离职），于是「各中心编制分布」的同一根堆叠柱里，
     在职那截是筛选后的人数、已离职那截却是全公司的人数 —— 两个数不同源 */
  const allLeavers = filtered.filter(d => d.status === '离职');
  const relevantAll = getScopeData();   // 不含日期/用工细筛的上下文（用于离职率分母）
  updateFilterStat();
  renderKpiCards(active, allActive, allLeavers);
  renderOverview(active, allActive, allLeavers, themeColors());
  renderPeople(active, allLeavers, themeColors());
  renderStructure(active, themeColors());
  renderDemographics(active, themeColors());
  renderTurnover(allLeavers, allActive, themeColors(), relevantAll);
  renderOps(active, themeColors());
  renderTalent(active, themeColors());
  renderHealth(active, themeColors());
  renderLedger();
  renderBrief(active, allActive, allLeavers, themeColors());
  renderAlerts();
  if (!document.getElementById('page-employee').classList.contains('hidden')) renderEmployeeTable();
}
/* 当前上下文（应用中心/部门/人群筛选，用于比率型指标的口径一致性） */
function getScopeData() {
  const centerFilter = document.getElementById('filterCenter').value;
  const deptFilter = document.getElementById('filterDept').value;
  const groupFilter = document.getElementById('filterGroup').value;
  return rawData.filter(d => {
    if (centerFilter !== 'all' && d.center !== centerFilter) return false;
    if (deptFilter !== 'all' && (d.deptEn || d.dept) !== deptFilter) return false;
    if (groupFilter !== 'all' && staffGroupOf(d) !== groupFilter) return false;
    return true;
  });
}

/* ── 主题 watcher（系统偏好变化时重绘） ── */
new MutationObserver(() => { if (rawData.length) refreshAll(); })
  .observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });

/* ── 从内联数据包加载（双击打开时的主路径） ── */
async function loadFromPack() {
  if (!hasPack()) return false;
  const P = window.HR_DATA;
  const stats = { empFiles:0, perfFiles:0, perfCount:0, ledgerFiles:0, added:0, updated:0, failed:[] };
  /* 顺序与 autoLoadFromDataDir 保持一致：台账 → 绩效 → 人员 */
  for (const [key, label] of [['ledger', '台账'], ['perf', '绩效'], ['emp', '人员']]) {
    const sheets = P.books[key];
    if (!sheets || !sheets.length) continue;
    try {
      stats.currentName = (key === 'emp') ? ((P.files && P.files.emp) || 'emp') : key;
      await ingestWorkbook(packSheetToWorkbook(sheets), stats);
    } catch (e) { stats.failed.push(label); console.warn('数据包「' + label + '」解析失败：', e); }
  }
  /* 手工数据源（HC 计划 / 指标目标 / 月度快照 / 招聘计划） */
  if (P.books.manual && P.books.manual.length) {
    try { loadDataSourceFromPack(packSheetToWorkbook(P.books.manual), (P.files && P.files.manual) || '内联数据包'); }
    catch (e) { console.warn('数据包「手工数据源」解析失败：', e); }
  }
  if (stats.perfCount > 0) attachPerfData();
  window.__lastPackStats = stats;
  return stats.empFiles > 0 || stats.perfCount > 0 || stats.ledgerFiles > 0;
}
function fmtBuilt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}

/* ── 顶栏「重新加载」：丢弃当前状态，从数据包重读一份干净的 ──
   人员数据在 ingestWorkbook 里是「按工号覆盖合并」进 rawData 的，
   如果重读前不清空，数据包里去掉了的人会永远残留在看板上 ——
   所以先重置再整份读；万一没读到，把原状态放回去，别把看板清空。 */
async function reloadDataSource() {
  const btn = document.getElementById('dsBtn');
  if (btn) btn.disabled = true;
  try {
    if (!hasPack()) { showToast('没有可用的数据包：assets/hr-data.js 未加载', true); return; }
    const backup = { rawData, perfData, perfMeta, perfFileLoaded, ledgerData, ledgerSavedAt };
    rawData = [];
    perfData = {}; perfMeta = { count: 0, centers: [] }; perfFileLoaded = false;
    ledgerData = null; ledgerSavedAt = null;
    _dirListing = null;
    let got = false;
    try { got = await loadFromPack(); } catch (e) { console.warn('数据包重读失败：', e.message || e); }
    if (got) {
      await onDataLoaded();
      const b = fmtBuilt(window.HR_DATA.built);
      showToast('已重新加载数据包' + (b ? '（生成于 ' + b + '）' : '') + '：人员 ' + rawData.length + ' 条');
    } else {
      ({ rawData, perfData, perfMeta, perfFileLoaded, ledgerData, ledgerSavedAt } = backup);
      attachPerfData();
      refreshAll();
      showToast('数据包读取失败，已保留当前数据', true);
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ═══════════ 数据维护：把当前数据写回文件 ═══════════
   双击打开看板时浏览器禁止 fetch 本地文件，但「用户点一下按钮」之后，
   浏览器允许我们读写用户指定的那个文件夹。于是更新数据这件事
   可以完全在页面里完成 —— 不需要 bat、不需要装 Python、不需要命令行。 */
function buildPackText(scope) {
  const base = (window.HR_DATA && window.HR_DATA.books) || {};
  const books = {
    emp:    _packedBooks.emp    || base.emp    || null,
    perf:   _packedBooks.perf   || base.perf   || null,
    ledger: _packedBooks.ledger || base.ledger || null,
    manual: _packedBooks.manual || base.manual || null,
  };
  const pack = {
    v: 1,
    scope: scope || 'full',
    built: new Date().toISOString(),
    files: Object.assign({}, (window.HR_DATA && window.HR_DATA.files) || {}),
    books,
  };
  return '/* 自动生成，请勿手动编辑。来源：data/ 目录下的 Excel */\n'
       + 'window.HR_DATA=' + JSON.stringify(pack) + ';\n';
}

/* IndexedDB 里存目录句柄：浏览器允许把「已授权的文件夹」记下来复用，
   所以第二次之后再点，不用重新选目录 */
async function idbGetKey(key) {
  try {
    const db = await idbOpen();
    return await new Promise(res => {
      const rq = db.transaction('kv').objectStore('kv').get(key);
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror = () => res(null);
    });
  } catch (e) { return null; }
}
async function idbSetKey(key, val) {
  try {
    const db = await idbOpen();
    db.transaction('kv', 'readwrite').objectStore('kv').put(val, key);
  } catch (e) {}
}
/* 取一个可写的目录句柄；null = 用户取消或浏览器不支持 */
async function pickDir(key, hint) {
  if (typeof window.showDirectoryPicker !== 'function') return null;
  let h = await idbGetKey(key);
  if (h) {
    try {
      let p = await h.queryPermission({ mode: 'readwrite' });
      if (p !== 'granted') p = await h.requestPermission({ mode: 'readwrite' });
      if (p === 'granted') return h;
    } catch (e) { /* 句柄失效，重新选 */ }
  }
  showToast(hint || '请在弹窗里选择文件夹');
  try {
    h = await window.showDirectoryPicker({ id: key, mode: 'readwrite', startIn: 'desktop' });
  } catch (e) { return null; }
  await idbSetKey(key, h);
  return h;
}
async function writeFileInDir(dir, name, text) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}

/* ① 把当前看板上的数据固化成数据包 → assets/hr-data.js */
async function saveDataPack() {
  if (!_packedBooks.emp && !_packedBooks.perf && !_packedBooks.ledger) {
    showToast('当前没有可保存的数据', true); return;
  }
  const text = buildPackText('full');
  try {
    const root = await pickDir('fs-dir:root', '请选择「HR看板」这个文件夹');
    if (!root) return;
    const assets = await root.getDirectoryHandle('assets', { create: true });
    await writeFileInDir(assets, 'hr-data.js', text);
    /* 写进去之后，内存里的 built 也要跟着更新：
       否则本次会话里再点「重新加载」会拿新的 built 去比旧快照，白白丢掉缓存 */
    try {
      if (window.HR_DATA) window.HR_DATA.built = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf(';'))).built;
    } catch (e) {}
    await saveSnapshot();
    showToast('已保存数据包 assets/hr-data.js（' + Math.round(text.length / 1024) + ' KB）· 下次双击打开就是这份数据');
    refreshDataPanel();
  } catch (e) {
    showToast('保存失败：' + (e.message || e), true);
  }
}

/* ② 裁出「仅 SWC」，导出给同事的分享版数据包 → 分享版/assets/hr-data.js
   empSheetsOverride：可选。传了就用这份人员数据裁（例如你单独维护的 SWC 花名册），
   否则用当前看板上的数据裁。
   rosterIds：可选。传了就是「工号白名单」模式 —— 只保留名单里的工号，
   与中心列无关（她手动维护的 SWC花名册就是干这个的）。
   不传则按「一级部门英文简称 === SWC」自动裁。 */
function buildSwcPackText(empSheetsOverride, rosterIds) {
  const TARGET = 'SWC';
  const base = (window.HR_DATA && window.HR_DATA.books) || {};
  const empSrc = empSheetsOverride || _packedBooks.emp || base.emp;
  if (!empSrc) return null;
  let kept = 0, dropped = 0;
  const others = new Set();
  const hitIds = new Set();
  const empOut = empSrc.map(([name, aoa]) => {
    let h = 0;
    for (let i = 0; i < Math.min(aoa.length, 10); i++) {
      if (aoa[i] && aoa[i].some(c => String(c).includes('员工编号'))) { h = i; break; }
    }
    const header = aoa[h] || [];
    const ci = header.findIndex(x => String(x).includes('一级部门英文简称'));
    const iId = header.findIndex(x => String(x).includes('员工编号'));
    const iName = header.findIndex(x => String(x).includes('员工姓名'));
    if (!rosterIds && ci < 0) { dropped++; return [name, aoa]; }  // 找不到中心列就原样带过（自检会判不合格）
    const keep = aoa.slice(h + 1).filter(r => {
      if (!r || !r.length) return false;
      if (!r[iId] && !r[iName]) return false;
      if (rosterIds) {
        const id = String(r[iId] == null ? '' : r[iId]).trim();
        if (id && rosterIds.has(id)) { kept++; hitIds.add(id); return true; }
        dropped++;
        return false;
      }
      const c = String(r[ci] == null ? '' : r[ci]).trim();
      if (c === TARGET) { kept++; return true; }
      dropped++;
      if (c) others.add(c);
      return false;
    });
    return [name, aoa.slice(0, h + 1).concat(keep)];
  });
  /* 绩效按 SWC 工号白名单裁 */
  const ids = new Set();
  empOut.forEach(([, aoa]) => {
    const header = aoa[0] || [];
    const iId = header.findIndex(x => String(x).includes('员工编号'));
    if (iId >= 0) aoa.slice(1).forEach(r => { if (r && r[iId]) ids.add(String(r[iId]).trim()); });
  });
  const perfSrc = _packedBooks.perf || base.perf;
  const perfOut = perfSrc ? perfSrc.map(([name, aoa]) => {
    let h = -1, iId = -1, iCenter = -1;
    for (let i = 0; i < Math.min(aoa.length, 12); i++) {
      if (!aoa[i]) continue;
      const c = aoa[i].findIndex(x => /工号|员工编号/.test(String(x)));
      if (c >= 0) { h = i; iId = c; iCenter = aoa[i].findIndex(x => /中心/.test(String(x))); break; }
    }
    if (h < 0) return [name, aoa];
    const body = aoa.slice(h + 1).filter(r => {
      if (!r || !r.length) return false;
      if (iCenter >= 0) {
        const c = String(r[iCenter] == null ? '' : r[iCenter]).trim();
        if (c) return c === TARGET;
      }
      const id = String(r[iId] == null ? '' : r[iId]).trim();
      return id ? ids.has(id) : false;
    });
    const tail = aoa.slice(h + 1)
      .filter(r => !r || !r.length || !String(r[iId] == null ? '' : r[iId]).trim()).slice(0, 12);
    return [name, aoa.slice(0, h + 1).concat(body, tail.length ? [['']].concat(tail) : [])];
  }) : null;

  const books = {
    emp: empOut, perf: perfOut,
    ledger: _packedBooks.ledger || base.ledger || null,
    manual: _packedBooks.manual || base.manual || null,
  };
  const pack = { v: 1, scope: 'swc', built: new Date().toISOString(),
    files: Object.assign({}, (window.HR_DATA && window.HR_DATA.files) || {}), books };
  const text = '/* 自动生成，请勿手动编辑。分享版：只含 SWC 中心 */\n'
             + 'window.HR_DATA=' + JSON.stringify(pack) + ';\n';
  /* 安全自检：判据只有一个 —— 
       白名单模式：产出的每一行，工号必须在名单里；
       自动模式：决定中心归属的那一列的值必须是 SWC。
     千万不要对整个 JSON 做全文正则：别的字段里会出现与中心简称同名的值，
     成本中心描述里也可能包含其他中心的字样 —— 全文扫会一堆误报，
     结果就是每次都判定「有泄漏」、分享版永远导不出去。 */
  let leak = 0;
  empOut.forEach(([name, aoa]) => {
    let h = 0;
    for (let i = 0; i < Math.min(aoa.length, 10); i++) {
      if (aoa[i] && aoa[i].some(c => String(c).includes('员工编号'))) { h = i; break; }
    }
    const header = aoa[h] || [];
    const ci = header.findIndex(x => String(x).includes('一级部门英文简称'));
    const iId = header.findIndex(x => String(x).includes('员工编号'));
    if (rosterIds) {
      if (iId < 0) { leak++; return; }
      aoa.slice(h + 1).forEach(r => {
        if (!r || !r.length) return;
        const id = String(r[iId] == null ? '' : r[iId]).trim();
        if (!id || !rosterIds.has(id)) leak++;
      });
      return;
    }
    if (ci < 0) { leak++; return; }          // 找不到中心列 —— 无法保证只有 SWC，按不合格处理
    aoa.slice(h + 1).forEach(r => {
      if (!r || !r.length) return;
      if (String(r[ci] == null ? '' : r[ci]).trim() !== TARGET) leak++;
    });
  });
  const missIds = rosterIds ? [...rosterIds].filter(x => !hitIds.has(x)) : [];
  return { text, kept, dropped, others: [...others].sort(), leak, missIds, mode: rosterIds ? 'roster' : 'center' };
}

/* 写分享版数据包（导出分享版 / 用花名册导出 / 用指定文件导出，三条路共用） */
async function writeSharePack(empSheetsOverride, sourceLabel, rosterIds) {
  const r = buildSwcPackText(empSheetsOverride, rosterIds);
  if (!r) { showToast('没有可用的名单，无法生成分享版', true); return; }
  if (r.kept === 0) {
    showToast(rosterIds
      ? '裁剪后一个人都没有：SWC花名册里的工号在人员数据里一个都没匹配上（核对「员工编号」列）'
      : '裁剪后一个人都没有：这份数据里不含 SWC 中心（检查「一级部门英文简称」列）', true);
    return;
  }
  if (r.leak > 0) {
    showToast(r.mode === 'roster'
      ? '自检未通过：产物里有工号不在花名册内，已中止导出'
      : '自检未通过：产物里出现了其他中心的数据，已中止导出', true);
    return;
  }
  try {
    const dir = await pickDir('fs-dir:share', '请选择「分享版」这个文件夹');
    if (!dir) return;
    const assets = await dir.getDirectoryHandle('assets', { create: true });
    await writeFileInDir(assets, 'hr-data.js', r.text);
    showToast('分享版数据已更新'
      + (sourceLabel ? '（来源：' + sourceLabel + '）' : '')
      + '：保留 ' + r.kept + ' 人 · 剔除 ' + r.dropped + ' 行'
      + (r.mode === 'center' ? ' / ' + r.others.length + ' 个其他中心' : '')
      + (r.missIds && r.missIds.length ? ' · ⚠ 花名册有 ' + r.missIds.length + ' 个工号在人员数据里没找到' : '')
      + ' · 把「分享版」整个文件夹打包发给同事即可');
    refreshDataPanel();
  } catch (e) {
    showToast('导出失败：' + (e.message || e), true);
  }
}
async function exportSharePack() { await writeSharePack(null, null, null); }

/* 用汇总表里的「SWC人员名单」导出分享版 —— 不用选文件，
   名单跟着数据包一起进来了（用户从 KPA 手动复制维护）。
   删掉名单里的某一行 = 分享版不再包含这个人。
   名单为空或没找到时，回落到按「一级部门英文简称 === SWC」自动裁剪。 */
async function exportSharePackByRoster() {
  const ids = rosterIdsFromPack();
  if (!ids) {
    showToast('没找到 SWC人员名单（或名单是空的），改用「一级部门英文简称」自动裁剪');
    await writeSharePack(null, null, null);
    return;
  }
  await writeSharePack(null, 'SWC人员名单 ' + ids.size + ' 人', ids);
}

/* 用一份指定的 Excel 导出分享版（比花名册更临时：比如这次只想发某几个部门）
   —— 只读取这份文件来裁，不动当前看板上已加载的数据。 */
function exportSharePackWithFile() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.xls,.xlsx';
  input.onchange = async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    try {
      const wb = await readWorkbook(f);
      /* 判断这份文件是「工号名单」还是「完整人员数据」：
         有「一级部门英文简称」列就当完整数据按中心裁，
         只有「员工编号」就当白名单。 */
      const sheets = wbToPack(wb);
      let hasCenter = false;
      (sheets || []).forEach(([, aoa]) => {
        for (let i = 0; i < Math.min(aoa.length, 10); i++) {
          if (aoa[i] && aoa[i].some(c => String(c).includes('一级部门英文简称'))) { hasCenter = true; break; }
        }
      });
      if (hasCenter) await writeSharePack(sheets, f.name, null);
      else {
        const ids = new Set();
        (sheets || []).forEach(([, aoa]) => {
          let h = 0;
          for (let i = 0; i < Math.min(aoa.length, 6); i++) {
            if (aoa[i] && aoa[i].some(c => String(c).includes('员工编号'))) { h = i; break; }
          }
          const iId = (aoa[h] || []).findIndex(c => String(c).includes('员工编号'));
          if (iId < 0) return;
          aoa.slice(h + 1).forEach(r => {
            const v = String((r && r[iId]) == null ? '' : r[iId]).trim();
            if (v) ids.add(v);
          });
        });
        if (!ids.size) { showToast('这份文件里没找到「员工编号」列', true); return; }
        await writeSharePack(null, f.name + '（白名单 ' + ids.size + ' 人）', ids);
      }
    } catch (e) {
      showToast('读取失败：' + (e.message || e), true);
    }
  };
  input.click();
}

/* ③ 直接从 data/ 文件夹读取（授权一次，之后长期复用）
   file:// 下 fetch 读不了本地文件，但「用户亲手授权过的文件夹」可以读。
   这是日常更新数据最省事的一条路：改完 Excel 点一下就读到了 ——
   既不用把文件拖进来，也不用重新生成数据包。 */
async function reloadFromDataFolder() {
  if (typeof window.showDirectoryPicker !== 'function') {
    showToast('当前浏览器不支持选择文件夹，请用 Chrome / Edge 打开', true); return;
  }
  let h = await idbGetKey('fs-dir:data');
  if (h) {
    try {
      let p = await h.queryPermission({ mode: 'read' });
      if (p !== 'granted') p = await h.requestPermission({ mode: 'read' });
      if (p !== 'granted') h = null;
    } catch (e) { h = null; }
  }
  if (!h) {
    showToast('请选择「HR看板」里的 data 文件夹');
    try { h = await window.showDirectoryPicker({ id: 'fs-dir:data', mode: 'read', startIn: 'desktop' }); }
    catch (e) { return; }
    await idbSetKey('fs-dir:data', h);
  }
  const files = [];
  try {
    for await (const ent of h.values()) {
      if (ent.kind !== 'file') continue;
      if (!/\.(xlsx|xls)$/i.test(ent.name) || ent.name.startsWith('~$')) continue;
      files.push(await ent.getFile());
    }
  } catch (e) { showToast('读取文件夹失败：' + (e.message || e), true); return; }
  if (!files.length) { showToast('这个文件夹里没有 Excel 文件', true); return; }

  /* 按文件名分类。同一类有多份时取「修改时间最新」的一份
     —— 导出文件名带时间戳，拿错一份会静默读过时数据。 */
  const newest = arr => arr.sort((a, b) => b.lastModified - a.lastModified)[0];
  const cons       = newest(files.filter(f => /^HR看板数据源\.xlsx$/i.test(f.name)));
  const kpa        = newest(files.filter(f => /^KPA.*\.xls$/i.test(f.name)));
  const perfOrig   = newest(files.filter(f => /绩效考评结果汇总.*\.xlsx$/i.test(f.name)));
  const ledgerOrig = newest(files.filter(f => /人才现状.*\.xlsx$/i.test(f.name)));
  const legacyDs   = newest(files.filter(f => /^看板数据源\.xlsx$/i.test(f.name)));

  /* 清空后整份重读：不清空的话，新导出里被删掉的人会永远留在看板上 */
  const backup = { rawData, perfData, perfMeta, perfFileLoaded, ledgerData, ledgerSavedAt };
  rawData = [];
  perfData = {}; perfMeta = { count: 0, centers: [] }; perfFileLoaded = false;
  ledgerData = null; ledgerSavedAt = null;
  _dirListing = null;

  const stats = { empFiles:0, perfFiles:0, perfCount:0, ledgerFiles:0, added:0, updated:0, failed:[] };
  try {
    /* ① 汇总表：台账 / 绩效 / 手工表 / 花名册 都从它来 */
    if (cons) {
      const wb = await readWorkbook(cons);
      if (looksLikeConsolidated(wb)) await ingestConsolidated(wb, stats);
      else stats.failed.push(cons.name);
    }
    /* ② 人员：**KPA 原文件优先**。汇总表里的「人员数据」是给 Excel 版看板用的副本，
       原表更新鲜；ingestWorkbook 按工号覆盖合并，所以这里会盖掉副本里的同一人。
       原文件不在时才只用副本。 */
    if (kpa) {
      stats.currentName = kpa.name;
      await ingestWorkbook(await readWorkbook(kpa), stats);
    }
    /* ③ 没有汇总表时的兜底：按旧习惯分别认那几份原文件 */
    if (!cons) {
      if (perfOrig) { stats.currentName = perfOrig.name; await ingestWorkbook(await readWorkbook(perfOrig), stats); }
      if (ledgerOrig) { stats.currentName = ledgerOrig.name; await ingestWorkbook(await readWorkbook(ledgerOrig), stats); }
      if (legacyDs) {
        const ds = parseDataSourceWorkbook(await readWorkbook(legacyDs));
        ds.file = legacyDs.name;
        adoptDataSource(ds, true);
      }
    }
    /* 记下这次的数据来源，供「保存为数据包」写进 files、面板展示 */
    if (!window.HR_DATA) window.HR_DATA = { v: 1, books: {} };
    window.HR_DATA.files = Object.assign({}, window.HR_DATA.files, {
      emp:    kpa ? kpa.name : (cons ? CONSOLIDATED_NAME + '（人员数据 sheet）' : undefined),
      perf:   cons ? CONSOLIDATED_NAME + '（绩效 sheet）' : (perfOrig ? perfOrig.name : undefined),
      ledger: cons ? CONSOLIDATED_NAME + '（台账 sheet）' : (ledgerOrig ? ledgerOrig.name : undefined),
      manual: cons ? CONSOLIDATED_NAME : (legacyDs ? legacyDs.name : undefined),
    });
  } catch (e) { showToast('读取失败：' + (e.message || e), true); }

  if (stats.perfCount > 0) attachPerfData();
  if (!rawData.length && !perfMeta.count && !ledgerData) {
    ({ rawData, perfData, perfMeta, perfFileLoaded, ledgerData, ledgerSavedAt } = backup);
    attachPerfData(); refreshAll();
    showToast('没从文件夹里认出任何数据文件，已保留原数据', true);
  } else {
    await onDataLoaded();
    const bits = [];
    if (rawData.length) bits.push('人员 ' + rawData.length + ' 条' + (stats.updated ? '（更新 ' + stats.updated + ' 条）' : ''));
    if (stats.perfCount) bits.push('绩效 ' + stats.perfCount + ' 条');
    if (stats.ledgerFiles) bits.push('台账 ' + ledgerBoardCount() + ' 块');
    showToast('已从文件夹重新读取：' + bits.join(' · ')
      + (cons ? '（数据来自 ' + CONSOLIDATED_NAME + '）' : ''));
  }
}

/* ④ 数据维护面板 */
function toggleDataPanel(force) {
  const el = document.getElementById('dataPanel');
  const ov = document.getElementById('dataPanelOverlay');
  if (!el) return;
  const show = (force === undefined) ? el.classList.contains('hidden') : !!force;
  el.classList.toggle('hidden', !show);
  if (ov) ov.classList.toggle('hidden', !show);   // 遮罩要和面板一起显隐，否则点外面关不掉
  if (show) refreshDataPanel();
}
function refreshDataPanel() {
  const el = document.getElementById('dataPanel');
  if (!el) return;
  const P = window.HR_DATA || {};
  const g = groupCounts(rawData.filter(d => d.status === '在职'));
  const roster = rosterIdsFromPack();
  const rows = [
    ['数据包生成时间', P.built ? fmtBuilt(P.built) + '（' + (P.scope === 'swc' ? '仅 SWC' : '全量') + '）' : '未加载数据包'],
    ['当前人员', rawData.length + ' 条 · 在职 ' + g.formal + ' 正式 / ' + g.intern + ' 实习 / ' + g.outsource + ' 外协'],
    ['绩效', perfFileLoaded ? perfMeta.count + ' 人' : '未加载'],
    ['台账', ledgerData ? ledgerBoardCount() + ' 块' : '未加载'],
    ['手工数据源', dsData.loaded ? ('编制 ' + dsData.budget.length + ' · 目标 ' + Object.keys(dsData.targets).length + ' · 快照 ' + dsData.monthly.length + ' · 招聘 ' + dsData.recruitPlan.length) : '未加载'],
    ['SWC人员名单', roster ? roster.size + ' 人（分享版按此名单裁）' : '未找到 / 空'],
    ['来源文件', [P.files && P.files.emp, P.files && P.files.perf, P.files && P.files.ledger].filter(Boolean).join(' · ') || '—'],
  ];
  document.getElementById('dataPanelInfo').innerHTML = rows
    .map(([k, v]) => `<div class="dp-row${k === '来源文件' ? ' stacked' : ''}"><span>${esc(k)}</span><b>${esc(String(v))}</b></div>`).join('');
  const unsupported = typeof window.showDirectoryPicker !== 'function';
  document.querySelectorAll('#dataPanel .dp-need-fs').forEach(b => {
    b.disabled = unsupported;
    b.title = unsupported ? '当前浏览器不支持直接写文件，请用 Chrome / Edge 打开' : '';
  });
  const btn = document.getElementById('dpSavePack');
  if (btn) btn.disabled = unsupported || (!_packedBooks.emp && !_packedBooks.perf && !_packedBooks.ledger);
  document.getElementById('dataPanelNote').textContent = unsupported
    ? '当前浏览器不支持「直接读写文件」能力，涉及写文件的功能不可用（用 Chrome 或 Edge 打开即可）。拖 Excel 进页面的方式不受影响。'
    : '日常你只需要维护 data/SWC人力看板.xlsx 这一个 Excel（人员花名册基准是 data/ 的 KPA*.xls）：改完点最上面那条「从 data 文件夹读取最新数据」即可。'
      + '（也可以直接拖 Excel 进页面，或把当前数据保存成数据包让改动长期生效）';
}


/* ── 兜底：从 data/ 目录自动加载 ──
   只在「用本地 http 服务打开」时走得到这条；双击打开走数据包，不需要它。

   2026-09-12 起优先读汇总表 data/HR看板数据源.xlsx（一个文件装全部），
   读不到再按文件名认那几份原文件：
     KPA*.xls            → 人员主数据（**人员始终以这份为准**）
     *绩效考评结果汇总*.xlsx → 绩效
     *人才现状*.xlsx       → 台账

   读不到就静默返回 false，回落到「等待上传」界面 —— 双击打开（file://）时
   fetch 必然失败，但那时走的是数据包，正常情况下根本走不到这里。 */
/* 注意：看板.html 就在项目根，数据文件在同级 data/ 下，相对路径直接写 data/ 即可。 */
const DATA_FILES = (typeof window !== 'undefined' && window.HR_DATA_FILES) || {
  cons:   'data/HR看板数据源.xlsx',
  emp:    'data/KPA0635-001-20260910180137.xls',
  perf:   'data/附件1-2026H1绩效考评结果汇总 - SWC.xlsx',
  ledger: 'data/SWC最新人才现状-0909.xlsx',
};
async function fetchWorkbook(rel) {
  const resp = await fetch(rel + '?t=' + Date.now(), { cache: 'no-store' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const buf = await resp.arrayBuffer();
  return XLSX.read(new Uint8Array(buf), { type:'array', cellDates:false });
}

/* ── 目录兜底发现 ───────────────────────────────────────────────
   固定文件名只是「默认猜测」。KPA 导出的文件名带时间戳，用户换新导出后
   往往会删掉旧的，这时固定名就 404 了 —— 以前会静默变成「数据全空」。
   这里在固定名取不到时，退一步去读 data/ 的目录列表（本地 http 服务的
   目录索引会返回 HTML 列表），按模式匹配、取日期戳最新的那份。
   分享版把 DATA_FILES 指到同目录 data/，所以目录前缀从配置里推导，不能写死。 */
const DATA_DIR = (DATA_FILES.emp || '../data/x').replace(/[^/]*$/, '');
let _dirListing = null;
async function listDataDir() {
  if (_dirListing) return _dirListing;
  const resp = await fetch(DATA_DIR + '?t=' + Date.now(), { cache: 'no-store' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const html = await resp.text();
  const out = [];
  const re = /href="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    let n = m[1].split('/').pop().split('?')[0];
    try { n = decodeURIComponent(n); } catch (e) { /* 保留原样 */ }
    if (n && n !== '.' && n !== '..') out.push(n);
  }
  if (!out.length) throw new Error('目录列表为空（服务未开启目录索引）');
  _dirListing = out;
  return out;
}
/* 文件名里的日期戳越大越新；没有数字就用文件名本身比 */
function _stamp(n) {
  const m = String(n).match(/\d{4,}/g);
  return m ? m[m.length - 1] : String(n);
}
/* 先试固定名（以及本会话上次发现的名字），失败再按模式找；返回 { rel, wb } */
const _resolvedFile = {};
async function fetchDataFile(key, pattern) {
  const tries = [];
  if (_resolvedFile[key]) tries.push(_resolvedFile[key]);
  if (DATA_FILES[key] && DATA_FILES[key] !== _resolvedFile[key]) tries.push(DATA_FILES[key]);
  for (const rel of tries) {
    try { return { rel, wb: await fetchWorkbook(rel) }; }
    catch (e) { /* 继续下一个 */ }
  }
  const names = (await listDataDir()).filter(n => pattern.test(n) && !n.startsWith('~$') && !n.startsWith('.'));
  if (!names.length) throw new Error('未找到匹配 ' + pattern + ' 的文件');
  names.sort((a, b) => { const x = _stamp(a), y = _stamp(b); return x < y ? 1 : x > y ? -1 : 0; });
  const rel = DATA_DIR + names[0];
  _resolvedFile[key] = rel;      /* 记住，避免同一会话里每次都先撞一次 404 */
  if (typeof console !== 'undefined') console.info('[data/] 固定名未命中，自动改用：' + names[0]);
  return { rel, wb: await fetchWorkbook(rel) };
}

async function autoLoadFromDataDir() {
  const stats = { empFiles:0, perfFiles:0, perfCount:0, ledgerFiles:0, added:0, updated:0, failed:[] };
  let got = false;

  /* ① 汇总表优先 */
  if (DATA_FILES.cons) {
    try {
      const wb = await fetchWorkbook(DATA_FILES.cons);
      if (looksLikeConsolidated(wb)) { await ingestConsolidated(wb, stats); got = true; }
    } catch (e) { /* 没这份就按原文件认 */ }
  }
  /* ② 人员：KPA 原文件优先（和「从 data 文件夹读取」同一条规则） */
  try {
    const r = await fetchDataFile('emp', /^KPA.*\.xls$/i);
    stats.currentName = r.rel;
    await ingestWorkbook(r.wb, stats);
    got = got || stats.empFiles > 0;
  } catch (e) { if (!got) stats.failed.push('人员数据'); }
  /* ③ 绩效 / 台账：汇总表里没有时才读原文件 */
  if (!stats.perfFiles) {
    try {
      const r = await fetchDataFile('perf', /绩效考评结果汇总.*\.xlsx$/i);
      stats.currentName = r.rel;
      await ingestWorkbook(r.wb, stats);
      got = got || stats.perfFiles > 0;
    } catch (e) { if (!got) stats.failed.push('绩效数据'); }
  }
  if (!stats.ledgerFiles) {
    try {
      const r = await fetchDataFile('ledger', /人才现状.*\.xlsx$/i);
      stats.currentName = r.rel;
      await ingestWorkbook(r.wb, stats);
      got = got || stats.ledgerFiles > 0;
    } catch (e) { if (!got) stats.failed.push('台账数据'); }
  }

  if (stats.perfCount > 0) attachPerfData();
  if (got) {
    await onDataLoaded();
    const bits = [];
    if (stats.empFiles) bits.push(`人员 ${rawData.length} 条`);
    if (stats.perfCount) bits.push(`绩效 ${stats.perfCount} 条`);
    if (stats.ledgerFiles) bits.push(`台账 ${ledgerData ? ledgerBoardCount() : 0} 块`);
    showToast('已从 data/ 自动加载：' + bits.join(' · '));
  }
  return got;
}

/* ── 启动：数据包 / 本地快照 / 等待拖入 ── */
(function init() {
  syncThemeBtn();
  const zone = document.getElementById('uploadZone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });
  document.getElementById('fileInput').addEventListener('change', e => e.target.files.length && handleFiles(e.target.files));
  document.getElementById('folderPicker').addEventListener('change', e => e.target.files.length && handleFiles(e.target.files));

  /* 优先级：
       ① 内联数据包（assets/hr-data.js）—— data/ 里的 Excel 更新、数据包也重新生成过时，
          数据包的 built 时间戳会变，此时旧快照作废，直接读新的
       ② 本地快照（IndexedDB）—— 「接着上次看到的地方」，也是拖入新数据后的暂存
       ③ 都没有：停在拖入界面，等用户拖 Excel 进来
     点顶栏「重新加载」= 丢弃快照、回到数据包。 */
  restoreSnapshot().then(async snap => {
    const packBuilt = (window.HR_DATA && window.HR_DATA.built) || null;
    const snapStale = !!(snap && packBuilt && snap.packBuilt !== packBuilt);
    if (snap && snap.rawData && snap.rawData.length && !snapStale) {
      /* 手工数据源独立于人员数据，先把它的状态准备好，onDataLoaded 里统一重绘 */
      if (hasPack() && window.HR_DATA.books && window.HR_DATA.books.manual) {
        try { loadDataSourceFromPack(packSheetToWorkbook(window.HR_DATA.books.manual),
          (window.HR_DATA.files && window.HR_DATA.files.manual) || '内联数据包'); } catch (e) {}
      } else {
        loadDataSource(true);
      }
      rawData = snap.rawData; perfData = snap.perfData || {};
      perfMeta = snap.perfMeta || { count:0, centers:[] };
      perfFileLoaded = !!snap.perfFileLoaded;
      ledgerData = snap.ledgerData || null;
      ledgerSavedAt = snap.ledgerSavedAt || null;
      dataSavedAt = snap.savedAt || null;
      rawData.forEach(d => { d.group = staffGroupOf(d); });
      attachPerfData();
      onDataLoaded(true);
      showToast(window.HR_SHARED
        ? `已恢复上次查看的数据（${snap.savedAt || '未知时间'}）`
        : `已恢复上次的数据（${snap.savedAt || '未知时间'}）· 想回到数据包请点顶栏「数据维护」`);
      return;
    }
    /* 从数据包加载 —— 双击打开看板走的就是这条 */
    let ok = false;
    try { ok = await loadFromPack(); if (ok) await onDataLoaded(); }
    catch (e) { console.warn('数据包加载失败：', e.message || e); }
    if (!ok) {
      /* 兜底：万一没有数据包，用本地 http 服务打开时还能从 data/ 直接读 */
      let got = false;
      try { got = await autoLoadFromDataDir(); } catch (e) { console.warn('data/ 自动加载失败：', e.message || e); }
      if (!got) { loadDataSource(true); dsUpdateStatusUI(); }
    }
  });
})();
