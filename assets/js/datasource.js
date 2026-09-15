/* ═══════════════════════════════════════════════════════════════
   v8 datasource.js — 手工数据源（data/看板数据源.xlsx）读取
   ------------------------------------------------------------------
   为什么要这个模块：
     KPA 导出只反映「当下状态」，而 HC 计划、指标目标值、历史月度人数
     这些要人工维护 —— 它们放在 data/ 的 Excel 里，改完点「重新读取」即生效。

   设计原则：
     1) 全程静默降级 —— 文件缺失/格式不对/网络失败都只是 dsData 保持为空，
        看板照常跑，手工指标显示「—」，绝不抛错、不阻断 refreshAll()
     2) 按表头名找列 —— 用户挪动列顺序、插空列都不影响解析
     3) 防缓存 —— fetch 带时间戳参数，否则浏览器会把改完的 Excel 当旧的用
   ═══════════════════════════════════════════════════════════════ */

/* 手工数据源全局状态 */
let dsData = {
  loaded: false,          // 是否成功读到过
  file: null,             // 文件名（用于界面展示）
  savedAt: null,          // 文件修改时间（来自 HTTP Last-Modified，拿不到则为 null）
  budget: [],             // 部门编制  [{ dept, deptName, plan, actual, gap, note }]
  targets: {},            // 指标目标  { '滚动12月离职率': { value, scope, period, note } }
  monthly: [],            // 月度快照  [{ month, formal, intern, outsource, total, note }]
  recruitPlan: [],        // 招聘计划  [{ dept, position, plan, priority, targetMonth, note }]
  duty: [],               // 工作分工  [{ id, name, dept, content }]（2026-09-12 新增）
  dutyMap: {},            // 工号 → 工作内容（员工明细表 join 用）
  errors: [],             // 解析过程中的非致命问题（供调试，不展示给用户）
};
let dsDataVersion = 0;    // 版本号，供 refreshAll 判断是否需要重绘

/* 数据路径：看板.html 在项目根，原数据表在同级 data/ 下。
   2026-09-12 晚起 = SWC人力看板.xlsx（用户手工维护的 13 张 sheet）。
   旧的「手工四张表」（部门编制/指标目标/月度快照/招聘计划）已按用户要求移除，
   对应指标静默降级显示「—」。
   分享版走内联数据包，不经过这里。 */
const DS_PATH = (typeof window !== 'undefined' && window.HR_DATA_SOURCE) || 'data/SWC人力看板.xlsx';

/* ── 小工具：按表头名建立「列名 → 索引」映射 ── */
function dsColIndex(headerRow) {
  const map = {};
  (headerRow || []).forEach((h, i) => {
    const k = String(h == null ? '' : h).replace(/\s/g, '').trim();
    if (k) map[k] = i;
  });
  return map;
}
/* 按候选列名取单元格值（支持「HC 计划」/「HC计划」这类空格差异） */
function dsCell(row, cols, ...names) {
  for (const n of names) {
    const key = n.replace(/\s/g, '');
    if (cols[key] !== undefined) {
      const v = row[cols[key]];
      if (v !== undefined && v !== null && v !== '') return v;
    }
  }
  return '';
}
function dsNum(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
  return isNaN(n) ? null : n;
}
function dsStr(v) { return v === null || v === undefined ? '' : String(v).trim(); }

/* ── 主入口：从 data/看板数据源.xlsx 读取（需要 http 服务时走这条） ── */
async function loadDataSource(silent) {
  try {
    /* 带时间戳绕开浏览器缓存：不加的话改完 Excel 刷新看到的还是旧数 */
    const url = DS_PATH + '?t=' + Date.now();
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const buf = await resp.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: false });
    const ds = parseDataSourceWorkbook(wb);
    ds.file = '看板数据源.xlsx';
    ds.savedAt = resp.headers.get('Last-Modified') || null;
    adoptDataSource(ds, silent);
    return ds;
  } catch (e) {
    dsData.loaded = false;
    dsData.errors = [String(e.message || e)];
    if (typeof console !== 'undefined') console.warn('数据源未加载（看板正常降级）：', e.message || e);
    if (!silent) showToast('数据源读取失败：' + (e.message || e) + '（看板其余功能不受影响）', true);
    dsUpdateStatusUI();
    return null;
  }
}

