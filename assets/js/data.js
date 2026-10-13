/* ═══════════════════════════════════════════════════════════════
   v8 data.js — IndexedDB 持久化 · 文件上传解析 · 筛选器 · 页面切换
   ═══════════════════════════════════════════════════════════════ */

/* ── IndexedDB 本地缓存（刷新免重传） ── */
/* 库名可被 window.HR_IDB_NAME 覆盖（兼容机制，内部版默认不用） */
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
function packSheetToWorkbook(sheets) {
  const wb = { SheetNames: [], Sheets: {} };
  for (const [name, aoa] of (sheets || [])) {
    if (!name) continue;
    wb.SheetNames.push(name);
    try { wb.Sheets[name] = XLSX.utils.aoa_to_sheet(aoa || []); } catch (e) {}
  }
  return wb;
}
function hasPack() {
  return !!(typeof window !== 'undefined' && window.HR_DATA && window.HR_DATA.books && window.HR_DATA.books.emp);
}

/* 台账工作簿识别（汇总表里的台账 sheet，按关键字认表） */
const LEDGER_SIGNALS = ['组织架构','人员情况','校招需求','外包名单','外包评价','入职名单','招聘未达成','储备干部','高潜','部门梯队','C型干部','校招名单','OD名单'];
function looksLikeLedger(wb) {
  return wb.SheetNames.filter(sn => LEDGER_SIGNALS.some(s => sn.includes(s))).length >= 2;
}

/* ═══════════ 汇总表（data/ 下手工维护的那张，表名见 bu-config.js 的 book）═══════════
   用户手工维护的唯一原数据表（13 张 sheet），人员花名册基准仍是 data/KPA*.xls：
     花名册 sheet（用户从 KPA 手动复制维护） /
     干部梯队·人才梯队 26H1绩效考评明细 / 绩效B-C人员情况 /
     C型干部名单 · 储备干部名单 · 高潜名单 · 招聘未达成需求 · 27届校招需求 ·
     26届校招名单 · 本年度入职名单 · 外包评价 · 部门梯队
   解析器各自只认自己那几张 sheet，所以先把整份拆成子工作簿再喂进去 ——
   直接把整份丢给 ingestWorkbook 会被 looksLikeLedger() 命中（里面躺着 9+ 张台账 sheet），
   整个文件被当成台账处理，人员数据一条都读不到。

   ⚠ 这一组谓词必须和 工具/生成数据包.js 里的 SHEET 逐字一致，
     否则「生成数据包」和「从 data 文件夹读取」会读出不同结果。
   ⚠ isRosterSheet 的花名册名必须**锚定 sheet 名开头**（名单见 bu-config.js 的 rosterSheet）：
     本年度入职名单 / 高潜名单 / C型干部名单 都含「名单」，
     宽松匹配会把它们误当花名册。 */
