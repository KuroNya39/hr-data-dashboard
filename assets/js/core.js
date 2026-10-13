/* ═══════════════════════════════════════════════════════════════
   v8 core.js — 状态 · 三分法人群 · 口径徽标 · 字段映射 · 解析 · 工具 · 图表
   ═══════════════════════════════════════════════════════════════ */

/* ── 全局状态 ── */
let rawData = [];
let perfData = {};
let perfFileLoaded = false;
let perfMeta = { count: 0, centers: [] };   // 绩效覆盖元信息
let ledgerData = null;                       // 台账数据（从汇总表里的台账 sheet 解析而来）
let ledgerSavedAt = null;
let chartInstances = {};
let dataSavedAt = null;

/* ═══════════════════════════════════════════════════════════════
   一、三类人群（v8 口径地基）
   公司口径「在职 N」= 已转正 + 试用期，不含实习与外协。
   全员 = 正式 + 实习 + 外协 OD
   ═══════════════════════════════════════════════════════════════ */
const STAFF_GROUPS = [
  { key:'formal',    label:'正式员工', short:'正式',  types:['已转正','试用期'] },
  { key:'intern',    label:'实习生',   short:'实习',  types:['签约实习生','非签约实习生'] },
  { key:'outsource', label:'外协 OD',  short:'外协',  types:['外包人员','劳务人员'] },
];
const GROUP_LABEL = { formal:'正式员工', intern:'实习生', outsource:'外协 OD', unknown:'未分类' };
const GROUP_SHORT = { formal:'正式', intern:'实习', outsource:'外协', unknown:'未分类' };
const GROUP_ORDER = ['formal','intern','outsource'];

/* 口径徽标语义：formal=仅正式 · intern=含实习不含外协 · all=全员含外协 · outsource=单独看外协
   outsource 复用 all 的配色（都是最宽的灰蓝档），不新增色，只是让「筛选到外协」时徽标不说谎 */
const SCOPE_META = {
  formal:    { label:'正式',      cls:'scope-formal', title:'口径：仅已转正 + 试用期，不含实习与外协' },
  intern:    { label:'正式+实习', cls:'scope-intern', title:'口径：含实习生，不含外协 OD' },
  all:       { label:'全员',      cls:'scope-all',    title:'口径：含外协 OD 的全员' },
  outsource: { label:'外协',      cls:'scope-all',    title:'口径：仅外包人员 + 劳务人员' },
};

function staffGroupOf(d) {
  const t = d.empType;
  for (const g of STAFF_GROUPS) if (g.types.includes(t)) return g.key;
  return 'unknown';
}
/* 按人群切分数组 */
function segByGroup(arr) {
  const m = { formal:[], intern:[], outsource:[], unknown:[] };
  arr.forEach(d => m[staffGroupOf(d)].push(d));
  return m;
}
/* 人群计数 */
function groupCounts(arr) {
  const s = segByGroup(arr);
  return { formal:s.formal.length, intern:s.intern.length, outsource:s.outsource.length, unknown:s.unknown.length };
}
/* 仅正式员工 */
function formalOnly(arr) { return arr.filter(d => staffGroupOf(d) === 'formal'); }

/* 口径徽标：KPI 卡右上角 */
function scopeTag(scope, labelOverride) {
  const m = SCOPE_META[scope] || SCOPE_META.all;
  const lab = labelOverride || m.label;
  return `<span class="scope-tag ${m.cls}" aria-label="${esc(m.title)}">${esc(lab)}</span>`;
}
/* 口径徽标：图表标题旁（chart-note 内联）。labelOverride 给「单人群档位」用：
   SCOPE_META.intern 的「正式+实习」是筛选器语义（含实习），单独看实习生时要显式写「实习」 */
function scopeNote(scope, text, labelOverride) {
  const m = SCOPE_META[scope] || SCOPE_META.all;
  return `${esc(text || '')}<span class="scope-note ${m.cls}" aria-label="${esc(m.title)}">${labelOverride || m.label}</span>`;
}

/* ── 字段映射 v8（KPA 156 列 + 别名；重复列组由 mergeDups 兜底） ── */
const FIELD_MAP = {
  '员工编号':'id','员工姓名':'name','性别':'gender',
  '一级部门英文简称':'center','一级部门中文描述':'centerName',
  '二级部门中文描述':'dept','二级部门英文简称':'deptEn','三级部门中文描述':'dept3',
  '职等中文描述':'level','职等':'levelCode','子等级中文描述':'subLevel','子等级':'subLevelCode',
  '职位序列中文描述':'series','职类中文描述':'jobFamily','职位中文描述':'position','职位':'position',
  '员工状态':'status','员工类别中文描述':'empType',
  '最高学历中文描述':'edu','出生日期':'birthDate','籍贯':'hometown','婚否':'maritalStatus',
  '入职日期':'joinDate','转正日期':'confirmDate','试用届满日期':'probationEnd','现职开始日期':'currentRoleDate',
  '离职日期':'leaveDate','招聘来源':'source','首次工作时间':'firstWorkDate','行业年限#':'industryYears',
  '合同类型中文描述':'contractType','合同开始日期':'contractStart','合同结束日期':'contractEnd',
  '工作地点中文描述':'workLocation','组织类型':'orgType','梯队':'talentPipeline',
  '股权激励':'equity','管理通道职等':'mgmtLevel','管理通道子等级':'mgmtSub',
  '导师姓名':'mentor','推荐人姓名':'referrer','面试评价等级':'interviewGrade','最后评估日期':'lastReviewDate',
  '部门简称#':'deptShort','公司邮箱':'email','上级主管':'manager','工资组':'payGroup',
  '公司中文描述':'company','原工作单位#':'prevEmployer','毕业时间#':'gradDate',
  '毕业学校#':'school','主修专业#':'major','职称':'title',
  /* v8 新增字段 */
  '关键技术模块':'keyTech','技术面试官':'techInterviewer',
  '竞业限制协议':'nonCompete','反舞弊承诺书':'antiFraud','特殊保密协议':'specialNda',
  '培训服务协议':'trainingAgreement','成本中心中文描述':'costCenter',
};
/* 重复列组最多出现 6 次（本版 KPA 实测），兜底扫描 8 层 */
const DUP_SCAN = 8;

/* ── 员工类别（6 类全收）── */
const EMP_TYPES = ['已转正','试用期','签约实习生','非签约实习生','外包人员','劳务人员'];
const EMP_TYPE_COLORS = ['--type-permanent','--type-probation','--type-intern-paid','--type-intern-unpaid','--type-outsource','--type-labor'];

