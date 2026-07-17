/* ═══════════════════════════════════════════════════════════════════════════
   hr-core.js — State, Field Mappings, Grade Utilities, Theme, Chart Helpers
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── STATE ── */
let rawData = [];
let perfData = {};
let perfFileLoaded = false;
let perfFileCount = 0;
let chartInstances = {};

/* ── FIELD MAPPINGS ── */
const FIELD_MAP = {
  '员工编号':'id','员工姓名':'name','一级部门英文简称':'center',
  '二级部门中文描述':'dept','二级部门英文简称':'deptEn','三级部门中文描述':'dept3',
  '职等中文描述':'level','子等级中文描述':'subLevel',
  '职位序列中文描述':'series','员工状态':'status',
  '员工类别中文描述':'empType','最高学历中文描述':'edu',
  '性别':'gender','出生日期':'birthDate','入职日期':'joinDate',
  '离职日期':'leaveDate','招聘来源':'source','组织类型':'orgType',
  '梯队':'talentPipeline','股权激励':'equity',
  '面试评价等级':'interviewGrade','部门简称#':'deptShort',
  '公司邮箱':'email','上级主管':'manager','公司中文描述':'company',
  '一级部门中文描述':'centerName',
  // v5 additions — with extensive aliases for common Excel variants
  '职位中文描述':'position','职位':'position','岗位':'position','职务':'position',
  '籍贯':'hometown','出生地':'hometown',
  '婚姻状况':'maritalStatus','婚姻':'maritalStatus','婚否':'maritalStatus',
  '合同类型中文描述':'contractType','合同类型':'contractType',
  '工作地点中文描述':'workLocation','工作地点':'workLocation','办公地点':'workLocation',
  '主修专业':'major','专业':'major','所学专业':'major','专业名称':'major','主修专业名称':'major','专业全称':'major','主修专业#':'major',
  '毕业学校':'school','学校':'school','毕业院校':'school','院校':'school','毕业学校全称':'school','毕业院校名称':'school','毕业学校#':'school',
  '最高学历毕业院校':'school','最高学历毕业学校':'school','毕业学校名称':'school','院校名称':'school',
  '联系电话':'phone','电话':'phone','手机':'phone','手机号码':'phone','手机号':'phone','办公电话':'phone',
  '移动电话':'phone','手机电话':'phone','联系电话(手机)':'phone','联系电话(办公)':'phone',
  '紧急联系人':'emergencyContact','紧急联系人姓名':'emergencyContact',
  '紧急联系电话':'emergencyContactPhone',
  // 新增字段 — 原工作单位、毕业时间
  '原工作单位':'prevEmployer','原单位':'prevEmployer','前工作单位':'prevEmployer','原工作单位名称':'prevEmployer',
  '原工作单位#':'prevEmployer',
  '毕业时间':'gradDate','毕业年月':'gradDate','毕业日期':'gradDate','毕业时间#':'gradDate',
  // 状态字段 — 更多别名，确保离职员工能被正确识别
  '状态':'status','在职状态':'status','人员状态':'status','员工状态值':'status',
  '人员状态值':'status','当前状态':'status',
};

/* ── GRADE UTILITIES ── */
const GRADE_ORDER = ['SA','S','A','B+','B','B-','C','D'];
const GRADE_NUM = {'SA':5,'S':5,'A':4,'B+':3.5,'B':3,'B-':2,'C':1,'D':0};
const PERIOD_KEYS = {
  'grade2024M':'2024中','grade2024Y':'2024终','grade2025M':'2025中',
  'grade2025Y':'2025终','initGrade':'2026H1初评','finalGrade':'2026H1终评'
};

function getGradeColor(grade, tc) {
  const g = (grade||'').replace(/[^A-Za-z+\-]/g,'');
  const map = {'SA':'grade-sa','S':'grade-sa','A':'grade-a','B+':'grade-bp',
    'B':'grade-b','B-':'grade-bm','C':'grade-c','D':'grade-d'};
  const key = map[g]; return key && tc ? tc[key] : (tc?tc.inkMuted:'#888');
}

function gradeTag(grade) {
  const g = (grade||'').replace(/[^A-Za-z+\-]/g,'');
  const clsMap = {'SA':'tag-grade-sa','S':'tag-grade-sa','A':'tag-grade-a',
    'B+':'tag-grade-bp','B':'tag-grade-b','B-':'tag-grade-bm',
    'C':'tag-grade-c','D':'tag-grade-d'};
  return `<span class="tag ${clsMap[g]||''}">${grade||'—'}</span>`;
}