const CONSOLIDATED_NAME = BU.book;
const isEmpSheet    = sn => /^人员数据/.test(sn);
const isPerfSheet   = sn => /绩效考评明细/.test(sn);
const isRosterSheet = sn => BU.rosterSheet.test(sn) || /花名册/.test(sn);
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
    } catch (e) { console.warn('汇总表·台账解析失败：', e); }
  }
  /* ② 绩效 */
  const pw = subWorkbook(wb, isPerfSheet);
  if (pw.SheetNames.length) {
    try {
      const nc = parsePerfWorkbook(pw);
      if (nc > 0) { stats.perfCount += nc; perfFileLoaded = true; stats.perfFiles++; }
    } catch (e) { console.warn('汇总表·绩效解析失败：', e); }
  }
  /* ③ 人员（走通用识别，保留「按工号覆盖合并」的语义） */
  const ew = subWorkbook(wb, isEmpSheet);
  if (ew.SheetNames.length) {
    stats.currentName = CONSOLIDATED_NAME;
    await ingestWorkbook(ew, stats);
  }
  /* ④ 手工四张表 + 花名册 */
  const mw = subWorkbook(wb, sn => isManualSheet(sn) || isRosterSheet(sn));
  if (mw.SheetNames.length) {
    try {
      const ds = parseDataSourceWorkbook(mw);
      ds.file = CONSOLIDATED_NAME;
      adoptDataSource(ds, true);
    } catch (e) { console.warn('汇总表·手工数据源解析失败：', e); }
  }
}
async function ingestWorkbook(wb, stats) {
  // ① 台账文件优先识别
  if (looksLikeLedger(wb)) {
    ledgerData = parseLedgerWorkbook(wb);
    ledgerSavedAt = nowStamp();
    stats.ledgerFiles++;
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
        break;
      }
    }
  }
  // ③ 绩效文件
  if (!isEmp || /绩效|perf/i.test(stats.currentName || '')) {
    const nc = parsePerfWorkbook(wb);
    if (nc > 0) { stats.perfCount += nc; perfFileLoaded = true; stats.perfFiles++; }
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

/* 顶栏「上传数据」：单一入口，多选文件 / 整份汇总表都走 handleFiles。
   识别在 ingestWorkbook 里（台账 → 人员 → 绩效依次判定），
   所以不必再让用户先选对「这是人员还是绩效」——选错按钮比不识别更糟 */
function uploadData() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.xls,.xlsx'; input.multiple = true;
  input.onchange = () => input.files.length && handleFiles(input.files);
  input.click();
}

/* ── 数据就绪 ── */
async function onDataLoaded(restored) {
  document.getElementById('page-upload').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  buildDeptPairs();                 // 部门标签须先于筛选器填充
  populateStaticFilters();
  refreshFilterOptions('__init__');
  lockDefaultCenter();              // 默认锁定本部门（可在筛选器切换）
  if (!restored) dataSavedAt = nowStamp();
  refreshAll();
  if (!restored) await saveSnapshot();
}
/* 默认中心锁定本部门：仅当当前为「全部」且数据里存在本部门代号 */
function lockDefaultCenter(force) {
  const sel = document.getElementById('filterCenter');
  if (!sel) return;
  const hasTarget = [...sel.options].some(o => o.value === BU.code);
  if (hasTarget && (force || sel.value === 'all')) {
    sel.value = BU.code;
    refreshFilterOptions('center');
  }
}

/* ── 筛选器（人群/用工合并 + 4 维互联）──
   2026-10-13：人群与用工类型合并为一个下拉（optgroup 分组，用工值带 t: 前缀），
   筛选栏收成一行（用户要求） */