/* ── 绩效周期（动态取用，只用半年度等级）── */
const PERIOD_ORDER = [
  ['grade2024M','2024中'], ['grade2024Y','2024终'],
  ['grade2025M','2025中'], ['grade2025Y','2025终'],
  ['initGrade','2026H1初评'], ['finalGrade','2026H1终评'],
];
const GRADE_NUM = {'SA':5,'S':5,'A':4,'B+':3.5,'B':3,'B-':2,'C':1,'D':0};
/* 顺序即图表里的档位顺序。S 与 SA 同为最高档，KPA 实测确实存在（2026H1 终评 6 人）：
   漏掉它，这些人会在「绩效等级分布」整块消失，环形图总数也对不上旁边标注的人数 */
const GRADE_ORDER = ['SA','S','A','B+','B','B-','C','D'];

function cleanGrade(v){ return (v||'').toString().replace(/[^A-Za-z+\-]/g,''); }
function gradeScore(v){ const g=cleanGrade(v); return GRADE_NUM[g]!==undefined ? GRADE_NUM[g] : null; }

/* 文件中实际有数据的绩效周期（按时间序）
   结果缓存：latestGrade() 每行都要调它，不缓存的话每次刷新都要把 perfData 全表扫几十遍。
   绩效数据只在 attachPerfData() 里对界面生效，所以失效点只放那里一处就够 */
let _avCache = null;
function availablePeriods() {
  if (_avCache) return _avCache;
  _avCache = PERIOD_ORDER.filter(([k]) => {
    for (const id in perfData) { if (perfData[id][k]) return true; }
    return false;
  });
  return _avCache;
}
/* 某员工最新非空绩效等级 */
function latestGrade(p) {
  const av = availablePeriods();
  for (let i = av.length-1; i >= 0; i--) { const v = p[av[i][0]]; if (v) return v; }
  return '';
}

/* ── 职等自然排序（T/M/P/S/L/数字级全识别）── */
function levelSortKey(lv) {
  if (lv == null) return [99,'',0];
  const s = String(lv).trim();
  if (!s || s === '/') return [99,'',0];
  let m = s.match(/^([TMP])\s*(\d+)$/i);
  if (m) return [{T:0,M:1,P:2,S:3}[m[1].toUpperCase()] ?? 4, m[1].toUpperCase(), +m[2]];
  m = s.match(/^([A-Za-z])(\d+)$/);
  if (m) return [4, m[1].toUpperCase(), +m[2]];
  m = s.match(/(\d+)\s*级/);
  if (m) return [5, 'N', +m[1]];
  return [6, s, 0];
}
function sortLevels(arr) {
  return [...arr].sort((a,b) => {
    const ka = levelSortKey(a), kb = levelSortKey(b);
    return ka[0]-kb[0] || (ka[1]+'').localeCompare(kb[1]+'') || ka[2]-kb[2] || String(a).localeCompare(String(b));
  });
}

/* ── 岗位序列归一化 ── */
function normSeries(s) {
  if (!s || s === '/') return null;
  const t = String(s);
  if (t.includes('研发')) return '研发技术';
  if (t.includes('营销')) return '营销';
  if (t.includes('支持')) return '支持';
  if (t.includes('管理')) return '管理';
  if (t.includes('职能')) return '职能';
  return t.trim();
}

/* ── 组织类型归一（前/中/后台）──
   KPA 部分导出把同一些组织写成「营销体系 / 研发体系 / 保障体系」，
   与标准的「前台单位 / 中台单位 / 后台单位」是同一套前中后台模型的不同叫法。
   对照 KPA 自身标注：营销/事业部=前台，软件/研发中心=中台，财务人力行政质量=后台。 */
function normOrgType(v) {
  if (!v) return '';
  const t = String(v).trim();
  if (!t) return '';
  if (t.includes('前台') || t.includes('营销') || t.includes('市场')) return '前台单位';
  if (t.includes('后台') || t.includes('保障') || t.includes('职能')) return '后台单位';
  if (t.includes('中台') || t.includes('研发')) return '中台单位';
  return t;
}