function parseGradeChange(str) {
  if (!str) return 'stable';
  if (str.includes('升')) return 'up';
  if (str.includes('降')) return 'down';
  return 'stable';
}

/* ── THEME ── */
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme',next);
  document.getElementById('themeLabel').textContent = next==='dark'?'浅色模式':'深色模式';
  if(rawData.length) refreshAll();
}

function getCSS(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

function getThemeColors() {
  return {
    ink:getCSS('--ink'), inkSec:getCSS('--ink-secondary'), inkMuted:getCSS('--ink-muted'),
    grid:getCSS('--gridline'), baseline:getCSS('--baseline'),
    s1:getCSS('--s1'),s2:getCSS('--s2'),s3:getCSS('--s3'),s4:getCSS('--s4'),
    s5:getCSS('--s5'),s6:getCSS('--s6'),s7:getCSS('--s7'),s8:getCSS('--s8'),
    surface:getCSS('--surface'),
    typePerm:getCSS('--type-permanent'),typeProb:getCSS('--type-probation'),
    typePaid:getCSS('--type-intern-paid'),typeUnpaid:getCSS('--type-intern-unpaid'),
    typeOut:getCSS('--type-outsource'),
    gradeSa:getCSS('--grade-sa'),gradeA:getCSS('--grade-a'),gradeBp:getCSS('--grade-bp'),
    gradeB:getCSS('--grade-b'),gradeBm:getCSS('--grade-bm'),gradeC:getCSS('--grade-c'),
    gradeD:getCSS('--grade-d'),
  };
}

/* ── CHART HELPERS ── */
function destroyChart(id) { if(chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; } }

let CHART_DEFAULTS = {
  responsive: true, maintainAspectRatio: false,
  interaction: { mode:'index', intersect:false },
  plugins: {
    legend: { position:'bottom', labels:{padding:10,usePointStyle:true,pointStyle:'circle',
      font:{size:10},boxWidth:6,boxHeight:6} },
    tooltip: {
      backgroundColor:'#fff', titleColor:'#0f172a', bodyColor:'#475569',
      borderColor:'#e2e6ef', borderWidth:1, padding:8, cornerRadius:6,
      boxPadding:4, usePointStyle:true },
  },
  scales: {
    x: { grid:{display:false}, ticks:{font:{size:10}}, border:{color:'#e2e6ef'} },
    y: { beginAtZero:true, grid:{lineWidth:1}, ticks:{font:{size:10}}, border:{display:false} },
  },
};

function updateChartDefaults(tc) {
  CHART_DEFAULTS.plugins.tooltip.backgroundColor = tc.surface;
  CHART_DEFAULTS.plugins.tooltip.titleColor = tc.ink;
  CHART_DEFAULTS.plugins.tooltip.bodyColor = tc.inkSec;
  CHART_DEFAULTS.plugins.tooltip.borderColor = tc.grid;
  CHART_DEFAULTS.plugins.legend.labels.color = tc.inkSec;
  CHART_DEFAULTS.scales.x.ticks.color = tc.inkMuted;
  CHART_DEFAULTS.scales.x.border.color = tc.grid;
  CHART_DEFAULTS.scales.y.ticks.color = tc.inkMuted;
  CHART_DEFAULTS.scales.y.grid.color = tc.grid;
}

function barChart(id, labels, datasets, opts) {
  destroyChart(id);
  const tc = getThemeColors();
  const ctx = document.getElementById(id).getContext('2d');
  const COLORS = [tc.s1,tc.s2,tc.s3,tc.s4,tc.s5,tc.s6,tc.s7,tc.s8];
  const ds = datasets.map((d,i) => ({
    label: d.label, data: d.data,
    backgroundColor: d.color || COLORS[i%COLORS.length],
    borderWidth: 0, borderRadius: 3,
    barPercentage: d.barPercentage||0.6, categoryPercentage: d.categoryPercentage||0.8,
  }));
  chartInstances[id] = new Chart(ctx, {
    type:'bar', data:{labels,datasets:ds},
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: {...CHART_DEFAULTS.plugins.legend, display: ds.length>1 || (ds.length===1 && ds[0].label)},
        tooltip: {...CHART_DEFAULTS.plugins.tooltip, callbacks: ds.length>1
          ? {label:(ctx)=>`${ctx.dataset.label}: ${ctx.parsed.y} 人`}
          : {label:(ctx)=>`${ctx.parsed.y} 人`}},
      }, ...(opts||{}),
    },
  });
}