/* ── 从内联数据包已经还原好的 workbook 加载（双击打开时走这条） ── */
function loadDataSourceFromPack(wb, fileName) {
  try {
    const ds = parseDataSourceWorkbook(wb);
    ds.file = fileName || '内联数据包';
    adoptDataSource(ds, true);
    return ds;
  } catch (e) {
    dsData.loaded = false;
    dsData.errors = [String(e.message || e)];
    if (typeof console !== 'undefined') console.warn('数据源（数据包）解析失败：', e.message || e);
    dsUpdateStatusUI();
    return null;
  }
}

/* ── 纯解析：把 workbook 拆成「部门编制 / 指标目标 / 月度快照 / 招聘计划」四张表 ──
   网络路径和内联数据包路径共用这一份，保证两条路读出来的口径完全一致。 */
function parseDataSourceWorkbook(wb) {
  const ds = { loaded: true, file: null, savedAt: null, budget: [], targets: {}, monthly: [], recruitPlan: [], duty: [], dutyMap: {}, errors: [] };

  /* ① 部门编制 */
  if (wb.Sheets['部门编制']) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['部门编制'], { header: 1, defval: '', blankrows: false });
    if (rows.length > 1) {
      const cols = dsColIndex(rows[0]);
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const dept = dsStr(dsCell(r, cols, '二级部门', '部门', '部门简称'));
        if (!dept) continue;
        const plan = dsNum(dsCell(r, cols, 'HC 计划', 'HC计划', '计划', '编制'));
        const actual = dsNum(dsCell(r, cols, '已到位', '在职', '实际'));
        /* 缺口：用户没填就自己算，填了以用户的为准 */
        let gap = dsNum(dsCell(r, cols, '缺口'));
        if (gap === null && plan !== null && actual !== null) gap = plan - actual;
        ds.budget.push({ dept, deptName: dsStr(dsCell(r, cols, '部门中文名', '中文名', '部门名称')),
          plan, actual, gap, note: dsStr(dsCell(r, cols, '备注')) });
      }
    } else { ds.errors.push('部门编制：无数据行'); }
  } else { ds.errors.push('部门编制：sheet 不存在'); }

  /* ② 指标目标 */
  if (wb.Sheets['指标目标']) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['指标目标'], { header: 1, defval: '', blankrows: false });
    if (rows.length > 1) {
      const cols = dsColIndex(rows[0]);
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const name = dsStr(dsCell(r, cols, '指标名', '指标', '名称'));
        if (!name) continue;
        const value = dsNum(dsCell(r, cols, '目标值', '目标'));
        if (value === null) continue;
        ds.targets[name] = { value, scope: dsStr(dsCell(r, cols, '口径')) || 'formal',
          period: dsStr(dsCell(r, cols, '周期')), note: dsStr(dsCell(r, cols, '备注')) };
      }
    } else { ds.errors.push('指标目标：无数据行'); }
  } else { ds.errors.push('指标目标：sheet 不存在'); }

  /* ③ 月度快照 */
  if (wb.Sheets['月度快照']) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['月度快照'], { header: 1, defval: '', blankrows: false });
    if (rows.length > 1) {
      const cols = dsColIndex(rows[0]);
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const month = dsStr(dsCell(r, cols, '月份', '月'));
        if (!month) continue;
        const formal = dsNum(dsCell(r, cols, '正式', '正式员工'));
        const intern = dsNum(dsCell(r, cols, '实习', '实习生'));
        const outsource = dsNum(dsCell(r, cols, '外协', '外协 OD', '外协OD'));
        let total = dsNum(dsCell(r, cols, '月末在职合计', '在职合计', '合计'));
        if (total === null) total = (formal || 0) + (intern || 0) + (outsource || 0);
        ds.monthly.push({ month, formal, intern, outsource, total, note: dsStr(dsCell(r, cols, '备注')) });
      }
      ds.monthly.sort((a, b) => String(a.month).localeCompare(String(b.month)));
    } else { ds.errors.push('月度快照：无数据行'); }
  } else { ds.errors.push('月度快照：sheet 不存在'); }

  /* ④ 招聘计划 */
  if (wb.Sheets['招聘计划']) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['招聘计划'], { header: 1, defval: '', blankrows: false });
    if (rows.length > 1) {
      const cols = dsColIndex(rows[0]);
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const dept = dsStr(dsCell(r, cols, '部门'));
        const position = dsStr(dsCell(r, cols, '岗位', '职位'));
        if (!dept && !position) continue;
        ds.recruitPlan.push({ dept, position, plan: dsNum(dsCell(r, cols, '计划人数', '计划', '人数')),
          priority: dsStr(dsCell(r, cols, '优先级')), targetMonth: dsStr(dsCell(r, cols, '目标到岗月', '到岗月')),
          note: dsStr(dsCell(r, cols, '备注')) });
      }
    } else { ds.errors.push('招聘计划：无数据行'); }
  } else { ds.errors.push('招聘计划：sheet 不存在'); }

  /* ⑤ 工作分工（2026-09-12 新增）：工号做键，员工明细表按工号 join 显示。
     没这张表不算错（旧文件没有），所以静默跳过、不往 errors 里塞。 */
  if (wb.Sheets['工作分工']) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['工作分工'], { header: 1, defval: '', blankrows: false });
    if (rows.length > 1) {
      const cols = dsColIndex(rows[0]);
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const id = dsStr(dsCell(r, cols, '工号', '员工编号', '员工工号'));
        if (!id) continue;
        const content = dsStr(dsCell(r, cols, '主要工作内容', '工作内容', '工作分工'));
        ds.duty.push({ id, name: dsStr(dsCell(r, cols, '姓名')), dept: dsStr(dsCell(r, cols, '二级部门', '部门')), content });
        if (content) ds.dutyMap[id] = content;
      }
    }
  }

  /* 顺手记下原始 AOA：保存数据包时直接写回这份，不用反推 */
  try { if (typeof wbToPack === 'function') _packedBooks.manual = wbToPack(wb); } catch (e) {}

  return ds;
}