const FILTER_DEFS = [
  { key:'group',    id:'filterGroup',    fn: d => staffGroupOf(d), labelFn: v => GROUP_LABEL[v] || v, isGroup:true },
  { key:'status',   id:'filterStatus',   fn: d => d.status },
  { key:'center',   id:'filterCenter',   fn: d => d.center },
  { key:'dept',     id:'filterDept',     fn: d => d.deptEn || d.dept },
  { key:'location', id:'filterLocation', fn: d => d.workLocation },
];
/* 't:试用期' → 所属人群；普通值原样返回（effFlowType / 结构分布区共用） */
function groupFilterVal(g) {
  return g && g.startsWith('t:') ? (staffGroupOf({ empType: g.slice(2) }) || 'all') : g;
}
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
    if (f.group !== 'all') {
      if (f.group.startsWith('t:')) { if (d.empType !== f.group.slice(2)) return false; }
      else if (staffGroupOf(d) !== f.group) return false;
    }
    if (f.status !== 'all' && d.status !== f.status) return false;
    if (f.center !== 'all' && d.center !== f.center) return false;
    if (f.dept !== 'all' && (d.deptEn || d.dept) !== f.dept) return false;
    if (f.location !== 'all' && d.workLocation !== f.location) return false;
    if (f.fromDate && (!d.joinDate || d.joinDate < f.fromDate)) return false;
    if (f.toDate && (!d.joinDate || d.joinDate > f.toDate)) return false;
    return true;
  });
}
/* 人群/用工合并下拉：optgroup 分组，值 = 人群key 或 't:用工类型' */
function buildGroupFilter(sel) {
  const cur = sel.value;
  const typeVals = [...new Set(rawData.map(d => d.empType).filter(Boolean))].sort();
  let html = '<option value="all">全部</option>' +
    '<optgroup label="按人群">' + GROUP_ORDER.map(v => `<option value="${v}">${esc(GROUP_LABEL[v] || v)}</option>`).join('') + '</optgroup>';
  if (typeVals.length) html += '<optgroup label="按用工类型">' + typeVals.map(v => `<option value="t:${esc(v)}">${esc(v)}</option>`).join('') + '</optgroup>';
  sel.innerHTML = html;
  sel.value = (cur && [...sel.options].some(o => o.value === cur)) ? cur : 'all';
}
function populateStaticFilters() {
  const statusSel = document.getElementById('filterStatus');
  statusSel.innerHTML = '<option value="all">全部</option><option>在职</option><option>离职</option>';
}
function refreshFilterOptions(changedKey) {
  FILTER_DEFS.forEach(f => {
    if (f.key === changedKey) return;
    const sel = document.getElementById(f.id);
    if (!sel) return;
    if (f.key === 'group') { buildGroupFilter(sel); return; }   // 合并下拉：静态分组结构
    const data = getFiltered(f.key);
    const vals = [...new Set(data.map(f.fn).filter(Boolean))].sort();
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
    `${filtered.length} 人 · 在职 ${act.length}（正${g.formal}/实${g.intern}/外${g.outsource}）· 全库 ${rawData.length}`;
}

/* ── 页面切换 ──
   只存顶栏标题（副标题随 #pageBreadcrumb 一并移除，不再维护） */
const PAGE_TITLES = {
  overview:'总览',
  turnover:'人员流动',
  ops:'转正与合同', talent:'梯队绩效盘点',
  employee:'员工明细',
  /* ── 新菜单（一级 + 二级）── */
  people:'人员概览',
  move:'人员异动',
  recruit_overview:'社招概览', recruit_need:'社招需求',
  campus_overview:'校招概览', campus_need:'校招需求', campus_track:'校招跟踪',
  talent_hp:'高潜名单', talent_res:'储备干部', cadre_c:'C型干部',
  perf_overview:'绩效概览', perf_review:'梯队考评', perf_alert:'绩效预警',
  outsource_overview:'外包概览', outsource_emp:'外包人员',
};
/* 二级菜单归属（切换页面时自动展开对应分组并高亮） */
const PAGE_GROUPS = {
  people:'people', move:'people', employee:'people',
  recruit_overview:'recruit', recruit_need:'recruit',
  campus_overview:'recruit', campus_need:'recruit', campus_track:'recruit',
  talent_hp:'talent', talent_res:'talent', cadre_c:'talent',
  perf_overview:'perf', perf_review:'perf', perf_alert:'perf',
  outsource_overview:'outsource', outsource_emp:'outsource',
};
/* 一个菜单项承载多个现有页面（人员异动 = 人员流动 + 转正与合同；梯队考评 = 真实九宫格盘点页） */
const PAGE_MULTI = { move:['turnover','ops'], perf_review:['talent'] };
/* 未实现菜单 → 通用占位页 */
const PLACEHOLDER_PAGES = new Set([
  'campus_overview',
  'talent_hp','talent_res','cadre_c',
  'perf_overview','perf_alert',
  'outsource_overview','outsource_emp',
]);
/* 每个占位页的说明（说明该模块将来会放什么数据，来自台账 sheet） */
const PLACEHOLDER_DESC = {
  campus_overview:['校招概览','26 届结果与 27 届达成的对比总览（定位待议）。', '数据来源：27届校招需求 / 26届校招名单'],
  talent_hp:['高潜名单','人才梯队高潜认证名单（含最快晋升 T3 预测）。', '数据来源：高潜名单'],
  talent_res:['储备干部','拟任用后备干部（技储）名单，自带干部队列标注。', '数据来源：储备干部名单'],
  cadre_c:['C型干部','在任二级部门主管名单（管理通道 L1/L2）。', '数据来源：C型干部名单'],
  perf_overview:['绩效概览','B-C 人员跟踪与绩效预警总览。', '数据来源：绩效B-C人员情况'],
  perf_alert:['绩效预警','末位绩效与改进名单。', '数据来源：绩效B-C人员情况'],
  outsource_overview:['外包概览','外包在离岗规模与岗位 / 地点 / 部门评价分布。', '数据来源：OD名单'],
  outsource_emp:['外包人员','外包人员全字段名单（含月薪 / 主管 / 部门评价）。', '数据来源：OD名单'],
};
/* 侧栏折叠：一级组与三级分节是同一套交互，只差容器选择器。
   读屏可达：展开状态同步到 aria-expanded（审查 A2）。 */
function toggleNavSection(headBtn, sel) {
  const box = headBtn.closest(sel);
  if (!box) return;
  box.classList.toggle('open');
  headBtn.setAttribute('aria-expanded', box.classList.contains('open'));
}
function toggleNavGroup(headBtn) { toggleNavSection(headBtn, '.nav-group'); }
function toggleNavSec(headBtn) { toggleNavSection(headBtn, '.nav-sec'); }
function renderPlaceholder(name) {
  const d = PLACEHOLDER_DESC[name] || [PAGE_TITLES[name] || name, '', ''];
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
    /* !! 归一化：g 为 undefined（总览等无分组页）时 inGroup 必须是 false——
       classList.toggle(name, undefined) 是「翻转」不是「移除」，会把所有分组头翻亮 */
    const inGroup = !!(g && el.dataset.group === g);
    /* 只有点进某个分组的页才动展开/收起；总览等无分组页只清 head 高亮，
       不动用户的折叠状态（否则点一下总览所有分组全被改掉） */
    if (g) el.classList.toggle('open', inGroup);
    const head = el.querySelector('.nav-group-head');
    if (head) { head.classList.toggle('active', inGroup); head.setAttribute('aria-expanded', el.classList.contains('open')); }
  });
  if (PLACEHOLDER_PAGES.has(name)) renderPlaceholder(name);
  /* 占位页没有自己的 section，落到通用 #page-placeholder */
  const ids = PLACEHOLDER_PAGES.has(name) ? ['placeholder'] : (PAGE_MULTI[name] || [name]);
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('hidden', !ids.includes(p.id.replace('page-', ''))));
  document.getElementById('pageTitle').textContent = PAGE_TITLES[name] || name;
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('mobileOverlay').classList.remove('open');
  refreshAll();
  setTimeout(() => Object.values(chartInstances).forEach(c => c && c.resize && c.resize()), 80);
}
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('mobileOverlay').classList.toggle('open');
}
/* Esc 关手机端侧栏（右键菜单与筛选弹窗的 Esc 在 grid.js 里） */
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const sb = document.getElementById('sidebar');
  if (sb && sb.classList.contains('open') && typeof toggleSidebar === 'function') toggleSidebar();
});

/* ── 全局刷新 ── */
function refreshAll() {
  if (!rawData.length) return;
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
  renderStructDist(active, themeColors());
  renderTurnover(themeColors(), relevantAll);
  renderOps(active, themeColors());
  renderTalent(active, themeColors());
  renderRecruitOverview(themeColors());
  renderRecruitNeed(themeColors());
  renderCampusNeed(themeColors());
  renderCampusTrack(themeColors());
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
const DATA_FILES = (typeof window !== 'undefined' && window.HR_DATA_FILES) ||
  Object.assign({ cons: 'data/' + BU.book }, BU.files);
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
   目录前缀从配置里推导，不能写死。 */
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
    /* 自动加载不打扰用户（黑底 toast 已按需求删除），加载结果看顶栏状态点 */
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
     想让快照作废、回到数据包：重跑 更新数据.bat 换掉 built 时间戳，再刷新页面即可。 */
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
      /* 恢复快照静默完成，不再弹 toast（用户需求） */
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
      if (!got) loadDataSource(true);
    }
  });
})();
