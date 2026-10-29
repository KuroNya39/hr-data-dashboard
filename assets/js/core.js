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
   全员 = 正式 + 实习 + 外协OD
   ═══════════════════════════════════════════════════════════════ */
const STAFF_GROUPS = [
  { key:'formal',    label:'正式员工', short:'正式',  types:['已转正','试用期'] },
  { key:'intern',    label:'实习生',   short:'实习',  types:['签约实习生','非签约实习生'] },
  { key:'outsource', label:'外协OD',  short:'外协',  types:['外包人员','劳务人员'] },
];
const GROUP_LABEL = { formal:'正式员工', intern:'实习生', outsource:'外协OD', unknown:'未分类' };
const GROUP_SHORT = { formal:'正式', intern:'实习', outsource:'OD', unknown:'未分类' };
const GROUP_ORDER = ['formal','intern','outsource'];

/* 口径徽标语义：formal=仅正式 · intern=含实习不含外协 · all=全员含外协 · outsource=单独看外协
   outsource 复用 all 的配色（都是最宽的灰蓝档），不新增色，只是让「筛选到外协」时徽标不说谎 */
const SCOPE_META = {
  formal:    { label:'正式',      cls:'scope-formal', title:'口径：仅已转正 + 试用期，不含实习与外协' },
  intern:    { label:'实习', cls:'scope-intern', title:'口径：含实习生，不含外协OD' },
  all:       { label:'全员',      cls:'scope-all',    title:'口径：含外协OD 的全员' },
  outsource: { label:'OD',       cls:'scope-all',    title:'口径：仅外包人员 + 劳务人员' },
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

/* ── 当前人口口径 = 顶栏「人群」下拉，全站唯一的人口收窄点 ──
   2026-10-14 用户拍板：各页不再自己收窄人群。getScopeData() / getFiltered()
   已经把下拉套在 rawData 上了，所以页面里再叠一层 formalOnly 就是**二次收窄**
   ——「选了全部还是只算正式员工」就是这么来的。
   下拉的值恰好就是 SCOPE_META 的键，所以可以直接喂给 scopeTag / scopeNote。 */
function scopeOfFilter() {
  const el = document.getElementById('filterGroup');
  return (el && el.value) || 'all';
}
/* 徽标文案（2026-10-15 用户拍板：徽标只显示 正式/实习/OD，长名只留给顶栏下拉）。
   旧版分长短两档，长名在徽标场景全是冗余，已统一收短 —— 参数一并撤掉，
   留着 `scopeLabelOf(true)` 这种写法只会让人以为「true = 要长名」 */
function scopeLabelOf() {
  const g = scopeOfFilter();
  return g === 'all' ? null : GROUP_SHORT[g];
}
/* 徽标文案（含「全部」档）：all 档没有 GROUP_LABEL，回落 SCOPE_META 的「全员」。
   提醒条 / 内联注记这些「不管选哪档都要写个标签」的地方用这个，
   免得各处自己写一遍 `x || SCOPE_META[scope].label` 的兜底。 */
function scopeLabelAll() {
  return scopeLabelOf() || (SCOPE_META[scopeOfFilter()] || SCOPE_META.all).label;
}

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

/* ── 绩效周期（动态取用，只用半年度等级）── */
const PERIOD_ORDER = [
  ['grade2024M','24H1'], ['grade2024Y','24H2'],
  ['grade2025M','25H1'], ['grade2025Y','25H2'],
  ['grade26H1','26H1'],   // 26H1 只取终评（初评不读，见 deriveGrade26H1）
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
/* 最近 n 期、最新在最左。人员明细的动态绩效列与梯队高潜表共用这一处，
   两处各写一遍 slice(-3).reverse() 的话，以后改期数就会一边 3 期一边 5 期 */
function recentPeriods(n) {
  return availablePeriods().slice(-(n || 3)).reverse();
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

/* ── 试用期届满日（唯一实现，pages/alerts 全走这里）──
   口径（2026-10-15 用户澄清数据语义）：KPA「试用届满日期」= 实际转正日期（真人真事）；
   「转正日期」列 = 系统按入职日期推导的预定转正日（多为入职+6月，另有 1-2 月历史口径）。
   取值链：试用届满日期(实际) → 转正日期(预定) → 入职+6个月(兜底，试用期 3-6 月按 6 算)。
   ⚠ 不能跳过预定转正日直接算入职+6：实测 229 名试用期员工里 21 人预定 29~61 天届满，
   盲算 +6 会把 90 天内届满/逾期预警整体算晚 4~5 个月 */
/* 试用期届满日的唯一解析器。priority 只决定先看哪一支，取值链本身只写一处：
     'actual'（转正队列）  试用届满日期(实际) → 转正日期(预定) → 入职+6月
     'plan'  （转正日历 / 届满提醒）转正日期(预定) → 试用届满日期(实际) → 入职+6月
   两档的优先级不同是有意的，见下面两个包装函数的说明 —— 但「哪几支、怎么兜底」不该各写一遍。 */
function probEndOf(d, priority) {
  const actual = toDate(d.probationEnd), plan = toDate(d.confirmDate);
  const p = priority === 'plan' ? (plan || actual) : (actual || plan);
  if (p) return p;
  const j = toDate(d.joinDate);
  if (!j) return null;
  const e = new Date(j); e.setMonth(e.getMonth() + 6);
  return e;
}
function estProbEndOf(d) { return probEndOf(d, 'actual'); }
/* 转正日历 / 试用届满提醒的取数（2026-10-16 用户拍板）：
   试用期在册的人「预定转正日」(confirmDate) 100% 有值，直接用它，不估算；
   confirmDate 缺失才回落 estProbEndOf（入职+6月兜底，展示时标 *）。
   转正率队列不用它——已转正的人有实际转正日 (probationEnd)，那个更准 */
function probEndPlanOf(d) { return probEndOf(d, 'plan'); }
/* 司龄（年）。untilMs：截止时间戳——离职员工要算到离职日而非今天
   （2026-10-15 用户报某人司龄 bug：1月入职7月离职却显示 0.8年=算到今天）。
   在职人群（KPI/图表/预警）一律不传=今天截止，行为不变 */
function calcTenure(jd, untilMs) {
  const d = toDate(jd); if (!d) return 0;
  const end = untilMs != null ? toDate(untilMs) : null;
  return ((end ? end.getTime() : Date.now()) - d.getTime()) / (365.25 * 86400000);
}
/* 明细表司龄：离职员工算到离职日，在职算到今天（KPI/图表/预警仍走 calcTenure 原语义） */
function empTenure(d) {
  return calcTenure(d.joinDate, d.status === '离职' && d.leaveDate ? d.leaveDate : null);
}
function daysBetween(a, b) { return Math.round((b - a) / 86400000); }
/* 两个日期间的**完整日历月数**（不满一个月的天数不计数）。
   「不足 N 个月」一类口径一律用它，别用 天数/30 或 年分数——
   365.25 天算出的 0.5 年=182.6 天，会把「恰满 6 个日历月」误判成不足 6 个月
   （实例：2026-01-05→2026-07-05 是整 6 个月，181 天 < 182.6 天被算成 <6 月）。 */
function fullMonthsBetween(a, b) {
  const j = toDate(a), l = toDate(b);
  if (!j || !l) return null;
  let m = (l.getFullYear() - j.getFullYear()) * 12 + (l.getMonth() - j.getMonth());
  if (l.getDate() < j.getDate()) m--;          // 结束日没到入职日的「号数」→ 最后一个月不满
  return m < 0 ? 0 : m;
}

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

/* 26H1 只认**终评**（2026-10-14 用户纠正：初评不是最终结果；
   2026-10-21 再明确：表头叫「2026H1初评绩效等级」的列干脆不读）。
   「最近 3 期」这类口径不该把同一期的初评/终评拆成两期。
   解析（parsePerfWorkbook）与旧快照自愈（data.js）共用这一处，
   免得两边的合并规则各写一份、日后改口径只改到一边。 */
function deriveGrade26H1(rec) {
  if (rec.finalGrade) rec.grade26H1 = rec.finalGrade;
  return rec;
}

/* ── 绩效工作簿解析（多文件多 sheet，按表头自动识别；只用半年度等级）──
   解析顺序决定「同一期在两个表里都有值时谁说了算」：**按期间单独成表的（`25H2绩效`）最后读**，
   让它盖过 26H1 表里带的同名列。理由是那张表专门维护该期、覆盖人数也更多（191 vs 176）。
   排序写死在这里、不依赖 Excel 里的 sheet 先后——用户重排一下表页不该悄悄改变数据。 */
function perfSheetRank(sn) { return /^\d{2}H\d绩效$/.test(sn) ? 1 : 0; }
function parsePerfWorkbook(wb) {
  let count = 0;
  const names = (wb.SheetNames || []).slice().sort((a, b) => perfSheetRank(a) - perfSheetRank(b));
  for (const sn of names) {
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
    /* 多条件匹配：所有子串都出现才算。用来把「2025年H1终评绩效等级」和「2026H1 终评绩效等级」
       分开——单条件 idxInc('终评') 会先命中左边第一个，25H1 那张表因此被当成 26H1（等级串期）。 */
    const idxAll = (...subs) => H.findIndex(h => subs.every(s => h.includes(s)));
    /* 按序取第一个存在的精确列名，都没有才用 fallback —— 一列名一行，省掉同名列查两遍 */
    const pick = (names, fallback) => {
      for (const n of names) { const i = idx(n); if (i >= 0) return i; }
      return fallback;
    };
    const iEmpId = idx('工号'), iName = idx('姓名'), iCenter = idx('中心');
    const iLevel = idx('职等'), iSub = idx('子职等'), iTier = idx('梯队类型');
    /* 26H1 **只读「终评」**：初评不是最终结果，用户 2026-10-21 明确「有 2026H1初评绩效等级的列
       不要管，以终评绩效等级为准」。锚定 2026 也是必须的——同一份工作簿里还躺着
       「2025年H1初评/终评绩效等级」两张表，光认「初评/终评」会串期。 */
    const iFinal = pick(['2026H1 终评绩效等级', '2026H1终评绩效等级'], idxAll('2026', '终评'));
    /* 25H1 / 25H2 各有两种列名（2026-10-21 表格改版后）：
       26H1 那两张写「2025年中 / 2025年终」、25H1 那两张写「2025年H1终评绩效等级」、
       25H2 那张写「2025年终评绩效等级」。
       ⚠️ 全站一条硬规则：**初评一律不读，只认终评**（2026-10-21 用户两次强调）。
          所以这里没有「找不到终评就退到初评」的兜底——那正是用户不要的东西。 */
    const i25M = pick(['2025年中'], idxAll('2025', 'H1', '终评'));
    const i25Y = pick(['2025年终'], idxAll('2025', '年终评'));
    const iChange = pick(['近半年绩效变动'], idxInc('绩效变动'));
    const iCoeff = pick(['工时投入系数'], idxInc('投入系数'));
    const iBracket = pick(['投入系数分档'], idxInc('投入分档'));
    const iOrgScore = pick(['组织建设评分'], idxInc('组织建设评分'));
    const iOrgBracket = pick(['组织建设分档'], idxInc('组织分档'));
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
      put('grade2025M', i25M); put('grade2025Y', i25Y);
      put('finalGrade', iFinal);
      put('gradeChange', iChange); put('inputBracket', iBracket);
      put('orgScore', iOrgScore); put('orgBracket', iOrgBracket); put('rank', iRank);
      if (iCoeff >= 0) { const n = parseFloat(row[iCoeff]); if (!isNaN(n)) rec.inputCoeff = n; }
      ['grade2024M','grade2024Y','grade2025M','grade2025Y','finalGrade'].forEach(k => {
        if (rec[k]) rec[k] = rec[k].toString().trim();
      });
      deriveGrade26H1(rec);
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
/* 入离职趋势图上「点某个月」筛谁：该月入职的 + 该月离职的，两拨合在一起。
   两条线在同一个月份上是一件事的两面，按「点的是哪条线」分会让人在
   「我点的那条线上的点算不算」上纠结（2026-10-15 用户拍板合并）。
   总览页与人员概览页共用同一个谓词，两处不各写一份。 */
function trendMonthFilter(m) {
  return d => !!((d.joinDate && d.joinDate.indexOf(m) === 0) || (d.leaveDate && d.leaveDate.indexOf(m) === 0));
}
/* 每月末在册人数（含在职与已离职历史） */
/* 「某时点在册几人」。每人两个日期解析一次，供需要反复求同一批人在不同时点的
   在册数的调用方复用（区间对比要按年各算 12 个月末 = 上百次），
   否则每次都要把全表重扫一遍、每人重新 new Date 两次。
   pairs = [[入职ms, 离职ms|null], ...]（缺入职日的行不参与，与 headcountAt 一致） */
function tenurePairsOf(data) {
  const out = [];
  for (const d of data) {
    const j = toDate(d.joinDate);
    if (!j) continue;
    const l = toDate(d.leaveDate);
    out.push([j.getTime(), l ? l.getTime() : null]);
  }
  return out;
}
function headcountAtMs(pairs, endMs) {
  let n = 0;
  for (const p of pairs) if (p[0] <= endMs && (p[1] == null || p[1] > endMs)) n++;
  return n;
}
function headcountAt(data, endMs) { return headcountAtMs(tenurePairsOf(data), endMs); }
/* 「点这张卡 → 人员明细带名单」的属性组。KPI 卡与人群概览卡共用 ——
   手写两遍最容易漏掉键盘那两条（Enter / 空格），漏了就等于这两个能力对键盘用户不可达。 */
function clickCardAttrs(cls, label, jumpKey) {
  return `class="${cls} clickable" role="button" tabindex="0" aria-label="查看「${esc(label)}」名单"` +
    ` onclick="jumpToDetail('${jumpKey}')"` +
    ` onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();jumpToDetail('${jumpKey}')}"`;
}
function kpi(label, value, sub, colorVar, scope, scopeLabel, jumpKey) {
  const dot = colorVar ? `<span class="kpi-dot" style="--tone:var(${colorVar})"></span>` : '';
  const tag = scope ? scopeTag(scope, scopeLabel) : '';
  /* jumpKey：人数型卡片点击 → 人员明细带筛选名单（jumpToDetail 体系）。
     比率/均值卡（离职率、司龄、转正率）不传，不可点 */
  const open = jumpKey
    ? `<div ${clickCardAttrs('kpi-card', label, jumpKey)}>`
    : '<div class="kpi-card">';
  return `${open}<div class="kpi-label">${dot}${label}${tag}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub||''}</div></div>`;
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
/* 在职 / 离职药丸：员工明细表与梯队页的明细表共用一处标记，换色或加图标只改这里 */
function statusTag(d) {
  return d.status === '在职'
    ? '<span class="tag tag-active">在职</span>'
    : '<span class="tag tag-inactive">离职</span>';
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
/* 按主题缓存：这里的值只随 data-theme 变（全库没有 setProperty 之类的运行期覆盖）。
   每建一张图都要用一份，而单张页面多则 15 张图 —— 各自读 35 个变量等于 500+ 次
   getComputedStyle。缓存命中时是纯返回。 */
let _themeColors = null, _themeColorsKey = null;
function themeColors() {
  const th = document.documentElement.getAttribute('data-theme') || 'light';
  if (_themeColors && _themeColorsKey === th) return _themeColors;
  const tc = {};
  ['--ink','--ink-2','--ink-3','--gridline','--surface','--surface-2','--border','--accent','--accent-strong','--accent-soft',
   '--s1','--s2','--s3','--s4','--s5','--s6',
   '--type-permanent','--type-probation','--type-intern-paid','--type-intern-unpaid','--type-outsource','--type-labor',
   '--grade-sa','--grade-a','--grade-bp','--grade-b','--grade-bm','--grade-c','--grade-d',
   '--expire-30','--expire-60','--expire-90',
   /* 公司语义色：pos 红=好 · neg 绿=不好 · warn 黄=警告 */
   '--pos','--neg','--warn']
    .forEach(v => tc[v.slice(2)] = getCSS(v));
  _themeColors = tc; _themeColorsKey = th;
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
   ⚠️ 不能用「白字」写死：深色模式下条底是提亮过的浅色（--s1 是 #3186ff），
      白字落在上面读不清。--surface / --ink 这两支正好随主题翻转，
      所以「条底亮 → 取 --surface，条底暗 → 取 --ink」在两个主题下都成立。
   这两个值按主题缓存：afterDatasetsDraw 每帧都跑，getComputedStyle 不能每帧读。 */
/* 主题相关小色组的统一缓存：值只随 data-theme 变，而绘制回调每帧都跑。
   加新的一组色就再调一次 themeCached()，别复制「比对主题 → 重建」这段（barInks/ringInks
   曾经各写了一份，主题切换的失效逻辑也得跟着抄两遍）。 */
const _themeCache = new Map();
function themeCached(key, build) {
  const th = document.documentElement.getAttribute('data-theme') || 'light';
  const hit = _themeCache.get(key);
  if (hit && hit.th === th) return hit.val;
  const val = build();
  _themeCache.set(key, { th, val });
  return val;
}
function barInks() {
  return themeCached('bar', () => ({
    onLightBar: getCSS('--ink') || '#0d1b2a',
    onDarkBar:  getCSS('--surface') || '#ffffff',
    /* 数值文字自己的墨色也并进来：它同样每帧要用，此前单独 getCSS 一次，
       正好抵消了本缓存的用意 */
    ink2:       getCSS('--ink-2') || '#666',
  }));
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
    const inks = barInks();
    const ink2 = inks.ink2;
    ctx.save();
    ctx.font = chartFont().v;
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
/* 图表字号 / 字体串的唯一来源：柱顶数值（BAR_VALUE_PLUGIN）、环形标注（RING_LABEL_PLUGIN）、
   坐标轴刻度与图例（tickFontSize）全走这里。字体族与字重约定只写一处。
   字号不随主题变（--fs-12 是静态令牌），拼一次缓存即可 ——
   chartDefaults 每次建图都跑、40+ 张图逐个 getComputedStyle 是纯浪费。 */
let _chartFont = null;
function chartFont() {
  if (_chartFont) return _chartFont;
  const size = getCSS('--fs-12') || '12px';
  const n = parseFloat(size);
  /* 字族取 --font 令牌，不写死：改令牌时图表里的字要跟着页面一起变，
     否则页面换了字体、图里还是旧的那套（画布文字不受 CSS 继承影响） */
  const fam = getCSS('--font') || '"Noto Sans SC", sans-serif';
  return (_chartFont = {
    size: isFinite(n) ? n : 12,
    v: `600 ${size} ${fam}`,   // 柱顶数值 / 环形人数
    p: `400 ${size} ${fam}`,   // 环形占比
    lineH: (isFinite(n) ? n : 12) * 1.2,
  });
}
/* 坐标轴刻度 / 图例字号 = 全站最小档 --fs-12。10px 那一档已在 v8.10 撤掉，
   图表这边是最后的漏网之鱼（2026-10-15 补齐，别再把 10 写回来）。 */
function tickFontSize() { return chartFont().size; }

/* ── 环形 / 饼图外置标注：引导线 + 「类别名 / 人数 (占比)」两行（2026-10-15 用户要求）──
   Chart.js 只把数值放进 tooltip —— 不悬停就看不到。这里在弧面外画引导线 + 名称 + 数值。
   横向空间不会自己让出来：先量出最长的一条标签，再从 layout.padding 左右各让出这么多，
   否则文字压在环面上（见 ringLabelPad）。
   ⚠️ 标签排两行而不是一行：卡片内容宽只有 312px，单行标签会把环半径
      压到 60px 出头、环缩成一小圈；拆两行后让出的宽度只由**较长那行**决定。
   ⚠️ 字号必须跟 --fs-12 走、且两边用同一份缓存：量宽度用的字体和画的时候不是同一个，
      留出的空间就会对不上（差一点就被截断）。 */
const RING_LEADER = 16;   // 弧面外那段斜线的水平长度
const RING_GAP = 6;       // 斜线末端到文字的留白
/* 图例一条占的固定开销：色块（boxWidth 6，usePointStyle 时是那个小圆点）+ 色块到文字的间隙
   + 条目两侧内距。Chart.js 的 _fitRows 判「这一行还放不放得下」用的是
   `boxWidth + fontSize/2 + 文字宽 + 2×padding`，按我们的档位（6 + 12/2 + 2×10）= 32。
   ⚠️ 图例**不会折行**（理由见 labelBudget），所以这 32px 是硬开销，不能省。 */
const RING_LEGEND_CHROME = 32;
/* 折行的下限：再挤也不把名称折到比这更窄 —— 一行只剩两三个字，读起来比被裁还难受。 */
const RING_MIN_LABEL_W = 48;
/* 一块标注最多排几行。目标形态是「名称（最多两行）+ 人数 (占比)（一行）」= 三行；
   再多，几块挤在同一侧时就会互相压住（转正与合同页 5 块实测）。 */
const RING_LABEL_LINES = 3;
/* ⚠️ 人数行**必须**一行 —— 判据是「名称 ≤ 2 行 且 人数 = 1 行」，不是「整块 ≤ 3 行」。
   写成「整块 ≤ 3 行」的话，「男 / 266 人 / (84.4%)」也算合格，二分就会一路缩到下限，
   把一行本来放得下的短名称也拆成两行。 */
const RING_PCT_LINES = 1;
/* 二分找最小预算的上界：比任何真实标签都宽，到这个宽度必然「名称一行 + 人数一行」。 */
const RING_MAX_LABEL_W = 400;
/* 环形标注的三支颜色按主题缓存（与 barInks 同一套理由）：
   afterDatasetsDraw 每帧都跑，getComputedStyle 不能每帧读。 */
function ringInks() {
  return themeCached('ring', () => ({
    name: getCSS('--ink-2') || '#555',   // 类别名（第 1 行）
    pct:  getCSS('--ink-3') || '#888',   // 人数+占比（第 2 行）
    line: getCSS('--ring-leader') || '#9db0c6',   // 引导线
  }));
}
/* 量文字宽度用的离屏画布：只在建图时用，不进 DOM */
let _mctx = null;
function measureCtx() { return _mctx || (_mctx = document.createElement('canvas').getContext('2d')); }
/* 标签两段：**类别名** + 「人数 (占比)」。占比精度与 tooltip 一致（1 位小数），两处不能各写一个。
   2026-10-15 用户两轮反馈收敛到这个形态：
     第一轮「图例写完整：女: 49 人 (15.6%)」→ 更正为「图例还原，是引导线指着的数字要写完整」；
     第二轮「对应的类别也要写上，现在只写了数字和比例」。
   所以：**图例只留名称，名字 + 数字都挂在引导线上**。
   两段而不是一行「离职替补 11 人 (36.7%)」的原因见 ringLabelPad：卡片内容宽只有 312px，
   单行会把环半径压掉三分之一。拆开后，让出空间的宽度由**较长的那段**决定。 */
/* 占比串，精度 1 位小数。标注与环形图 tooltip 共用这一处 ——
   两处各写一个 toFixed(1) 的话，改精度必然漏掉一边。 */
function ringPct(v, total) { return (v / total * 100).toFixed(1) + '%'; }
/* 把一段文字折成「每行都不超过 budget」的若干行。放得下就原样一行，不硬折。
   有空格按空格断（拉丁名 / 「176 人 (55.3%)」），没有空格按字缝均分（中文）。 */
function wrapRingText(s, budget, font) {
  const txt = String(s == null ? '' : s);
  if (!txt) return [''];
  const c = measureCtx();
  c.font = font;
  if (c.measureText(txt).width <= budget) return [txt];
  const toks = txt.split(/\s+/).filter(Boolean);
  if (toks.length > 1) {
    const lines = []; let cur = '';
    toks.forEach(t => {
      const cand = cur ? cur + ' ' + t : t;
      if (cur && c.measureText(cand).width > budget) { lines.push(cur); cur = t; } else cur = cand;
    });
    if (cur) lines.push(cur);
    return lines.flatMap(t => c.measureText(t).width <= budget ? [t] : splitEven(t, budget, c, font));
  }
  return splitEven(toks[0], budget, c, font);
}
/* 无空格可依（中文）时的兜底：先按「总宽 ÷ 预算」估出行数，再**等分字缝**，
   取第一个每行都放得下的行数。等分而不是贪心，是为了不留下「同」这种孤字。 */
function splitEven(s, budget, c, font) {
  c.font = font;
  const total = c.measureText(s).width;
  if (total <= budget) return [s];
  for (let n = Math.max(2, Math.ceil(total / budget)); n <= s.length; n++) {
    const per = s.length / n, lines = [];
    for (let k = 0; k < n; k++) lines.push(s.slice(Math.round(k * per), Math.round((k + 1) * per)));
    if (lines.every(t => t && c.measureText(t).width <= budget)) return lines;
  }
  return [s];   // budget 比一个字还窄，交给上层（RING_MIN_LABEL_W 兜着，正常走不到）
}
/* 标注行：**名称 + 「人数 (占比)」**，各自按 budget 折行。
   2026-10-16 起是「名称折、人数也折」—— 起因是转正与合同页的「无固定期限劳动合同」
   9 字 ≈108px，光折名称救不回图例（见 labelBudget 里那段推导）。
   ⚠️ 每行带自己的字体与语义（pct 只是「这行是人数行」的标记，画的时候据此选颜色），
      别再靠「最后一行是人数」这条位置约定 —— 折行后最后一行可能是「(55.3%)」。 */
function ringLabelLines(v, total, name, budget) {
  const f = chartFont();
  return [
    ...wrapRingText(name, budget, f.v).map(t => ({ t, f: f.v, pct: false })),
    ...wrapRingText(`${+v} 人 (${ringPct(+v, total)})`, budget, f.p).map(t => ({ t, f: f.p, pct: true })),
  ];
}
/* 一行标注文字最多能占多少像素 = 让每一块都排成「名称最多两行 + 人数一行」的**最小**宽度。
   取最小值而不是「越大越好」：预算越小 → 让出的宽度越小 → 环越大；只要行数不超上限，
   窄一点总是更划算。行数随预算单调不增，所以直接二分。
   ⚠️ 这里**不看画布宽**。曾经按「图例也得放得下」反推过一版，结果量宽与画字用了两个
      不同的宽度（建图那一刻 el.clientWidth 是 canvas 的固有尺寸 300，Chart.js 铺开后才
      是容器真宽 312），让出的空间和实际文字差十几像素，末尾被画布裁掉。
      现在预算只由**文字本身**决定，量宽与画字必然一致。图例放不放得下另判（见 makeChart）。 */
/* 折行阈值的结果只取决于「各块人数 + 名称」，而 RING_LABEL_PLUGIN 是**每帧**调它
   （入场动画、每次 hover 重绘）。12 步二分 × 每块 measureText 跑一帧几次太浪费，
   按输入缓存 —— 字号是静态令牌（见 chartFont），不需要跟主题失效。 */
const _ringBudgetCache = new Map();
function labelBudget(data, labels) {
  const ck = (labels || []).join('\u0001') + '\u0002' + data.join(',');
  if (_ringBudgetCache.has(ck)) return _ringBudgetCache.get(ck);
  const total = data.reduce((a, b) => a + (+b || 0), 0);
  const fits = budget => {
    let ok = true;
    data.forEach((v, i) => {
      if (!ok || !(+v)) return;
      const ls = ringLabelLines(v, total, (labels || [])[i], budget);
      const pct = ls.filter(x => x.pct).length;
      if (pct > RING_PCT_LINES || ls.length > RING_LABEL_LINES) ok = false;
    });
    return ok;
  };
  let lo = RING_MIN_LABEL_W, hi = RING_MAX_LABEL_W;
  for (let k = 0; k < 12; k++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid; else lo = mid;
  }
  if (_ringBudgetCache.size > 64) _ringBudgetCache.clear();   // 页面数据轮换后别无限长
  _ringBudgetCache.set(ck, hi);
  return hi;
}
/* 图例要占多宽：最宽的一条 + 色块与内距。Chart.js 的图例**不折行**（见 makeChart），
   所以这是一条硬底线 —— 放不下就得把图例去掉，不能指望它自己缩。 */
function legendNeedW(labels) {
  const c = measureCtx();
  c.font = chartFont().p;
  let w = 0;
  (labels || []).forEach(t => { w = Math.max(w, c.measureText(String(t == null ? '' : t)).width); });
  return w + RING_LEGEND_CHROME;
}
/* 这张环形图左右各要让出多少像素。没有块或合计为 0 → 不画、不让空间。
   ⚠️ 2026-10-15 起**一块也画**（原先 `length < 2` 就退出）。当时不画的理由是
   「100.0% 是废话，图例已经说明」——但数字已从图例挪到标注上，再退出就等于
   整张图一个数字都没有（「前/中/后台」只有中台一块时就是这样）。
   多出的那行 100.0% 是冗余，但比「什么都没有」强。 */
function ringLabelPad(data, labels) {
  const total = data.reduce((a, b) => a + (+b || 0), 0);
  if (!data.length || !total) return 0;
  const c = measureCtx();
  const budget = labelBudget(data, labels);
  let w = 0;
  data.forEach((v, i) => {
    if (!(+v)) return;
    ringLabelLines(v, total, (labels || [])[i], budget)
      .forEach(ln => { c.font = ln.f; w = Math.max(w, c.measureText(ln.t).width); });
  });
  return Math.ceil(w) + RING_LEADER + RING_GAP + 2;
}
const RING_LABEL_PLUGIN = {
  id: 'ringLabels',
  afterDatasetsDraw(chart) {
    const meta = chart.getDatasetMeta(0);
    const data = (chart.data.datasets[0] || {}).data || [];
    const total = data.reduce((a, b) => a + (+b || 0), 0);
    if (!meta || !meta.data || !meta.data.length || !total) return;   /* 一块也画，理由见 ringLabelPad */
    const f = chartFont(), ctx = chart.ctx, area = chart.chartArea;
    /* 折行阈值必须与 ringLabelPad 算的**完全一致**（同一份 labelBudget + 同一个宽度），
       否则量出来让出的空间和实际画上去的文字对不上，末尾照样被截。
       chart.width 是画布 CSS 宽，与 makeChart 里传进去的 el.clientWidth 同值。 */
    const budget = labelBudget(data, chart.data.labels);
    const a0 = meta.data[0], cx = a0.x, cy = a0.y, R = a0.outerRadius;
    /* ⚠️ name 与 pct 是**文字色**（两行标注），不是引导线色 —— 别把 pct 一起删了。
       文字要吃 4.5:1，所以仍走 --ink-2 / --ink-3；只有那条线走 --ring-leader。
       引导线走专用的 --ring-leader（浅/深各一档，约 2.2:1），不是 --ink-3、也不是 --gridline：
       两个极端都试过了 —— --gridline 1px 几乎看不见（「指引线可以再明显一点」），
       换成 --ink-3（5.56:1）后又太重（「指引线颜色太深了，浅一点」）。
       最终：**粗细留住 1.5px**（那是「看得见」的来源），**颜色降一档**。
       线只负责把标签牵到弧面，信息在标签文字里，所以不吃 3:1 的图形门槛。 */
    const inks = ringInks();
    const line = inks.line, lineW = 1.5;

    /* 每条弧：中点角 → 环上的出发点、左右归属、原始纵向落点 */
    const items = [];
    meta.data.forEach((arc, i) => {
      const v = +data[i] || 0;
      if (!v || arc.endAngle - arc.startAngle < 1e-4) return;
      const mid = (arc.startAngle + arc.endAngle) / 2;
      const py = cy + Math.sin(mid) * (R + 2);
      const lines = ringLabelLines(v, total, (chart.data.labels || [])[i], budget);
      items.push({
        side: Math.cos(mid) >= 0 ? 1 : -1,
        px: cx + Math.cos(mid) * (R + 2), py,
        y: py, lines, h: f.lineH * lines.length,
      });
    });
    /* 避让按**最高的一块**留间距：块高随名称折行数不同（2 行或 3 行），
       统一按最大值排，保证任何两块都不叠 —— 比逐块算可变间距简单，且不会算漏。 */
    const blockH = items.reduce((m, it) => Math.max(m, it.h), f.lineH * 2);

    /* 同侧避让：按原始 y 排好 → 前向推开 → 后向推回 → 整组平移回绘图区。
       ⚠️ 最后一步必须**整组平移**，不能逐个夹取：逐个夹会把被顶出上边界的那个
          按回来，正好压回它下面的邻居身上（左侧顶部两条挤成一团就是这么来的）。
       弧全部堆在同一侧时（合同类型图左侧有 4 条），可用高度可能不够，
       所以先按可用高度把最小间距压到装得下，再排。 */
    [1, -1].forEach(sd => {
      const grp = items.filter(it => it.side === sd).sort((a, b) => a.y - b.y);
      const lo = area.top + blockH / 2, hi = area.bottom - blockH / 2;
      const gap = grp.length > 1 ? Math.min(blockH, (hi - lo) / (grp.length - 1)) : blockH;
      for (let k = 1; k < grp.length; k++) { const d = gap - (grp[k].y - grp[k-1].y); if (d > 0) grp[k].y += d; }
      for (let k = grp.length - 2; k >= 0; k--) { const d = gap - (grp[k+1].y - grp[k].y); if (d > 0) grp[k].y -= d; }
      if (grp.length) {
        const shift = grp[0].y < lo ? lo - grp[0].y
                    : grp[grp.length - 1].y > hi ? hi - grp[grp.length - 1].y : 0;
        if (shift) grp.forEach(it => { it.y += shift; });
      }
    });

    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.lineWidth = lineW;
    ctx.lineCap = 'round';
    ctx.strokeStyle = line;
    items.forEach(it => {
      const ex = cx + it.side * (R + RING_LEADER);
      const tx = ex + it.side * RING_GAP;
      ctx.beginPath();
      ctx.moveTo(it.px, it.py);
      ctx.lineTo(ex, it.y);
      ctx.stroke();
      ctx.textAlign = it.side > 0 ? 'left' : 'right';
      /* 整块以 it.y 为中心竖排：名称若干行（600 / --ink-2）在前，人数行（400 / --ink-3）
         在后。行自己带字体与语义（见 ringLabelLines），这里不猜「哪一行是人数行」。
         两行时算出来的落点与旧版逐行写死的 y ∓ lineH/2 完全一致。 */
      const y0 = it.y - it.h / 2;
      it.lines.forEach((ln, k) => {
        ctx.font = ln.f;
        ctx.fillStyle = ln.pct ? inks.pct : inks.name;
        ctx.fillText(ln.t, tx, y0 + f.lineH * (k + 0.5));
      });
    });
    ctx.restore();
  },
};
/* 动效三值只读一次：令牌是静态的、系统 reduced-motion 也不会中途变，
   没必要每建一张图就 getComputedStyle 两次 + 新建一个 matchMedia
   （一次筛选变化会建 40+ 张图）。首次用到时算好缓存起来。 */
let _chartMotion = null;
function chartMotion() {
  return _chartMotion || (_chartMotion = {
    reduced: reduceMotion(), slow: cssMs('--dur-slow', 300), fast: cssMs('--dur-fast', 150),
  });
}
function chartDefaults(tc) {
  const mo = chartMotion();
  const tick = tickFontSize();   // 刻度 / 图例字号，见 tickFontSize()
  return {
    responsive: true, maintainAspectRatio: false,
    /* 悬停 v2（2026-10-12 用户两次反馈灵敏度差，重写）：
       ① intersect:false 全局兜底 —— v4 的 hover 自带 intersect:true 默认，
          只写 interaction 会有「鼠标离图形稍远就点不亮」的死角。
       ② mode 默认 nearest：永远吸附最近的元素，鼠标在图上任意位置都有反馈；
          多数据集图表（分组/堆叠/双线）在 makeChart 里升级为 index（整列对齐）。
       ③ transitions.active 默认 400ms —— 悬停高亮和 tooltip 淡入要等半拍才出现，
          这才是「不灵敏」的体感主因，压到 --dur-fast（150ms）跟手不拖影。 */
    interaction: { mode:'nearest', intersect:false },
    hover: { mode:'nearest', intersect:false },
    /* 入场动画：Chart.js 默认 1000ms，一次筛选变化会让 40+ 张图各跑一遍，
       是「点一下要等一下」的主因。收进令牌的 --dur-slow（300ms，正好是 UI 动效上限）。
       easing 用 Chart.js 的 easeOutCubic 对应令牌里的 --ease-out（cubic-bezier(.215,.61,.355,1)）。
       ⚠️ 别换回 easeOutQuart —— 它和 CSS 侧旧的 expo 曲线同族，前段太陡，
          用户 2026-10-13 反馈「太快、突兀」就是这个。 */
    animation: mo.reduced ? false : { duration: mo.slow, easing: 'easeOutCubic' },
    transitions: { active: { animation: { duration: mo.fast } } },
    layout: { padding: { top: 6, right: 4, bottom: 0, left: 0 } },
    plugins: {
      legend: { position:'bottom', labels: { padding:10, usePointStyle:true, pointStyle:'circle', font:{size:tick}, boxWidth:6, boxHeight:6, color:tc['ink-2'] } },
      tooltip: { backgroundColor: tc.surface, titleColor: tc.ink, bodyColor: tc['ink-2'],
        borderColor: tc.gridline, borderWidth: 1, padding: 10, cornerRadius: 8, boxPadding: 4, usePointStyle: true, titleFont: { weight: '600' } },
    },
    scales: {
      x: { grid: { display:false }, ticks: { font:{size:tick}, padding:4, color:tc['ink-3'] }, border: { display:false } },
      y: { beginAtZero: true, grid: { lineWidth:1, color:tc.gridline }, ticks: { font:{size:tick}, padding:4, color:tc['ink-3'] }, border: { display:false } },
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
    /* 上面升级成 index 后有个副作用：点一下拿到的元素是**该列所有系列**，
       顺序按 datasetIndex —— els[0] 永远是第一条。于是「点第二条线」也返回第一条，
       调用方按 els[0].datasetIndex 判断就永远判成第一系列：
       入离职趋势图点「离职」的点，筛出来的是「入职」的人。
       按「到鼠标落点」的距离重排，els[0] 回到用户真正点中的那一条。
       排序稳定，距离相同时保持原顺序。 */
    const userClick = options.onClick;
    if (typeof userClick === 'function') {
      options.onClick = (evt, els, chart) => {
        if (els && els.length > 1) {
          els = els.slice().sort((a, b) => {
            const da = (a.element.x - evt.x) ** 2 + (a.element.y - evt.y) ** 2;
            const db = (b.element.x - evt.x) ** 2 + (b.element.y - evt.y) ** 2;
            return da - db;
          });
        }
        return userClick(evt, els, chart);
      };
    }
  }
  /* 环形 / 饼图这一类（非直角坐标系）要做的三件事：不带 scales、让出标注宽度、
     只挂环形标注插件。判据只写一处，别在三个地方各写一遍 type 比较。 */
  const isRing = type === 'doughnut' || type === 'pie';
  if (type === 'doughnut') {
    options.cutout = '62%';
    /* 环形图弧面之间留白多，chartDefaults 的 nearest + intersect:false 正合适：
       不必压中弧面，靠近即命中 */
    options.plugins.tooltip.callbacks = { label: ctx => {
      const t = ctx.dataset.data.reduce((a,b)=>a+b,0) || 1;
      return `${ctx.label}: ${ctx.parsed} 人 (${ringPct(ctx.parsed, t)})`; } };
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
  /* 环形 / 饼图没有坐标轴，但 chartDefaults 里的 x/y 还挂在 options.scales 上 ——
     Chart.js 照样会把这两根轴建出来并绘制：y 轴 beginAtZero 又没有数据，
     只剩 0 这一个刻度，画出来就是横穿环面的一根参考线。非直角坐标系的图型直接不带 scales。 */
  let pad = 0;   // 环形图左右各让出多少（见 ringLabelPad）；非环形图恒为 0
  if (isRing) {
    delete options.scales;
    /* 外置标注要横向空间：按最长的一条标签把左右让出来（0 = 不画标签，见 ringLabelPad）。 */
    pad = ringLabelPad(datasets[0].data || [], labels);
    if (pad) options.layout = { padding: { left: pad, right: pad, top: 6, bottom: 0 } };
    /* 图例走 Chart.js 默认（只有色块 + 名称），数字归指引线旁的标注（见 ringLabelLines）。
       ⚠️ 图例**不能折行**：4.4.7 的 legend 布局只按单行量宽高（_fitRows 用一个 itemHeight，
          不乘 text 数组的行数），给 text 传数组能画出两行却排不下两行，条目会互相重叠
          —— 2026-10-16 试过，有截图取证，别再走这条路。
       既然它折不了、又和标注抢同一条横向空间，那就只能二选一：放得下才画，放不下就别画。
       放不下时图例还得占掉一百多像素高（宽卡片里一条占一行），把环和标注一起挤扁。
       类别名在引导线上已经写全，图例本来就是冗余的（CLAUDE.md v8.13 ② 记过一笔）。
       ⚠️ 量容器宽必须用 **parentElement**：建图这一刻 canvas 还没被 Chart.js 铺开，
          el.clientWidth 读到的是 canvas 的**固有尺寸 300**，比容器真宽 312 少十几像素。 */
    const availW = (el.parentElement || el).clientWidth;
    if (pad && availW > 0 && legendNeedW(labels) > availW - 2 * pad) {
      options.plugins.legend = { ...options.plugins.legend, display: false };
    }
  }
  const inst = new Chart(el.getContext('2d'),
    { type, data: { labels, datasets }, options, plugins: isRing ? [BAR_VALUE_PLUGIN, RING_LABEL_PLUGIN] : [BAR_VALUE_PLUGIN] });
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
/* 环形图 = makeChart 的一条分支，不再自己 new Chart（2026-10-15 合并）。
   原先这里是一条并行路径，两处悄悄分家：① 没有 cutout，Chart.js 默认 50%，
   比别处（62%）粗一圈；② options 是浅合并，调用方一传 plugins 就把主题化
   tooltip 整块顶掉（深色模式变白底黑字）。加环图别再另起一条路径。 */
function doughnutChart(id, labels, data, colors, opts) {
  /* 弧面描边只要 --surface 一支：这里读 40 个变量拼整个 themeColors() 只为取一个值，
     而 makeChart 内部已经读过一次整份了 */
  const surface = getCSS('--surface') || '#fff';
  makeChart(id, 'doughnut', labels,
    [{ data, backgroundColor: colors, borderWidth: 2, borderColor: surface }], opts);
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
/* 弹窗里的两枚排序列（员工明细表与 mini-table 共用）：传进各自的下单函数名即可 */
function fpSortHtml(ascJs, descJs) {
  return `<div class="fp-sort"><button class="fp-sort-btn" onclick="${ascJs}"><span class="mi">arrow_upward</span> 升序</button>` +
    `<button class="fp-sort-btn" onclick="${descJs}"><span class="mi">arrow_downward</span> 降序</button></div>`;
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

/* ═══ 下拉 · 自定义件（2026-10-14 用户拍板：原生 select 弹层太丑）═══
   原生 <select> 保留作数据源（display:none，value/options/onchange 全部照旧），
   上面盖一层「触发按钮 + 列表框」。改值仍走 select.value + change 事件，
   onFilterChange 等既有链路零改动。设计系统：
   高度 --ctl-h / 圆角 --radius-sm / 浮层 --shadow-float + --z-popup /
   动效 --dur-base + --ease-out（令牌注释里「下拉」就是这一档）/
   箭头 expand_more 收进 --space-8 内距，不贴边。

   2026-10-15：从「只接管筛选栏」扩到**全站任意 <select>**（P16：默认接管，
   留原生才需要写理由）。新增接管的三处：分页条 .pg-select ×2、多选模式条
   .gb-sel ×2、区间对比 .range-select ×2。
   （.gb-sel 的两个冻结下拉已于 2026-10-15 随悬浮工具条一并删除，接管逻辑不必跟着改 ——
     它扫的是全文档的 <select>，没有这号元素自然就跳过了。）
   三处的共性坑：**它们是 innerHTML 重铺出来的**，重铺后旧按钮连同 select 一起没了 ——
   所以渲染完必须再调一次 enhanceSelects()（幂等，已接管的靠 sel.__selx 跳过）。 */
/* 列表框只在**打开时**建：菜单关着看不见，跟着每次筛选变化重建是白做功 */
function selxBuildMenu(wrap, sel) {
  wrap.querySelector('.selx-menu').innerHTML =
    [...sel.options].map(o =>
      `<div class="selx-opt" role="option" tabindex="-1" data-v="${esc(o.value)}" aria-selected="${o.selected}">${esc(o.textContent.trim())}</div>`).join('');
}
/* 只同步按钮文字。选项变了不必重建菜单——下次 selxOpen 会从 sel.options 重新生成 */
function selxSync(sel) {
  const wrap = sel.__selx;
  if (!wrap) return;
  const cur = sel.options[sel.selectedIndex];
  wrap.querySelector('.selx-label').textContent = cur ? cur.textContent.trim() : '';
}
/* 顶层 function 声明本身就是 window 的属性，不必再赋一次 */
function selxSyncAll() { document.querySelectorAll('select').forEach(selxSync); }
let openSelx = null;   // 同一时刻最多开一个，留着它就不必每次点按全文档查一遍
function selxClose(wrap) {
  if (!wrap) return;
  wrap.classList.remove('open');
  wrap.querySelector('.selx-menu').hidden = true;
  wrap.querySelector('.selx-btn').setAttribute('aria-expanded', 'false');
  if (openSelx === wrap) openSelx = null;
}
function selxMark(opt) {
  if (!opt) return;
  opt.parentElement.querySelectorAll('.selx-opt').forEach(o => o.classList.toggle('active', o === opt));
}
function selxOpen(sel, wrap) {
  if (openSelx) selxClose(openSelx);
  selxBuildMenu(wrap, sel);
  wrap.classList.add('open');
  const menu = wrap.querySelector('.selx-menu');
  menu.hidden = false;
  wrap.querySelector('.selx-btn').setAttribute('aria-expanded', 'true');
  openSelx = wrap;
  /* 朝哪边开：菜单此刻已经可见，量一次就有数。触发器贴着视口底部时（分页条在页面最下沿）
     默认的向下开会把菜单开到屏幕外面，往上翻 —— 上面得真放得下才翻，否则宁可就地滚。 */
  const mr = menu.getBoundingClientRect();
  const br = wrap.getBoundingClientRect();
  wrap.classList.toggle('flip',
    mr.bottom > window.innerHeight - 8 && br.top - mr.height - 8 > 0);
  const cur = menu.querySelector('[aria-selected="true"]') || menu.querySelector('.selx-opt');
  selxMark(cur);
  fpFocus(cur);
}
function selxPick(sel, wrap, opt) {
  /* 同值重选什么都不用做：值没变、按钮文字没变，菜单下次打开会重建 */
  if (sel.value !== opt.dataset.v) {
    sel.value = opt.dataset.v;
    /* 按钮文字立刻跟上。**不能指望调用方回头同步**：筛选栏那条链路会经由
       onFilterChange → refreshFilterOptions → selxSyncAll 兜一圈，而分页条 /
       区间选择器根本不走那条路，文字会停在旧值上。 */
    selxSync(sel);
    /* 有的下拉一改值就整块重铺（分页条走 renderEmployeeTable），wrap 和 select 一起被换掉。
       先记下找回同一件的钥匙（下一行），change 回来再决定焦点交给谁。
       **selxClose 必须无条件调用**：游离节点也关得掉，但 openSelx 不归零的话，
       下一枚下拉就永远算作「有菜单开着」，后续点按全被当成点在菜单外。 */
    const key = sel.getAttribute('aria-label') || sel.id;
    sel.dispatchEvent(new Event('change'));   // 走既有 onchange → onFilterChange / empGoToPage
    selxClose(wrap);
    if (!wrap.isConnected) {
      /* 别对游离节点调 focus()，那等于把焦点丢给 body（P12）——去找重建后的那一件 */
      const nb = key && document.querySelector(
        'select[aria-label="' + CSS.escape(key) + '"], select[id="' + CSS.escape(key) + '"]');
      if (nb && nb.__selx) fpFocus(nb.__selx.querySelector('.selx-btn'));
      return;
    }
  } else {
    selxClose(wrap);
  }
  fpFocus(wrap.querySelector('.selx-btn'));
}
/* root 可传某个子容器：表格重铺后只需接管自己那条分页栏，不必每次扫全文档 */
function enhanceSelects(root) {
  (root || document).querySelectorAll('select:not(.selx-native)').forEach(sel => {
    if (sel.__selx) return;
    /* 名字：优先 select 自带的 aria-label（分页条 / 工具条 / 区间选择器都是这么标的），
       其次找紧邻的 <label>（筛选栏那一排）。**不能只认 previousElementSibling**——
       分页条的邻居是个只装图标的 <button>，读出来会是连字名「first_page」。 */
    const lab = sel.previousElementSibling;
    const name = sel.getAttribute('aria-label')
      || (lab && lab.tagName === 'LABEL' ? lab.textContent.trim() : '')
      || sel.id || '下拉选项';
    const wrap = document.createElement('div');
    wrap.className = 'selx' + (sel.classList.contains('group-select') ? ' is-group' : '');
    wrap.innerHTML =
      '<button type="button" class="selx-btn" aria-haspopup="listbox" aria-expanded="false"' +
      ' aria-label="' + esc(name) + '">' +
      '<span class="selx-label"></span><span class="mi selx-arrow" aria-hidden="true">expand_more</span></button>' +
      '<div class="selx-menu" role="listbox" tabindex="-1" hidden></div>';
    sel.insertAdjacentElement('afterend', wrap);
    /* 按钮继承原生件自己的类名（.pg-select / .range-select 等），
       它原有的外形规则原样生效 —— 外形只在各组件那一处定义，不在这儿抄第二遍。 */
    const btn = wrap.querySelector('.selx-btn');
    sel.classList.forEach(c => { if (c !== 'group-select') btn.classList.add(c); });
    sel.classList.add('selx-native');
    sel.__selx = wrap;

    wrap.querySelector('.selx-btn').addEventListener('click', () =>
      wrap.classList.contains('open') ? selxClose(wrap) : selxOpen(sel, wrap));
    wrap.querySelector('.selx-menu').addEventListener('click', ev => {
      const opt = ev.target.closest('.selx-opt');
      if (opt) selxPick(sel, wrap, opt);
    });
    wrap.querySelector('.selx-menu').addEventListener('keydown', ev => {
      const opts = [...wrap.querySelectorAll('.selx-opt')];
      const i = opts.findIndex(o => o.classList.contains('active'));
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        const n = opts[(i + (ev.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length];
        selxMark(n); fpFocus(n);
      } else if (ev.key === 'Home' || ev.key === 'End') {
        ev.preventDefault();
        const n = opts[ev.key === 'Home' ? 0 : opts.length - 1];
        selxMark(n); fpFocus(n);
      } else if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        if (opts[i]) selxPick(sel, wrap, opts[i]);
      } else if (ev.key === 'Escape' || ev.key === 'Tab') {
        selxClose(wrap);
        if (ev.key === 'Escape') fpFocus(wrap.querySelector('.selx-btn'));
      }
    });
    wrap.querySelector('.selx-btn').addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && wrap.classList.contains('open')) { selxClose(wrap); }
    });
    selxSync(sel);
  });
}
/* 点外面关（mousedown 即关，与 grid 右键菜单同款口径） */
document.addEventListener('mousedown', ev => {
  if (openSelx && !openSelx.contains(ev.target)) selxClose(openSelx);
});
enhanceSelects();