/* ── 日期解析 ── */
function parseExcelDate(val) {
  if (!val && val !== 0) return '';
  if (typeof val === 'number') {
    try { const d = XLSX.SSF.parse_date_code(val); if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`; } catch(e) {}
    return '';
  }
  if (val instanceof Date) {
    return `${val.getFullYear()}-${String(val.getMonth()+1).padStart(2,'0')}-${String(val.getDate()).padStart(2,'0')}`;
  }
  const s = String(val).trim();
  const m = s.match(/^(\d{4})[\/\.\-](\d{1,2})[\/\.\-](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  return s;
}
function toDate(v){ if(!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d; }

/* ── 试用期届满日估算（唯一实现，pages/alerts 全走这里）──
   口径（用户拍板 2026-10-12）：试用期 3-6 个月，一律按 6 个日历月算。
   有「试用届满日期」原字段用原值；缺的按 入职日期+6个月 */
function estProbEndOf(d) {
  let p = toDate(d.probationEnd);
  if (!p) {
    const j = toDate(d.joinDate);
    if (j) { p = new Date(j); p.setMonth(p.getMonth() + 6); }
  }
  return p;
}
function calcTenure(jd) { const d = toDate(jd); if (!d) return 0; return (Date.now()-d.getTime())/(365.25*86400000); }
function daysBetween(a, b) { return Math.round((b - a) / 86400000); }

/* 合同类型兜底：KPA 实测该列绝大多数为空，空值按用工类别推断 */
function inferContractType(empType) {
  if (empType === '签约实习生' || empType === '非签约实习生') return '实习协议';
  if (empType === '外包人员') return '外包服务协议';
  if (empType === '劳务人员') return '劳务合同';
  if (empType === '已转正' || empType === '试用期') return '固定期限劳动合同';
  return '';
}

/* ── 行解析 v8 ── */
function parseRow(row) {
  const r = {};
  for (const [ch, val] of Object.entries(row)) r[FIELD_MAP[ch] || ch] = val;
  // 重复列组合并（SheetJS 对重名列加 _1~_n 后缀）：凡映射字段为空就从重复组补
  for (const [ch, key] of Object.entries(FIELD_MAP)) {
    if (r[key] === undefined || r[key] === '' || r[key] === '/') {
      for (let i = 1; i <= DUP_SCAN; i++) {
        const v = r[ch + '_' + i];
        if (v !== undefined && v !== '' && v !== '/') { r[key] = v; break; }
      }
    }
  }
  // 状态归一：KPA 导出实测只有 N（在职）/ T（离职）两种取值，别家导出会用中文或别的写法。
  // 兜底必须是「在职」——留成原值的话这行既不算在职也不算离职，会从所有统计里静默消失
  const stRaw = String(r.status == null ? '' : r.status).trim();
  r.status = (stRaw === 'T' || stRaw.includes('离职') || stRaw.includes('离岗')) ? '离职' : '在职';
  // 日期
  ['joinDate','leaveDate','birthDate','confirmDate','probationEnd','contractStart','contractEnd',
   'firstWorkDate','gradDate','currentRoleDate','lastReviewDate']
    .forEach(k => { r[k] = parseExcelDate(r[k]); });
  if (r.birthDate) { const d = toDate(r.birthDate); if (d) r.birthYear = d.getFullYear(); }
  // 数值：「0 年经验」是有效值，不能用 || 兜底（会把真实的 0 变成 null，新人被当成没填）
  if (r.industryYears === '' || r.industryYears == null) r.industryYears = null;
  else { const iy = parseFloat(r.industryYears); r.industryYears = isNaN(iy) ? null : iy; }
  // 清洗
  ['level','subLevel','series'].forEach(k => { if (r[k] === '/' || r[k] === '') r[k] = null; });
  r.seriesNorm = normSeries(r.series || r.levelCode);
  // 婚否归一
  const mar = String(r.maritalStatus || '').trim();
  r.maritalStatus = (mar === '是' || mar === '已婚') ? '已婚' : (mar === '否' || mar === '未婚') ? '未婚' : (mar || null);
  // 中心兜底：组织名关键字 → 中心代号，映射表在 bu-config.js（留空则不做这层兜底）
  const _bu = (typeof window !== 'undefined' && window.BU) || {};
  const _hit = (_bu.orgMap || []).find(m => r.centerName && r.centerName.includes(m[0]));
  r.center = r.center || (_hit ? _hit[1] : '');
  // v8：人群分组 + 合同类型兜底
  r.group = staffGroupOf(r);
  if (!r.contractType) r.contractType = inferContractType(r.empType);
  return r;
}

/* ── 绩效工作簿解析（多文件多 sheet，按表头自动识别；只用半年度等级）── */
function parsePerfWorkbook(wb) {
  let count = 0;
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
    if (!rows || rows.length < 4) continue;
    let headerRow = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].includes && rows[i].includes('工号')) { headerRow = i; break; }
    }
    if (headerRow < 0) continue;
    const H = rows[headerRow].map(h => (h||'').toString().replace(/\s+/g,' ').trim());
    const idx = n => H.indexOf(n);
    const idxInc = sub => H.findIndex(h => h.includes(sub));
    const iEmpId = idx('工号'), iName = idx('姓名'), iCenter = idx('中心');
    const iLevel = idx('职等'), iSub = idx('子职等'), iTier = idx('梯队类型');
    const iInit = idx('2026H1初评绩效等级') >= 0 ? idx('2026H1初评绩效等级') : idxInc('初评');
    const iFinal = idx('2026H1 终评绩效等级') >= 0 ? idx('2026H1 终评绩效等级') : idxInc('终评');
    const iChange = idx('近半年绩效变动') >= 0 ? idx('近半年绩效变动') : idxInc('绩效变动');
    const iCoeff = idx('工时投入系数') >= 0 ? idx('工时投入系数') : idxInc('投入系数');
    const iBracket = idx('投入系数分档') >= 0 ? idx('投入系数分档') : idxInc('投入分档');
    const iOrgScore = idx('组织建设评分') >= 0 ? idx('组织建设评分') : idxInc('组织建设评分');
    const iOrgBracket = idx('组织建设分档') >= 0 ? idx('组织建设分档') : idxInc('组织分档');
    const iRank = idxInc('推荐排名');
    if (iEmpId < 0) continue;

    for (let r2 = headerRow+1; r2 < rows.length; r2++) {
      const row = rows[r2];
      if (!row || !row[iEmpId] || typeof row[iEmpId] !== 'string') continue;
      const empId = row[iEmpId].trim();
      if (!empId || empId === '合计' || empId === '工号') continue;
      const ex = perfData[empId] || {};
      const rec = { ...ex };
      const put = (k, i) => { if (i >= 0 && row[i] !== '') rec[k] = row[i]; };
      put('name', iName); put('center', iCenter); put('level', iLevel);
      put('subLevel', iSub); put('tierType', iTier);
      put('grade2024M', idx('2024年中')); put('grade2024Y', idx('2024年终'));
      put('grade2025M', idx('2025年中')); put('grade2025Y', idx('2025年终'));
      put('initGrade', iInit); put('finalGrade', iFinal);
      put('gradeChange', iChange); put('inputBracket', iBracket);
      put('orgScore', iOrgScore); put('orgBracket', iOrgBracket); put('rank', iRank);
      if (iCoeff >= 0) { const n = parseFloat(row[iCoeff]); if (!isNaN(n)) rec.inputCoeff = n; }
      ['grade2024M','grade2024Y','grade2025M','grade2025Y','initGrade','finalGrade'].forEach(k => {
        if (rec[k]) rec[k] = rec[k].toString().trim();
      });
      perfData[empId] = rec;
      count++;
    }
  }
  return count;
}

function attachPerfData() {
  _avCache = null;              // 绩效数据要变了 → 作废「有数据的绩效周期」缓存
  let matched = 0;
  const centers = new Set();
  for (const emp of rawData) {
    const p = perfData[emp.id];
    if (p) {
      matched++;
      if (p.center) centers.add(String(p.center).trim());
      emp.perf = p;
      emp.hasPerf = true;
    } else { emp.hasPerf = false; }
  }
  perfMeta = { count: matched, centers: [...centers].sort() };
}

/* ── 安全读取 sheet（裁剪 !ref 到真实数据范围，防声明假范围导致 OOM）── */
function sheetRowsSafe(ws, maxRows) {
  if (!ws || !ws['!ref']) return [];
  let range;
  try { range = XLSX.utils.decode_range(ws['!ref']); } catch(e) { return []; }
  let lastR = range.s.r, lastC = range.s.c;
  // 只遍历实际存在的单元格（稀疏存储），不按声明范围展开
  for (const k of Object.keys(ws)) {
    if (k[0] === '!') continue;
    const cell = ws[k];
    if (!cell || cell.v === '' || cell.v == null) continue;
    try {
      const p = XLSX.utils.decode_cell(k);
      if (p.r > lastR) lastR = p.r;
      if (p.c > lastC) lastC = p.c;
    } catch(e) {}
  }
  const cap = maxRows || 8000;
  if (lastR - range.s.r > cap) lastR = range.s.r + cap;
  ws['!ref'] = XLSX.utils.encode_range({ s: range.s, e: { r: lastR, c: Math.min(lastC, range.e.c) } });
  return XLSX.utils.sheet_to_json(ws, { header:1, defval:'', blankrows:false });
}
/* 在表头行里找列索引（支持包含匹配） */
function findCol(H, ...names) {
  for (const n of names) {
    const i = H.indexOf(n);
    if (i >= 0) return i;
  }
  for (const n of names) {
    const i = H.findIndex(h => h && h.includes(n));
    if (i >= 0) return i;
  }
  return -1;
}

/* ── 通用聚合 ── */
function countBy(arr, keyFn) {
  const m = {};
  arr.forEach(d => { const v = typeof keyFn === 'function' ? keyFn(d) : d[keyFn]; const k = (v == null || v === '') ? '未知' : v; m[k] = (m[k]||0)+1; });
  return m;
}
function countByTwo(arr, k1, k2) {
  const m = {};
  arr.forEach(d => {
    const v1 = (typeof k1==='function'?k1(d):d[k1]) || '未知';
    const v2 = (typeof k2==='function'?k2(d):d[k2]) || '未知';
    if (!m[v1]) m[v1] = {};
    m[v1][v2] = (m[v1][v2]||0)+1;
  });
  return m;
}
function getMonthsList(n) {
  const now = new Date(), months = [];
  for (let i = n-1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }
  return months;
}
/* dateKey 可以是字段名，也可以是「给一行、返回日期」的函数
   ——「试用届满」九成人原字段为空，得估算，估出来的值没有字段名可用 */
function countByMonth(data, dateKey, months) {
  const m = {}; months.forEach(k => m[k] = 0);
  const get = typeof dateKey === 'function' ? dateKey : (d => d[dateKey]);
  data.forEach(d => { const dt = toDate(get(d)); if (!dt) return;
    const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
    if (m.hasOwnProperty(key)) m[key]++; });
  return months.map(k => m[k]);
}
/* 每月末在册人数（含在职与已离职历史） */
function headcountAt(data, endMs) {
  return data.filter(d => {
    const j = toDate(d.joinDate); if (!j || j.getTime() > endMs) return false;
    const l = toDate(d.leaveDate); if (l && l.getTime() <= endMs) return false;
    return true;
  }).length;
}
function kpi(label, value, sub, colorVar, scope, scopeLabel) {
  const dot = colorVar ? `<span class="kpi-dot" style="--tone:var(${colorVar})"></span>` : '';
  const tag = scope ? scopeTag(scope, scopeLabel) : '';
  return `<div class="kpi-card"><div class="kpi-label">${dot}${label}${tag}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub||''}</div></div>`;
}
/* CSV 文本：BOM + 表头 + 数据行。**每格一律加引号**——值里带逗号 / 引号 / 换行都不会串列，
   换行用 CRLF（Excel 最认这个）；单元格内的换行压成空格，免得一行数据在 Excel 里占多行。
   员工明细 / 校招需求 / 校招跟踪三处导出共用，调用方只管把每行整理成「值数组」。 */
function csvText(header, rows) {
  const q = v => '"' + String(v == null ? '' : v).replace(/\r?\n/g, ' ').replace(/"/g, '""') + '"';
  return '\ufeff' + [header, ...rows].map(r => r.map(q).join(',')).join('\r\n');
}
/* CSV 下载（员工明细 / 校招需求 / 校招跟踪共用）：BOM + 日期戳 + 用完即撤的 objectURL */
function downloadCsv(baseName, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' }));
  a.download = `${baseName}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
/* 引号也要转义：多处把值拼进 value="…" / title="…"，只转 < > & 的话
   姓名或部门里带一个 " 就能把属性截断（部门名里带引号是常见写法） */
function esc(v) {
  return v == null ? '' : String(v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
/* 评价等级 → 档位后缀。绩效（SA/A/B+/B/B-/C/D）与校招（S/A/B+/B/B-）是**同一条梯**，
   S 与 SA 同为梯顶 —— 所以只此一处映射，别处不再各写一份表。
   后缀直接就是 CSS 里的档位名（.tag-grade-<后缀> / .pill-grade-<后缀>），
   配色只在 style.css 出现一次，JS 不挑色。认不出的等级返回 ''，调用方回落中性样式。 */
const GRADE_RUNG = {'SA':'sa','S':'sa','A':'a','B+':'bp','B':'b','B-':'bm','C':'c','D':'d'};
function gradeRung(grade) { return GRADE_RUNG[cleanGrade(grade)] || ''; }
function gradeTag(grade) {
  const r = gradeRung(grade);
  return `<span class="tag ${r ? 'tag-grade-' + r : ''}">${esc(grade)||'—'}</span>`;
}

/* ── 主题（localStorage 持久化）── */
function syncThemeBtn() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const ico = document.getElementById('themeIco');
  const lab = document.getElementById('themeLabel');
  if (ico) ico.textContent = dark ? 'light_mode' : 'dark_mode';
  if (lab) lab.textContent = dark ? '浅色模式' : '深色模式';
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('hr8-theme', next);
  syncThemeBtn();
  /* 重绘交给 data.js 里监听 data-theme 的 MutationObserver：
     这里再调一次 refreshAll()，一次切主题会把整块看板从头刷两遍 */
}
function getCSS(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
/* 把 CSS 里的时长令牌读成毫秒数（'260ms' → 260）。
   图表动效时长不在 JS 里另写一份：令牌改了图表跟着改，两边不会漂。 */
function cssMs(name, fallback) {
  const n = parseFloat(getCSS(name));
  return isFinite(n) ? n : fallback;
}
/* 系统开了「减少动态效果」→ 图表不做入场动画（降级而不是换一种动画，见 style.css 动效层） */
function reduceMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
function themeColors() {
  const tc = {};
  ['--ink','--ink-2','--ink-3','--gridline','--surface','--surface-2','--border','--accent','--accent-strong','--accent-soft',
   '--s1','--s2','--s3','--s4','--s5','--s6',
   '--type-permanent','--type-probation','--type-intern-paid','--type-intern-unpaid','--type-outsource','--type-labor',
   '--grade-sa','--grade-a','--grade-bp','--grade-b','--grade-bm','--grade-c','--grade-d',
   '--expire-30','--expire-60','--expire-90',
   /* 公司语义色：pos 红=好 · neg 绿=不好 · warn 黄=警告 */
   '--pos','--neg','--warn']
    .forEach(v => tc[v.slice(2)] = getCSS(v));
  return tc;
}

/* ── Chart.js 封装 ── */
let CHART_DEFAULTS = null;
/* 柱顶/柱尾数值标签（2026-10-12 用户要求）：单数据集且 ≤24 根柱自动开启，
   多数据集（堆叠）默认关 —— 分段上写字太吵，tooltip 够用。
   调用方经 opts.plugins.barValue = { display, format } 显式覆盖（makeChart 负责提取）。
   ⚠ 配置必须存模块级 Map 而不是 options.plugins.barValue —— Chart.js 对
   注册插件的 options 做可脚本化解析，函数值会被它当 scriptable 拿上下文调用
   （v.toFixed is not a function 的根因，间歇性触发：重排版才走到解析）。
   横条时数值画在条尾：放不下（右侧超 85% 宽）就画条内白字。 */
const BAR_VALUE_CFG = new Map();   // chart.id → { display, format }
/* 条内文字的两个候选墨色 + 条底亮度判据。
   ⚠️ 不能用「白字」写死：深色模式下条底是提亮过的浅色（--s1 是 #60a5fa），
      白字落在上面读不清。--surface / --ink 这两支正好随主题翻转，
      所以「条底亮 → 取 --surface，条底暗 → 取 --ink」在两个主题下都成立。
   这两个值按主题缓存：afterDatasetsDraw 每帧都跑，getComputedStyle 不能每帧读。 */
let _barInk = null, _barInkTheme = null;
function barInks() {
  const th = document.documentElement.getAttribute('data-theme') || 'light';
  if (_barInkTheme !== th || !_barInk) {
    _barInk = {
      onLightBar: (typeof getCSS === 'function' && getCSS('--ink')) || '#0d1b2a',
      onDarkBar:  (typeof getCSS === 'function' && getCSS('--surface')) || '#ffffff',
    };
    _barInkTheme = th;
  }
  return _barInk;
}
/* 相对亮度（sRGB 近似）：只用来在「深墨 / 浅墨」里二选一，不做 WCAG 精确计算。
   认不出来的颜色（渐变对象等）返回 1 → 当深底，走旧行为（白字）。 */
function fillLuma(c) {
  if (typeof c !== 'string') return 1;
  const h = c.trim();
  const hex = h.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  let r, g, b;
  if (hex) {
    const s = hex[1].length === 3 ? hex[1].replace(/./g, ch => ch + ch) : hex[1];
    r = parseInt(s.slice(0, 2), 16); g = parseInt(s.slice(2, 4), 16); b = parseInt(s.slice(4, 6), 16);
  } else {
    const p = h.match(/(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/);
    if (!p) return 1;
    r = +p[1]; g = +p[2]; b = +p[3];
  }
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
const BAR_VALUE_PLUGIN = {
  id: 'barValue',
  afterDatasetsDraw(chart) {
    const cfg = BAR_VALUE_CFG.get(chart.id);
    if (!cfg || !cfg.display) return;
    const horiz = chart.options.indexAxis === 'y';
    const area = chart.chartArea;
    const { ctx } = chart;
    /* 只取这几支 CSS 变量：themeColors() 要读 40 个变量，而 afterDatasetsDraw
       在动画/悬停/重排的每一帧都跑，整份读一遍是纯浪费 */
    const ink2 = (typeof getCSS === 'function' && getCSS('--ink-2')) || '#666';
    const inks = barInks();
    ctx.save();
    /* 字号跟 --fs-10 走；字体串只在首次拼一次（字号不随主题变，可以缓存） */
    if (!_barFont) _barFont = `600 ${(typeof getCSS === 'function' && getCSS('--fs-10')) || '10px'} "Noto Sans SC", sans-serif`;
    ctx.font = _barFont;
    chart.data.datasets.forEach((ds, di) => {
      const meta = chart.getDatasetMeta(di);
      if (meta.hidden) return;
      /* 条内文字的颜色按**这一条自己的底色**选，不按整张图的底色 */
      const bg = ds.backgroundColor || ds.color;
      const inBar = fillLuma(Array.isArray(bg) ? bg[0] : bg) > 0.6 ? inks.onLightBar : inks.onDarkBar;
      meta.data.forEach((bar, i) => {
        const v = ds.data[i];
        if (v == null || isNaN(v)) return;
        const txt = cfg.format ? cfg.format(+v) : (Number.isInteger(+v) ? String(+v) : (+v).toFixed(1));
        ctx.textAlign = horiz ? 'left' : 'center';
        ctx.textBaseline = horiz ? 'middle' : 'bottom';
        if (horiz) {
          const tw = ctx.measureText(txt).width;
          if (bar.x + tw + 6 > area.right) {   // 条太长放不下 → 画在条内
            ctx.fillStyle = inBar; ctx.textAlign = 'right'; ctx.fillText(txt, bar.x - 4, bar.y);
          } else { ctx.fillStyle = ink2; ctx.fillText(txt, bar.x + 4, bar.y); }
        } else {
          if (bar.y - 14 < area.top) { ctx.fillStyle = inBar; ctx.textBaseline = 'top'; ctx.fillText(txt, bar.x, bar.y + 5); }
          else { ctx.fillStyle = ink2; ctx.fillText(txt, bar.x, bar.y - 4); }
        }
      });
    });
    ctx.restore();
  },
};
let _barFont = null;
/* 动效三值只读一次：令牌是静态的、系统 reduced-motion 也不会中途变，
   没必要每建一张图就 getComputedStyle 两次 + 新建一个 matchMedia
   （一次筛选变化会建 40+ 张图）。首次用到时算好缓存起来。 */
let _chartMotion = null;
function chartMotion() {
  return _chartMotion || (_chartMotion = {
    reduced: reduceMotion(), slow: cssMs('--dur-slow', 260), fast: cssMs('--dur-fast', 120),
  });
}
function chartDefaults(tc) {
  const mo = chartMotion();
  return {
    responsive: true, maintainAspectRatio: false,
    /* 悬停 v2（2026-10-12 用户两次反馈灵敏度差，重写）：
       ① intersect:false 全局兜底 —— v4 的 hover 自带 intersect:true 默认，
          只写 interaction 会有「鼠标离图形稍远就点不亮」的死角。
       ② mode 默认 nearest：永远吸附最近的元素，鼠标在图上任意位置都有反馈；
          多数据集图表（分组/堆叠/双线）在 makeChart 里升级为 index（整列对齐）。
       ③ transitions.active 默认 400ms —— 悬停高亮和 tooltip 淡入要等半拍才出现，
          这才是「不灵敏」的体感主因，压到 120ms 跟手不拖影。 */
    interaction: { mode:'nearest', intersect:false },
    hover: { mode:'nearest', intersect:false },
    /* 入场动画：Chart.js 默认 1000ms，一次筛选变化会让 40+ 张图各跑一遍，
       是「点一下要等一下」的主因。收进令牌的 --dur-slow（260ms，UI 动效上限 300ms）。
       easing 用 Chart.js 的 easeOutQuart 对应令牌里的 --ease-out（cubic-bezier(.22,1,.36,1)）。 */
    animation: mo.reduced ? false : { duration: mo.slow, easing: 'easeOutQuart' },
    transitions: { active: { animation: { duration: mo.fast } } },
    layout: { padding: { top: 6, right: 4, bottom: 0, left: 0 } },
    plugins: {
      legend: { position:'bottom', labels: { padding:10, usePointStyle:true, pointStyle:'circle', font:{size:10}, boxWidth:6, boxHeight:6, color:tc['ink-2'] } },
      tooltip: { backgroundColor: tc.surface, titleColor: tc.ink, bodyColor: tc['ink-2'],
        borderColor: tc.gridline, borderWidth: 1, padding: 10, cornerRadius: 8, boxPadding: 4, usePointStyle: true, titleFont: { weight: '600' } },
    },
    scales: {
      x: { grid: { display:false }, ticks: { font:{size:10}, padding:4, color:tc['ink-3'] }, border: { display:false } },
      y: { beginAtZero: true, grid: { lineWidth:1, color:tc.gridline }, ticks: { font:{size:10}, padding:4, color:tc['ink-3'] }, border: { display:false } },
    },
  };
}
function destroyChart(id) { if (chartInstances[id]) { BAR_VALUE_CFG.delete(chartInstances[id].id); chartInstances[id].destroy(); delete chartInstances[id]; } }
function makeChart(id, type, labels, datasets, opts) {
  const el = document.getElementById(id);
  if (!el) return;
  destroyChart(id);
  const tc = themeColors();
  const defaults = chartDefaults(tc);
  // fallback 只用 s1..s6：这 6 个色相两两 CIEDE2000 ΔE ≥ 26；s7/s8 区分度弱，不入回退序列
  const palette = [tc.s1, tc.s2, tc.s3, tc.s4, tc.s5, tc.s6];
  const isHoriz = !!(opts && opts.indexAxis === 'y');
  datasets = datasets.map((d, i) => ({ ...d, color: d.color || palette[i % palette.length] }));
  if (type === 'bar') {
    datasets = datasets.map(d => ({ ...d,
      backgroundColor: d.backgroundColor || d.color, borderWidth: 0,
      borderRadius: d.borderRadius !== undefined ? d.borderRadius
        : (isHoriz ? { topRight:3, bottomRight:3 } : { topLeft:3, topRight:3 }),
      borderSkipped: false, barPercentage: d.barPercentage || 0.65, categoryPercentage: d.categoryPercentage || 0.8,
      maxBarThickness: 40 }));
  } else if (type === 'line') {
    datasets = datasets.map(d => ({
      label: d.label, data: d.data,
      borderColor: d.color, backgroundColor: (d.color||tc.s2) + '1a',
      fill: d.fill !== false, tension: 0.25, pointRadius: 3, pointHoverRadius: 6, pointHitRadius: 14,
      borderWidth: 2, pointBackgroundColor: d.color, spanGaps: true }));
  }
  const options = { ...defaults, ...(opts || {}) };
  const op = (opts && opts.plugins) || {};
  /* plugins.tooltip 必须逐层合并：只并第一层的话，调用方传进来一个
     plugins.tooltip 就把整套主题化的 tooltip 样式（底色/描边/圆角/标题色）整块顶掉，
     只剩他自己那一个字段，深色模式下会变成白底黑字的原生样式 */
  options.plugins = { ...defaults.plugins, ...op };
  /* barValue 的配置已在下面提取进 BAR_VALUE_CFG —— 不能留在 options.plugins 里：
     Chart.js 会把注册插件的 options 当 scriptable 反复解析，函数值被拿上下文调用，
     就是当年 v.toFixed is not a function 间歇报错的根源 */
  if (op.barValue) delete options.plugins.barValue;
  options.plugins.tooltip = { ...defaults.plugins.tooltip, ...(op.tooltip || {}) };
  options.scales = { ...defaults.scales, ...((opts && opts.scales) || {}) };
  /* scales 也要深度合并到「轴」这一层：调用方传 scales.y.ticks.autoSkip 等单项时，
     不能把默认 y 轴的 beginAtZero / 字体色 / 网格线整块顶掉 */
  for (const ax of ['x', 'y']) {
    if (options.scales[ax] && defaults.scales[ax]) {
      options.scales[ax] = { ...defaults.scales[ax], ...options.scales[ax] };
      if (options.scales[ax].ticks && defaults.scales[ax].ticks) {
        options.scales[ax].ticks = { ...defaults.scales[ax].ticks, ...options.scales[ax].ticks };
      }
    }
  }
  /* 悬停策略（见 chartDefaults 注释）：单数据集用默认 nearest —— 永远吸最近元素，
     图上任意位置都有反馈、跟手最快；多数据集（分组/堆叠/双线）升级为 index ——
     一次命中整列，tooltip 能对齐同列各系列。调用方显式传 interaction 时以调用方为准 */
  if (!(opts && opts.interaction) && datasets.length > 1) {
    options.interaction = { mode:'index', intersect:false };
    options.hover = { mode:'index', intersect:false };
  }
  if (type === 'doughnut') {
    options.cutout = '62%';
    /* 环形图弧面之间留白多，chartDefaults 的 nearest + intersect:false 正合适：
       不必压中弧面，靠近即命中 */
    options.plugins.tooltip.callbacks = { label: ctx => {
      const t = ctx.dataset.data.reduce((a,b)=>a+b,0) || 1;
      return `${ctx.label}: ${ctx.parsed} 人 (${(ctx.parsed/t*100).toFixed(1)}%)`; } };
  } else {
    options.plugins.tooltip.callbacks = options.plugins.tooltip.callbacks || { label: ctx =>
      (ctx.dataset.label ? ctx.dataset.label + ': ' : '') + ctx.parsed.y + ' 人' };
  }
  if (opts && opts.stacked) { options.scales.x.stacked = true; options.scales.y.stacked = true; }
  /* 数值标签：柱状图单数据集且 ≤24 根自动开；显式传 plugins.barValue 优先。
     配置存 BAR_VALUE_CFG（见插件注释），不进 options.plugins */
  const bvUser = op.barValue;
  const bv = {
    display: (bvUser ? bvUser.display !== false : type === 'bar')
      && datasets.length === 1 && labels.length > 0 && labels.length <= 24,
    format: bvUser && bvUser.format,
  };
  if (bv.display) {
    options.layout.padding.top = Math.max(options.layout.padding.top, 16);
    if (isHoriz) options.layout.padding.right = 30;   // 给条尾外置数值留位
  }
  const inst = new Chart(el.getContext('2d'),
    { type, data: { labels, datasets }, options, plugins: [BAR_VALUE_PLUGIN] });
  BAR_VALUE_CFG.set(inst.id, bv);
  chartInstances[id] = inst;
}
function barChart(id, labels, datasets, opts) { makeChart(id, 'bar', labels, datasets, opts); }
/* 分类图表：默认竖柱（用户拍板 2026-10-12），仅「有需要」时自动转横条 ——
   有需要 = 任一类别名 ≥6 个全角字符宽，或类别数 >12（竖柱标签会斜着挤成一团）。
   横条时容器高度按类别数自适应（每条约 26px，170~620px 封顶）；
   竖条时清掉内联高度，还原 chart-box 的类高（tall/short/默认 270）。
   ⚠ 历史调用都按横条传 scales.y.ticks.autoSkip（那时类别轴在 y），
     自动转竖柱时把这层配置平移到 x 轴，调用方一行不用改。 */
function hbarChart(id, labels, datasets, opts) {
  opts = opts || {};
  const el = document.getElementById(id);
  const labelWidth = s => { let w = 0; for (const ch of String(s)) w += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.55; return w; };
  const n = Math.max(labels.length, ...datasets.map(d => (d.data || []).length));
  const horiz = labels.some(l => labelWidth(l) >= 6) || n > 12;
  const o = Object.assign({}, opts, { indexAxis: horiz ? 'y' : 'x' });
  if (horiz) {
    if (el && el.parentElement) {
      const h = Math.min(620, Math.max(170, n * ((opts.barH) || 26) + 46));
      el.parentElement.style.height = h + 'px';
    }
    o.plugins = Object.assign({
      tooltip: { callbacks: { label: ctx => (ctx.dataset.label ? ctx.dataset.label + ': ' : '') + ctx.parsed.x + ' 人' } },
    }, opts.plugins);
    o.scales = Object.assign({ x: { beginAtZero: true } }, opts.scales);
  } else {
    if (el && el.parentElement) el.parentElement.style.height = '';
    o.plugins = Object.assign({}, opts.plugins);
    if (o.scales && o.scales.y && o.scales.y.ticks && !o.scales.x) {
      o.scales.x = o.scales.y; delete o.scales.y;
    }
  }
  makeChart(id, 'bar', labels, datasets, o);
}
function lineChart(id, labels, datasets, opts) { makeChart(id, 'line', labels, datasets, opts); }
function doughnutChart(id, labels, data, colors) {
  destroyChart(id);
  const tc = themeColors();
  const el = document.getElementById(id);
  if (!el) return;
  chartInstances[id] = new Chart(el.getContext('2d'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: tc.surface }] },
    options: chartDefaults(tc),
  });
  chartInstances[id].options.plugins.tooltip.callbacks = { label: ctx => {
    const t = ctx.dataset.data.reduce((a,b)=>a+b,0) || 1;
    return `${ctx.label}: ${ctx.parsed} 人 (${(ctx.parsed/t*100).toFixed(1)}%)`; } };
  chartInstances[id].update();
}

/* ── Toast ── */
let toastTimer = null;
function showToast(msg, isError) {
  let el = document.getElementById('appToast');
  if (!el) {
    el = document.createElement('div'); el.id = 'appToast'; document.body.appendChild(el);
    /* 读屏可达：提示内容变化时播报（审查 A2） */
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
  }
  el.textContent = msg;
  el.className = isError ? 'error show' : 'show';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/* ── 部门双语标签 ── */
let deptPairs = [];
function buildDeptPairs() {
  deptPairs = [...new Map(rawData.filter(d => d.deptEn || d.dept).map(d => [d.deptEn || d.dept,
    { en: d.deptEn || d.dept, cn: d.dept || d.deptEn || '' }])).values()]
    .sort((a,b) => a.en.localeCompare(b.en));
}
function getDeptLabel(en) {
  const f = deptPairs.find(p => p.en === en);
  return f && f.cn && f.cn !== f.en ? `${f.en} (${f.cn})` : en;
}

/* ═══ 筛选弹窗值列表（table.js 员工明细 / grid.js 台账表共用）═══
   日期列自动分组 年→月→日（Excel 风格，年份降序、月日升序）；每行 hover 出「仅筛此项」。
   约定：叶子 checkbox 一律带 data-val=真实筛选值（collectChecked 只认 data-val），
   分组节点 checkbox 用 .cb-node（不带 data-val，只做批量勾选 + indeterminate 呈现）。
   每次渲染注册两个钩子：__fpOnChange（勾选变化→套用筛选）与 __fpApplyOnly（仅筛此项→直接设值）。 */
/* 焦点落位（老浏览器没有 focus(options) 就走无参版） */
function fpFocus(el) {
  if (!el || !el.focus) return;
  try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) {} }
}
/* 弹窗外壳：读屏可达 + 焦点进弹窗（table.js 员工明细 / grid.js 台账表同一套规范） */
function fpPlacePopup(popup, rect, fallbackW, fallbackH) {
  /* 贴在触发器下方，并钳在视口内——不夹的话，表格底部那几行的表头会把弹窗顶到屏幕外。
     尺寸取浮层**实际**的 offsetWidth/Height（拿不到再用兜底），比写死一个数更准；
     左侧留 6px 边距，免得贴到屏幕边上。调用前须已 display:block。 */
  const w = popup.offsetWidth || fallbackW || 320;
  const h = popup.offsetHeight || fallbackH || 300;
  popup.style.left = Math.max(6, Math.min(rect.left, window.innerWidth - w - 6)) + 'px';
  popup.style.top = Math.min(rect.bottom + 2, window.innerHeight - h - 6) + 'px';
}
function fpOpenDialog(popup, label) {
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', label);
  popup.tabIndex = -1;
  fpFocus(popup);
}
/* 弹窗顶部标题条（两处弹窗外壳共用）。样式全在 style.css 的 .fp-head / .fp-close，这里只出结构。 */
function fpHeaderHtml(title, closeJs) {
  return `<div class="fp-head"><span>${esc(title)}</span><span class="fp-close" role="button" tabindex="0" aria-label="关闭" onclick="${closeJs}" onkeydown="if(event.key==='Enter'||event.key===' '){${closeJs}}"><span class="mi">close</span></span></div>`;
}
const FP_DATE_RE = /^\d{4}-\d{1,2}-\d{1,2}$/;
function fpIsDateCol(entries) { return entries.length > 1 && entries.every(e => FP_DATE_RE.test(e.value)); }
/* depth 只用来算缩进：CSS 拿 --fp-depth 乘以每级步长（见 .fp-row），JS 不再拼 px。 */
function fpLeafRow(e, i, selected, onChangeJs, depth) {
  return `<label class="fp-row" style="--fp-depth:${depth}"><input type="checkbox" data-val="${esc(e.value)}"${selected.has(e.value) ? ' checked' : ''} onchange="${onChangeJs}"><span class="fp-val">${esc(e.value)}</span><span class="fp-count">${e.count}</span><span class="fp-only" role="button" tabindex="0" aria-label="仅筛 ${esc(e.value)}" onclick="fpOnlyThis(event,this)" onkeydown="if(event.key==='Enter'||event.key===' '){fpOnlyThis(event,this)}" data-mode="leaf" data-i="${i}">仅筛此项</span></label>`;
}
function fpRenderList(entries, selected, onChangeJs) {
  window.__fpLeafVals = entries.map(e => e.value);
  if (!fpIsDateCol(entries)) {
    return entries.map((e, i) => fpLeafRow(e, i, selected, onChangeJs, 0)).join('');
  }
  /* 树构建：ISO 日期字符串字典序=时间序，entries 已升序 → 每个节点覆盖一段连续下标 [a,b] */
  const root = { ch: new Map(), a: Infinity, b: -1 };
  entries.forEach((e, i) => {
    let node = root; node.a = Math.min(node.a, i); node.b = Math.max(node.b, i);
    const [y, m, d] = e.value.split('-');
    [y + '年', parseInt(m, 10) + '月', parseInt(d, 10) + '日'].forEach(lab => {
      if (!node.ch.has(lab)) node.ch.set(lab, { ch: new Map(), a: Infinity, b: -1 });
      node = node.ch.get(lab); node.a = Math.min(node.a, i); node.b = Math.max(node.b, i);
    });
  });
  const cnt = n => { let s = 0; for (let i = n.a; i <= n.b; i++) s += entries[i].count; return s; };
  const render = (n, depth) => {
    let html = '';
    const kids = [...n.ch.entries()];
    /* 年份层降序（最新在前），月/日层升序 */
    if (depth === 0) kids.sort((x, y) => parseInt(y[0]) - parseInt(x[0]));
    else kids.sort((x, y) => parseInt(x[0]) - parseInt(y[0]));
    for (const [lab, c] of kids) {
      if (!c.ch.size) { html += fpLeafRow(entries[c.a], c.a, selected, onChangeJs, depth); continue; }
      html += `<div class="fp-node"><div class="fp-row" style="--fp-depth:${depth}"><span class="fp-arrow mi collapsed" role="button" tabindex="0" aria-label="展开或收起 ${esc(lab)}" onclick="fpToggleNode(event,this)" onkeydown="if(event.key==='Enter'||event.key===' '){fpToggleNode(event,this)}">expand_more</span><input type="checkbox" class="cb-node" onchange="fpNodeChange(this)" aria-label="全选 ${esc(lab)}"><b class="fp-node-label">${esc(lab)}</b><span class="fp-count">${cnt(c)}</span><span class="fp-only" role="button" tabindex="0" aria-label="仅筛 ${esc(lab)}" onclick="fpOnlyThis(event,this)" onkeydown="if(event.key==='Enter'||event.key===' '){fpOnlyThis(event,this)}" data-mode="range" data-a="${c.a}" data-b="${c.b}">仅筛此项</span></div><div class="fp-children">${render(c, depth + 1)}</div></div>`;
    }
    return html;
  };
  return render(root, 0);
}
window.fpToggleNode = function (ev, el) {
  ev.preventDefault(); ev.stopPropagation();
  /* 展开/收起与箭头朝向都由状态类表达（.fp-node.open / .fp-arrow.collapsed），
     JS 不再直接写 display 与 transform —— 初始态也走同一套类，样式不会两处漂。 */
  const open = el.closest('.fp-node').classList.toggle('open');
  el.classList.toggle('collapsed', !open);
};
window.fpNodeChange = function (cb) {
  cb.closest('.fp-node').querySelector('.fp-children')
    .querySelectorAll('input[type=checkbox][data-val]').forEach(c => { c.checked = cb.checked; });
  window.__fpOnChange && window.__fpOnChange();
  fpSyncNodes();
};
window.fpOnlyThis = function (ev, el) {
  ev.preventDefault(); ev.stopPropagation();
  const vals = window.__fpLeafVals || [];
  const set = new Set();
  if (el.dataset.mode === 'leaf') set.add(vals[+el.dataset.i]);
  else for (let i = +el.dataset.a; i <= +el.dataset.b; i++) set.add(vals[i]);
  window.__fpApplyOnly && window.__fpApplyOnly(set);
  document.querySelectorAll('#filterPopup input[type=checkbox][data-val]')
    .forEach(c => { c.checked = set.has(c.dataset.val); });
  fpSyncNodes();
};
/* 分组节点 / 全选框的勾选态同步（叶子态是唯一事实源） */
function fpSyncNodes() {
  document.querySelectorAll('#filterPopup .cb-node').forEach(cb => {
    const leaves = [...cb.closest('.fp-node').querySelectorAll('input[type=checkbox][data-val]')];
    const on = leaves.filter(c => c.checked).length;
    cb.checked = on > 0 && on === leaves.length;
    cb.indeterminate = on > 0 && on < leaves.length;
  });
  const all = document.querySelector('#filterPopup .cb-all');
  if (all) {
    const leaves = [...document.querySelectorAll('#filterPopup input[type=checkbox][data-val]')];
    const on = leaves.filter(c => c.checked).length;
    all.checked = leaves.length > 0 && on === leaves.length;
    all.indeterminate = on > 0 && on < leaves.length;
  }
}