/* ── 采纳一份解析结果：写回全局态、刷状态点、给出提示 ── */
function adoptDataSource(ds, silent) {
  dsData = ds;
  dsDataVersion++;
  if (!silent) {
    const n = ds.budget.length + Object.keys(ds.targets).length + ds.monthly.length + ds.recruitPlan.length;
    if (n > 0) showToast(`数据源已读取：编制 ${ds.budget.length} · 目标 ${Object.keys(ds.targets).length} · 快照 ${ds.monthly.length} · 招聘 ${ds.recruitPlan.length}`);
    else showToast('数据源文件已读到，但各表都还没有填数据', true);
  }
  dsUpdateStatusUI();
}

/* ── 界面上数据源的状态提示（放顶栏按钮上） ── */
function dsUpdateStatusUI() {
  const dot = document.getElementById('dsDot');
  if (dot) dot.className = 'btn-dot' + (dsData.loaded ? ' loaded' : '');
  const btn = document.getElementById('dsBtn');
  if (btn) {
    const n = dsData.loaded
      ? (dsData.budget.length + Object.keys(dsData.targets).length + dsData.monthly.length + dsData.recruitPlan.length)
      : 0;
    btn.title = dsData.loaded
      ? `手工数据源已加载（${n} 条）· 点此重新读取`
      : '手工数据源未加载 · 点此重试';
  }
}

/* ── 供 KPI 卡使用：拿某个指标的目标值 ── */
function dsTarget(name) {
  return dsData.targets && dsData.targets[name] ? dsData.targets[name] : null;
}
/* 编制达成率（有编制数据才算得出来）
   口径：编制（HC）指正式编制，所以「已到位」只统计正式员工（已转正 + 试用期），
   不含实习与外协 —— 否则用全员在职去比编制会把达成率抬高。
   优先用用户在 Excel 里手填的「已到位」；没填才回落到 KPA 实际人数。 */
function dsBudgetSummary() {
  const rows = (dsData.budget || []).filter(b => b.plan !== null && b.plan > 0);
  if (!rows.length) return null;
  const plan = rows.reduce((s, b) => s + b.plan, 0);
  const formalAt = dept => (typeof rawData !== 'undefined' && typeof staffGroupOf === 'function')
    ? rawData.filter(d => d.status === '在职' && staffGroupOf(d) === 'formal' && (d.deptEn || d.dept) === dept).length
    : (typeof rawData !== 'undefined' ? rawData.filter(d => d.status === '在职' && (d.deptEn || d.dept) === dept).length : 0);
  const actual = rows.reduce((s, b) => s + (b.actual !== null ? b.actual : formalAt(b.dept)), 0);
  return { plan, actual, rate: plan ? actual / plan * 100 : null, depts: rows.length };
}