function lineChart(id, labels, datasets, opts) {
  destroyChart(id);
  const tc = getThemeColors();
  const ctx = document.getElementById(id).getContext('2d');
  const COLORS = [tc.s1,tc.s2,tc.s3,tc.s4,tc.s5,tc.s6,tc.s8];
  const ds = datasets.map((d,i) => ({
    label: d.label, data: d.data,
    borderColor: d.color||COLORS[i%COLORS.length],
    backgroundColor: (d.color||COLORS[i%COLORS.length])+'1a',
    fill: d.fill!==false, tension: 0.25, pointRadius: 2.5,
    pointHoverRadius: 4.5, borderWidth: 2,
    pointBackgroundColor: d.color||COLORS[i%COLORS.length],
  }));
  chartInstances[id] = new Chart(ctx, {
    type:'line', data:{labels,datasets:ds}, options:{...CHART_DEFAULTS,...(opts||{})}
  });
}

function doughnutChart(id, labels, data, colors) {
  destroyChart(id);
  const tc = getThemeColors();
  const ctx = document.getElementById(id).getContext('2d');
  chartInstances[id] = new Chart(ctx, {
    type:'doughnut', data:{labels, datasets:[{data, backgroundColor:colors, borderWidth:2, borderColor:tc.surface}]},
    options: {
      responsive:true, maintainAspectRatio:false, cutout:'60%',
      plugins: {
        legend: { position:'bottom', labels:{padding:8,usePointStyle:true,pointStyle:'circle',font:{size:10}} },
        tooltip: {
          backgroundColor:tc.surface, titleColor:tc.ink, bodyColor:tc.inkSec,
          borderColor:tc.grid, borderWidth:1, padding:8, cornerRadius:6,
          callbacks: { label:(ctx) => { const t=ctx.dataset.data.reduce((a,b)=>a+b,0);
            return `${ctx.label}: ${ctx.parsed} 人 (${(ctx.parsed/t*100).toFixed(1)}%)`; }},
        },
      },
    },
  });
}

/* ── DATA HELPERS ── */
const LEVEL_ORDER = ['T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','M1','M2','M3','M4','M5','P1','P2','P3','P4','P5'];

function countBy(arr, key) { const m={}; arr.forEach(d=>{const v=d[key]||'未知'; m[v]=(m[v]||0)+1;}); return m; }
function countByTwo(arr, k1, k2) { const m={}; arr.forEach(d=>{const v1=d[k1]||'未知',v2=d[k2]||'未知'; if(!m[v1]) m[v1]={}; m[v1][v2]=(m[v1][v2]||0)+1;}); return m; }

function calcTenure(jd) {
  if(!jd) return 0; const d=new Date(jd); return isNaN(d.getTime())?0:(new Date()-d)/(365.25*86400000);
}

function getMonthsList(data, n) {
  const now=new Date(), months=[];
  for(let i=n-1;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1); months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);}
  return months;
}

function countByMonth(data, dateKey, months) {
  const m={}; months.forEach(k=>m[k]=0);
  data.forEach(d=>{const val=d[dateKey]; if(!val)return; const dt=new Date(val); if(isNaN(dt.getTime()))return; const key=`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`; if(m.hasOwnProperty(key)) m[key]++;});
  return months.map(k=>m[k]);
}

function sortBy(arr, order) { const idx={}; order.forEach((v,i)=>idx[v]=i); return arr.sort((a,b)=>(idx[a]||999)-(idx[b]||999)); }

function kpi(label, value, sub, accent) {
  return `<div class="kpi-card accent-${accent}"><div class="kpi-accent"></div><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></div>`;
}

function parseExcelDate(val) {
  if(!val && val !== 0) return '';
  if(typeof val === 'number') {
    try { const d = XLSX.SSF.parse_date_code(val); if(d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`; } catch(e) {}
    return '';
  }
  return String(val).trim();
}

/* ── DEPT PAIRS (bilingual display) ── */
let deptPairs = [];

function buildDeptPairs() {
  deptPairs = [...new Map(rawData.filter(d => d.deptEn||d.dept).map(d => [d.deptEn||d.dept, {
    en: d.deptEn||d.dept, cn: d.dept||d.deptEn||''
  }])).values()].sort((a,b) => a.en.localeCompare(b.en));
}

function getDeptLabel(en) {
  const found = deptPairs.find(p => p.en === en);
  return found && found.cn && found.cn !== found.en ? `${found.en} (${found.cn})` : en;
}
