/* ═══════════════════════════════════════════════════════════════
   v8 data.js — IndexedDB 持久化 · 文件上传解析 · 筛选器 · 页面切换
   ═══════════════════════════════════════════════════════════════ */

/* ── IndexedDB 本地缓存（刷新免重传） ── */
function idbOpen() {
  return new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('no idb'));
    const rq = indexedDB.open('hr-dashboard-v8', 1);
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

/* ── 台账工作簿识别（SWC最新人才现状-*.xlsx，9 个业务 sheet） ── */
const LEDGER_SIGNALS = ['组织架构','人员情况','校招需求','外包名单','入职名单','招聘未达成','储备干部','高潜','部门梯队'];
function looksLikeLedger(wb) {
  return wb.SheetNames.filter(sn => LEDGER_SIGNALS.some(s => sn.includes(s))).length >= 2;
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
    try { stats.currentName = f.name; await ingestWorkbook(await readWorkbook(f), stats); }
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
};
function switchPage(name) {
  if (typeof closeFilterPopup === 'function') closeFilterPopup();
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === name));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('hidden', p.id !== 'page-' + name));
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
     在职那截是筛选后的 311 人、已离职那截却是全公司的 1348 人 —— 两个数不同源 */
  const allLeavers = filtered.filter(d => d.status === '离职');
  const relevantAll = getScopeData();   // 不含日期/用工细筛的上下文（用于离职率分母）
  updateFilterStat();
  renderKpiCards(active, allActive, allLeavers);
  renderOverview(active, allActive, allLeavers, themeColors());
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

/* ── 启动：恢复缓存 或 等待上传 ── */
(function init() {
  syncThemeBtn();
  const zone = document.getElementById('uploadZone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });
  document.getElementById('fileInput').addEventListener('change', e => e.target.files.length && handleFiles(e.target.files));
  document.getElementById('folderPicker').addEventListener('change', e => e.target.files.length && handleFiles(e.target.files));

  restoreSnapshot().then(snap => {
    if (snap && snap.rawData && snap.rawData.length) {
      rawData = snap.rawData; perfData = snap.perfData || {};
      perfMeta = snap.perfMeta || { count:0, centers:[] };
      perfFileLoaded = !!snap.perfFileLoaded;
      ledgerData = snap.ledgerData || null;
      ledgerSavedAt = snap.ledgerSavedAt || null;
      dataSavedAt = snap.savedAt || null;
      rawData.forEach(d => { d.group = staffGroupOf(d); });
      attachPerfData();
      onDataLoaded(true);
      showToast(`已恢复本地数据快照（${snap.savedAt || '未知时间'}）`);
    }
  });
})();
