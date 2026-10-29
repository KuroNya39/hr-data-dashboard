/* ═══════════════════════════════════════════════════════════════
   v8 pages.js — 各页面渲染
   总览 / 人员概览 / 人员异动 / 转正与合同 / 梯队绩效盘点 /
   社招概览 · 社招需求 / 校招需求 · 校招跟踪 / 简报
   ═══════════════════════════════════════════════════════════════ */

const pageVisible = name => !document.getElementById('page-' + name).classList.contains('hidden');

/* 百分比统一显示：分母为 0 时给「—」，不要显示成笃定的 0.0% */
function pctText(v, digits) {
  return v == null || !isFinite(v) ? '—' : v.toFixed(digits == null ? 1 : digits) + '%';
}
/* 占比的常用形态：分子/分母 → 百分比文字。各处别再写一遍 (a/b*100).toFixed(n)+'%' */
function pctOf(part, whole, digits) {
  return pctText(whole ? part / whole * 100 : null, digits);
}
/* 净增 / 净变化一律带符号：+3 / -2 / +0（与既有显示一致，0 也写 +） */
function signed(n) { return (n >= 0 ? '+' : '') + n; }

/* ═══ 流失统计窗口（人员异动页）═══
   预设档位切换「流失 + 入职」板块；转正与合同的试用期队列口径不跟随 */
let flowWin = 'm12';
const FLOW_WINS = {
  month: { label: '本月',        short: '本月' },
  m3:  { label: '近 3 个月',  short: '近3月' },
  m6:  { label: '近 6 个月',  short: '近6月' },
  m12: { label: '近 12 个月', short: '近12月' },
  /* 年末对比档：数字 = 往前推几年（1 = 上年末）；label / short 由 flowWindowOf
     按当年年份生成（较25年末 / 较24年末 / 较23年末），跨年不用改码 */
  ye:  { yearsAgo: 1 },
  ye2: { yearsAgo: 2 },
  ye3: { yearsAgo: 3 },
};
/* 「较 N 年前年末」起点（N=1 上年末 / 2 前年末 / 3 大前年末），两页窗口共用 */
function yearEndSince(n) {
  const now = new Date();
  return new Date(now.getFullYear() - n, 11, 31);
}
/* 年末对比档按钮文案动态化：较25年末/较24年末/较23年末，跨年后自动切 26/25/24 */
function syncYearWinLabels() {
  const yy = n => String(yearEndSince(n).getFullYear()).slice(2);
  [['ye', 1], ['ye2', 2], ['ye3', 3]].forEach(([w, n]) => {
    document.querySelectorAll(`#flowWinSwitch button[data-w="${w}"]`)
      .forEach(b => { b.textContent = `较${yy(n)}年末`; });
  });
}
/* 分段切换：点亮选中项 + 重绘（人员异动页的统计窗口开关用） */
function setSegSwitch(selId, attr, value) {
  document.querySelectorAll('#' + selId + ' button').forEach(b => b.classList.toggle('on', b.dataset[attr] === value));
  refreshAll();
}

/* 一次性说明：2026-10-26「人员变化」整块从人员概览搬到人员异动，两页各有一套一模一样的
   统计窗口开关（chgWinSwitch / flowWinSwitch）也随之合并成一套（flowWin）。 */
function setFlowWin(w) {
  if (!FLOW_WINS[w]) return;
  flowWin = w;
  setSegSwitch('flowWinSwitch', 'w', w);
}

/* ═══ 人群档位（人员异动页）═══
   档位只跟顶栏「人群」筛选器，取值用 core.js 的 scopeOfFilter()（下拉的值就是
   人群代号，原来这里另写了一份 effFlowType() 做同一件事，已删）。
   2026-10-14 用户拍板：数据/图表不再单独区分员工类型——不单列实习/外协流出
   对照卡，入职/部门流出图不按人群或用工类型拆分；比率指标也不再写死正式口径 */
/* 'YYYY-MM' → 该月 1 号 00:00 的时间戳（窗口起算点） */
function monthStartMs(m) {
  const p = m.split('-');
  return new Date(+p[0], +p[1] - 1, 1).getTime();
}
/* 数据里最早的一个日期（入职 / 离职取更早者），无数据返回 null。
   「区间对比」卡的起始年份用它——别处再写一份的话，换个数据源就会一个从
   2019 起、一个从 2020 起。 */
function dataStartMs(scopeArr) {
  let min = null;
  (scopeArr || []).forEach(d => [d.joinDate, d.leaveDate].forEach(x => {
    const t = toDate(x); if (t && (min == null || t < min)) min = t;
  }));
  return min;
}
/* 窗口 → 月份列表 + 起始时刻 */
function flowWindowOf(win) {
  const now = new Date();
  const meta = FLOW_WINS[win] || FLOW_WINS.m12;
  if (meta.yearsAgo) {
    /* 年末对比档：起点=该年 12-31，
       月数=该年末到本月的自然月数（26-01 起算 10 个月…）；标签带具体年份 */
    const ye = yearEndSince(meta.yearsAgo);
    const yy = String(ye.getFullYear()).slice(2);
    return {
      months: getMonthsList((now.getFullYear() - ye.getFullYear()) * 12 + now.getMonth() + 1),
      sinceMs: ye.getTime(), label: `较 ${yy} 年末`, short: `较${yy}年末`,
    };
  }
  let months, sinceMs;
  if (win === 'month') {
    months = getMonthsList(1);
    sinceMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  } else {
    months = getMonthsList(win === 'm3' ? 3 : win === 'm6' ? 6 : 12);
    sinceMs = monthStartMs(months[0]);
  }
  return { months, sinceMs, label: meta.label, short: meta.short };
}
/* 月末时刻（当月最后一毫秒） */
function monthEndMs(m) {
  const p = m.split('-');
  return new Date(+p[0], +p[1], 1).getTime() - 1;
}
/* 窗口离职率：窗口内离职 ÷ 窗口各月末在册均值（务必传入同一口径的人群）。
   hcEnds = 各月末在册数（与 months 同序）——调用方若已算过就传进来，
   免得同一份数组被 headcountAt 扫两遍（每行都要 new Date 两次，长窗口下很可观） */
function rollingTurnover(scopeArr, months, sinceMs, hcEnds, untilMs) {
  months = months || getMonthsList(12);
  if (sinceMs == null) sinceMs = monthStartMs(months[0]);
  /* untilMs：区间上界（2026-10-15 区间离职率功能）。缺省=Infinity 即滚动到今天，
     旧调用方（六档窗口/总览）行为不变；任意历史区间传 monthEndMs(结束月) 截住 */
  const until = untilMs == null ? Infinity : untilMs;
  const leavers = scopeArr.filter(d => {
    if (d.status !== '离职' || !d.leaveDate) return false;
    const t = toDate(d.leaveDate).getTime();
    return t >= sinceMs && t <= until;
  }).length;
  const ends = hcEnds || months.map(m => headcountAt(scopeArr, monthEndMs(m)));
  let sum = 0, n = 0;
  ends.forEach(hc => { if (hc > 0) { sum += hc; n++; } });
  const avg = n ? sum / n : 0;
  // 分母为 0（筛选后一个正式员工都没有）时给 null，让调用方显示「—」而不是 0.0%
  return { leavers, avg, rate: avg > 0 ? leavers / avg * 100 : null };
}

/* 近 12 月流入 / 流出（按入职·离职日期）。
   总览页固定用这个窗口，不跟随人员异动页的统计窗口切换。
   窗口起点与滚动 12 月离职率（getMonthsList(12) 的首月月初）对齐=自然月口径，
   否则人群卡「流入/流出」和净增卡「入职/离职」各差半个月边界，数字对不上 */
function flowYearAgoMs() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - 11, 1).getTime();
}
/* 窗口下界谓词：某日期（字符串或 Date）是否 ≥ 窗口起点。
   人员异动的入职/离职计数、人员变化的净增与明细筛选都走这一份，别各写一遍 ——
   窗口语义（比如含不含当日）只在这里改。 */
function inWinOf(sinceMs) {
  return x => { const t = toDate(x); return !!t && t.getTime() >= sinceMs; };
}
/* 部门聚合键：优先英文简称，缺了用中文名 */
function deptKeyOf(d) { return d.deptEn || d.dept; }
/* 时点在职重建：入职日 ≤ 时点 且 （无离职日 或 离职日 > 时点） */
function inSvcAt(d, dt) {
  const j = toDate(d.joinDate);
  if (!j || j.getTime() > dt.getTime()) return false;
  const l = d.status === '离职' ? toDate(d.leaveDate) : null;
  return !l || l.getTime() > dt.getTime();
}
function flowIn12(scopeArr) {
  const since = flowYearAgoMs();
  return scopeArr.filter(d => d.joinDate && toDate(d.joinDate).getTime() >= since).length;
}
function flowOut12(scopeArr) {
  const since = flowYearAgoMs();
  return scopeArr.filter(d => d.status === '离职' && d.leaveDate && toDate(d.leaveDate).getTime() >= since).length;
}
/* 入职→离职时长（年）；任一日期缺失返回 null。
   「离职者平均司龄」「在职时长分布」「早期流失」三处共用这一个算式 ——
   算式本体就是 core.js 的 calcTenure(入职, 离职)，这里只多一层「缺日期给 null」。
   ⚠️ 缺日期必须仍是 null 不能是 0：调用方按 `t == null` 判断能不能进时长桶，
   而 0 会落进「<1年」那一档，把没日期的人算成一个 0 岁样本。 */
function tenureSpanOf(d) {
  const j = toDate(d.joinDate), l = toDate(d.leaveDate);
  return j && l ? calcTenure(d.joinDate, d.leaveDate) : null;
}
/* 同上，但只留正数（时长桶的边界按 >0 划，见下方 tnBounds） */
function tenureYearsOf(arr) {
  return arr.map(tenureSpanOf).filter(t => t > 0);
}
/* 平均司龄（年）。三处卡片共用这一个口径：
   span=false → 算到今天（在职人群）；span=true → 算到离职日（离职人群，走 tenureSpanOf）。
   以前三处各写一遍 map/filter/reduce，加一条清洗规则就得改三处、漏一处同页出现两个均司龄。 */
function meanOf(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}
function avgTenureOf(list, span) {
  return meanOf(span ? tenureYearsOf(list) : list.map(d => calcTenure(d.joinDate)).filter(t => t > 0));
}

/* ═══ 三块人群概览卡（总览页顶部） ═══ */
function renderSegCards(active, scopeData) {
  const el = document.getElementById('segRow');
  if (!el) return;
  const seg = segByGroup(scopeData);              // 含离职历史，用于算流出
  const actSeg = segByGroup(active);
  const cards = [
    { key:'formal',    cls:'seg-formal',    types:'已转正 + 试用期' },
    { key:'intern',    cls:'seg-intern',    types:'签约 + 非签约实习生' },
    { key:'outsource', cls:'seg-outsource', types:'外包人员 + 劳务人员' },
  ].map(c => {
    const n = actSeg[c.key].length;
    const out = flowOut12(seg[c.key]);
    const inn = flowIn12(seg[c.key]);
    const inner = countBy(actSeg[c.key], 'empType');
    const innerTxt = Object.keys(inner).sort((a,b) => inner[b]-inner[a]).map(k => `${k} ${inner[k]}`).join(' · ') || '无';
    return `<div ${clickCardAttrs('seg-card ' + c.cls, GROUP_LABEL[c.key], 'seg:' + c.key)}>
      <div class="seg-head"><span class="seg-title">${GROUP_LABEL[c.key]}</span>${scopeTag(c.key, GROUP_SHORT[c.key])}</div>
      <div class="seg-num">${n}</div>
      <div class="seg-split">${esc(innerTxt)}</div>
      <div class="seg-flow">近 12 月流入 ${inn} · 流出 ${out}${c.key === 'formal' ? '' : ' · 不计离职率'}</div>
    </div>`;
  }).join('');
  el.innerHTML = cards;
  /* 人群卡点击 → 人员明细带该人群在职名单 */
  ['formal','intern','outsource'].forEach(k => registerDetailFilter('seg:' + k,
    GROUP_LABEL[k] + ' · 在职名单', d => d.status === '在职' && staffGroupOf(d) === k));
}

/* ═══ KPI 卡（口径跟随顶栏「人群」下拉：全部 = 全员） ═══ */
function renderKpiCards(active) {
  if (!pageVisible('overview')) return;
  const scopeData = getScopeData();                 // 已按下拉筛过，不必再收窄
  const rt = rollingTurnover(scopeData);
  const avgTenure = avgTenureOf(active);
  /* 流入与人群卡同口径（毛流入：含入职后又离职的人）——
     之前只数在职入职者（56），人群卡却写毛流入（60），同一屏两个数被用户抓包。
     窗口对齐后 rt.leavers === flowOut12(scopeData)，净增=流入−流出、也等于三张人群卡之和 */
  const joins12 = flowIn12(scopeData);
  const netAdd = joins12 - rt.leavers;
  const centerFilter = document.getElementById('filterCenter').value;
  const deptFilter = document.getElementById('filterDept').value;
  const scope = scopeOfFilter(), scopeLab = scopeLabelOf();

  let cards = '';
  const label = centerFilter !== 'all' ? centerFilter : deptFilter !== 'all' ? deptFilter : '全公司';
  const seg = segByGroup(active);
  /* 徽标跟下拉走（原来是写死的 'all'）：数字一直跟着筛，徽标却永远挂「全员」，
     于是选「正式员工」时旁边三张比率卡都写着「正式员工」、唯独这张还写着「全员」
     ——读起来就像这张卡没跟着筛。 */
  /* 在职合计=人数卡可点（离职率/净增/司龄是比率或派生值，不传 jumpKey 不可点） */
  cards += kpi(label + ' · 在职合计', active.length, `正式 ${seg.formal.length} · 实习 ${seg.intern.length} · 外协 ${seg.outsource.length}`, '--s1', scope, scopeLab, 'ov:active');
  registerDetailFilter('ov:active', label + ' · 在职名单', d => d.status === '在职');
  if (centerFilter !== 'all') {
    const depts = [...new Set(active.map(d => d.deptEn).filter(Boolean))].length;
    /* 小字原来是「覆盖 N 人」，而 N 就是旁边「在职合计」那张卡的数字 —— 复述，删掉 */
    cards += kpi('部门数', depts, '', '--s2');
  }
  // 语义：离职率=不好→绿；净增=好→红；司龄为中性指标，走分类色
  cards += kpi('滚动 12 月离职率', pctText(rt.rate), `${rt.leavers} 人离职 · 月均在册 ${Math.round(rt.avg)}`, '--neg', scope, scopeLab) +
    kpi('近 12 月净增', (netAdd >= 0 ? '+' : '') + netAdd, `${joins12} 入职 − ${rt.leavers} 离职`, '--pos', scope, scopeLab) +
    kpi('平均司龄', avgTenure.toFixed(1) + ' 年', `${scopeLabelAll()} ${active.length} 人`, '--s5', scope, scopeLab);
  document.getElementById('kpiRow').innerHTML = cards;
}

/* ═══ 总览 ═══ */
function renderOverview(active, tc) {
  if (!pageVisible('overview')) return;
  const scopeData = getScopeData();
  renderSegCards(active, scopeData);
  /* 入离职趋势：跟顶栏「人群」下拉（2026-10-14 拍板：全部=全员，不再定死正式口径）。
     scopeData 已经是下拉筛过的结果，不必再按人群过滤一遍 */
  const trendG = scopeOfFilter();
  const months = getMonthsList(12);
  document.getElementById('trendNote').innerHTML = scopeNote(trendG, '', scopeLabelOf());
  lineChart('chartTurnoverTrend', months, [
    // 红入绿出：入职=好→红，离职=不好→绿（公司语义）
    { label:'入职', data: countByMonth(scopeData.filter(d => d.status==='在职'), 'joinDate', months), color: tc.pos },
    { label:'离职', data: countByMonth(scopeData.filter(d => d.status==='离职'), 'leaveDate', months), color: tc.neg },
  ], {
    /* 点数据点 → 人员明细看该月入/离名单。
       点哪条线都一样：两个系列在同一个月份上是一体的，按「哪条线」分会让人
       在「这条线上的点到底算不算我点的那条」上纠结（2026-10-15 用户拍板合并）。 */
    onClick: (e, els) => { if (els.length) jumpToDetail('ov:trend:' + months[els[0].index]); },
  });
  months.forEach(m => registerDetailFilter('ov:trend:' + m, m + ' 入职 + 离职名单', trendMonthFilter(m)));
  renderOverviewMods();
}

/* ── 总览 · 业务模块摘要卡（大数字 + 一句要点，整卡点击跳转）──
   口径：社招=未达成缺口（已剔除已入职）；校招=26届名单 + 27届需求；
   绩效关注=B-C 名单在册跟踪数；外包=台账在岗/离岗；梯队=高潜/储备干部。
   2026-10-21 用户要求删掉「建设中」徽标：卡片只讲数，不再自报状态。
   目标页是不是占位页，由那边自己的页面标题说明，不在这里预告。 */
function overviewModCard(o) {
  return '<button class="mod-card" onclick="switchPage(\'' + o.page + '\')">' +
    '<div class="mod-head"><span class="mi">' + o.icon + '</span>' + o.title + '</div>' +
    '<div class="mod-num">' + o.num + (o.unit ? '<small>' + o.unit + '</small>' : '') + '</div>' +
    '<div class="mod-note">' + esc(o.note || '') + '</div></button>';
}
function renderOverviewMods() {
  const el = document.getElementById('overviewMods');
  if (!el) return;
  const cards = [];

  /* 社招招聘 */
  const rRows = ledgerRows('recruitOpen');
  const open = rRows.filter(r => !r.joined);
  if (open.length) {
    let topB = '', topN = 0;
    RECRUIT_REASONS.forEach(({ name }) => {
      const n = recruitSum(open.filter(r => r.reasonClass === name));
      if (n > topN) { topN = n; topB = name; }
    });
    cards.push(overviewModCard({ page:'recruit_overview', icon:'work', title:'社招招聘', num:recruitSum(open), unit:'人缺口',
      note: open.length + ' 个岗位未达成 · 首因 ' + topB }));
  } else {
    cards.push(overviewModCard({ page:'recruit_overview', icon:'work', title:'社招招聘', num:0, unit:'人缺口', note:'未达成需求已清零' }));
  }

  /* 校招跟踪 */
  const c26 = ledgerRows('campus26');
  const need27 = recruitSum(ledgerRows('campus27'));
  let evalNote = '暂无月度评价';
  const months26 = trackMonths(c26);
  if (months26.length) {
    const latest = months26[months26.length - 1];
    let tot = 0, sa = 0;
    c26.forEach(r => (r.evals || []).forEach(e => {
      if (e.m !== latest) return;
      [e.mentor, e.lead].forEach(v => { v = (v || '').trim(); if (!v) return; tot++; if (v === 'S' || v === 'A') sa++; });
    }));
    evalNote = latest + '月评价 S/A ' + sa + '/' + tot;
  }
  cards.push(overviewModCard({ page:'campus_track', icon:'school', title:'校招跟踪', num:c26.length, unit:'26届已入职',
    note: '27届需求 ' + need27 + ' 人 · ' + evalNote }));

  /* 绩效关注（B-C 名单） */
  const bc = (typeof ledgerData !== 'undefined' && ledgerData && ledgerData.bcPeople) || [];
  const bcLeft = bc.filter(r => r.left).length;   // 判定在 ledger.js parseBC
  cards.push(overviewModCard({ page:'perf_overview', icon:'monitoring', title:'绩效关注', num:Math.max(bc.length - bcLeft, 0), unit:'人在册跟踪',
    note: 'B-C 名单 ' + bc.length + ' 人 · 已离职/优化 ' + bcLeft }));

  /* 外包用工 */
  const out = (typeof ledgerData !== 'undefined' && ledgerData && ledgerData.outsource) || { active: [], left: [] };
  if (out.active.length || out.left.length) {
    cards.push(overviewModCard({ page:'outsource_overview', icon:'group', title:'外包用工', num:out.active.length, unit:'人在岗',
      note: '离岗 ' + out.left.length + ' 人' }));
  } else {
    /* 台账无「外包名单」sheet（OD名单尚未接入）——显示诚实态，不出 0/0 */
    cards.push(overviewModCard({ page:'outsource_overview', icon:'group', title:'外包用工', num:'—', unit:'', note:'台账暂无外包名单' }));
  }

  /* 人才梯队 */
  const hp = (typeof ledgerData !== 'undefined' && ledgerData && ledgerData.highPotential) || [];
  const rc = (typeof ledgerData !== 'undefined' && ledgerData && ledgerData.reserveCandidates) || [];
  cards.push(overviewModCard({ page:'talent_hp', icon:'military_tech', title:'人才盘点', num:hp.length, unit:'高潜',
    note: '储备干部 ' + rc.length + ' 人' }));

  el.innerHTML = cards.join('');
}

/* 台账各名单的读取口（社招 / 校招需求 / 校招跟踪共用）：
   ledgerData 由 ledger.js 解析层给出，页面只读不算；缺表时给空数组。 */
function ledgerRows(key) {
  return (typeof ledgerData !== 'undefined' && ledgerData && ledgerData[key]) || [];
}

/* ═══ 社招（数据 = 台账「招聘未达成需求」sheet）═══
   达成判定（r.joined）由 ledger.js 的 parseRecruitOpen 给出，这里只读不算。
   parseRecruitOpen 已滤掉部门为空的行（合计行），此处无需再滤 */
/* 渠道三分 / 原因五桶的判定在 ledger.js 解析层（channelClass / reasonClass），此处只读 */
/* 三个渠道的展示口径：KPI 卡、堆叠图、两页共用同一份，改一处即可 */
const RECRUIT_CHANNELS = [
  { key: 'formal', kpi: '正式工渠道', note: '外聘正式工',        chart: '外聘正式工', color: 's1' },
  { key: 'out',    kpi: '外协渠道',   note: '人力外包 / 外协',   chart: '人力外协',   color: 's2' },
  { key: 'dual',   kpi: '双渠道',     note: '外包 / 正式工均可', chart: '双渠道',     color: 's4' },
];
function recruitSum(arr) { return arr.reduce((s, r) => s + (r.count || 0), 0); }
/* 部门 → {total, formal, out, dual} 一遍聚合。
   以前在 sort 比较器里现 filter 现求和，同样的数组被扫了 O(D log D) 遍 */
function recruitByDept(open) {
  const m = {};
  open.forEach(r => {
    if (!r.dept) return;
    const b = m[r.dept] || (m[r.dept] = { total: 0, formal: 0, out: 0, dual: 0 });
    b.total += r.count || 0;
    const c = r.channelClass;
    if (b[c] !== undefined) b[c] += r.count || 0;
  });
  return m;
}
function recruitChannelKpis(byDept) {
  const sum = ch => Object.keys(byDept).reduce((s, k) => s + byDept[k][ch], 0);
  return RECRUIT_CHANNELS.map(c => kpi(c.kpi, sum(c.key), c.note, '--' + c.color, 'formal')).join('');
}
function recruitTableHtml(rows) {
  const statePill = r => r.joined
    ? '<span class="pill pill-done">已入职</span>'
    : '<span class="pill pill-open">缺口中</span>';
  return '<thead><tr><th>部门</th><th>岗位名称</th><th>技术方向</th><th>需求</th><th>原因说明</th><th>影响项目</th><th>招聘渠道</th><th>备注</th><th>状态</th></tr></thead><tbody>' +
    rows.map(r => '<tr><td>' + esc(r.dept) + '</td><td>' + esc(r.position) + '</td><td>' + esc(r.direction) + '</td><td>' + r.count +
      '</td><td class="wrap">' + esc(r.reason) + '</td><td class="wrap">' + esc(r.project) + '</td><td>' + esc(r.channel) +
      '</td><td class="wrap">' + esc(r.remark) + '</td><td>' + statePill(r) + '</td></tr>').join('') + '</tbody>';
}
/* 空态给下一步动作，不是干放一句「暂无数据」（G2 三态齐全） */
const RECRUIT_EMPTY_TIP = '暂无社招数据：点右上角「上传数据」，拖入含「招聘未达成需求」表的汇总表';
/* 空态：KPI 位 + 明细表 + 右侧说明，两页共用 */
function renderRecruitEmpty(kpiEl, tableId, noteId, label) {
  kpiEl.innerHTML = kpi(label, '—', RECRUIT_EMPTY_TIP, '--s3');
  const t = document.getElementById(tableId);
  if (t) t.innerHTML = '<thead><tr><th>提示</th></tr></thead><tbody><tr><td class="dim">' + RECRUIT_EMPTY_TIP + '</td></tr></tbody>';
  const n = document.getElementById(noteId);
  if (n) n.textContent = '';
}

function renderRecruitOverview(tc) {
  if (!pageVisible('recruit_overview')) return;
  const el = document.getElementById('recruitKpiRow');
  if (!el) return;
  const rows = ledgerRows('recruitOpen');
  const open = rows.filter(r => !r.joined);
  if (!open.length) {
    ['chartRecruitDept', 'chartRecruitReason', 'chartRecruitProject'].forEach(destroyChart);
    renderRecruitEmpty(el, 'recruitOverviewTable', 'recruitTableNote', '未达成需求');
    return;
  }
  const byDept = recruitByDept(open);
  const deptKeys = Object.keys(byDept).sort((a, b) => byDept[b].total - byDept[a].total);
  const totalOpen = recruitSum(open);
  el.innerHTML =
    kpi('未达成需求', totalOpen, '已剔除已入职', '--neg', 'formal') +
    kpi('涉及部门', deptKeys.length, '按二级部门', '--s1', 'formal') +
    recruitChannelKpis(byDept);

  barChart('chartRecruitDept', deptKeys, RECRUIT_CHANNELS.map(c => ({
    label: c.chart, data: deptKeys.map(k => byDept[k][c.key]), color: tc[c.color],
  })), { stacked: true, scales: { x: { ticks: { autoSkip: false, maxRotation: 45, minRotation: 0 } } } });
  document.getElementById('recruitDeptNote').innerHTML = scopeNote('formal', `${deptKeys.length} 个部门 · ${totalOpen} 人`);

  const buckets = RECRUIT_REASONS.map(x => x.name);   // 桶名与判定同在 ledger.js，单一口径
  const bucketColor = {};
  buckets.forEach((b, i) => { bucketColor[b] = [tc.s3, tc.s4, tc.s1, tc.s2, tc.s6][i]; });
  const rLabels = buckets.map(b => ({ b, n: recruitSum(open.filter(r => r.reasonClass === b)) })).filter(x => x.n > 0);
  if (rLabels.length) doughnutChart('chartRecruitReason', rLabels.map(x => x.b), rLabels.map(x => x.n), rLabels.map(x => bucketColor[x.b]));
  else destroyChart('chartRecruitReason');

  const projMap = {};
  open.forEach(r => { const k = String(r.project || '').trim() || '未标注'; projMap[k] = (projMap[k] || 0) + (r.count || 0); });
  const projKeys = Object.keys(projMap).sort((a, b) => projMap[b] - projMap[a]).slice(0, 15);
  hbarChart('chartRecruitProject', projKeys, [{ label: '需求人数', data: projKeys.map(k => projMap[k]), color: tc.s1 }],
    { scales: { y: { ticks: { autoSkip: false } } } });
  document.getElementById('recruitProjNote').innerHTML = scopeNote('formal', `共 ${Object.keys(projMap).length} 项 · 显示前 ${projKeys.length}`);

  const t = document.getElementById('recruitOverviewTable');
  if (t) t.innerHTML = recruitTableHtml(open);
  const tn = document.getElementById('recruitTableNote');
  if (tn) tn.innerHTML = scopeNote('formal', `${open.length} 条 · ${totalOpen} 人（已入职 ${rows.length - open.length} 条不在列，见社招需求页）`);
}

function renderRecruitNeed(tc) {
  if (!pageVisible('recruit_need')) return;
  const el = document.getElementById('recruitNeedKpiRow');
  if (!el) return;
  const rows = ledgerRows('recruitOpen');
  const t = document.getElementById('recruitNeedTable');
  if (!rows.length) {
    renderRecruitEmpty(el, 'recruitNeedTable', 'recruitNeedNote', '需求明细');
    return;
  }
  const open = rows.filter(r => !r.joined);
  const joined = rows.filter(r => r.joined);
  const byDept = recruitByDept(open);
  el.innerHTML =
    kpi('缺口人数', recruitSum(open), `${open.length} 条 · ${Object.keys(byDept).length} 个部门`, '--neg', 'formal') +
    kpi('已入职', joined.length ? joined.length + ' 条' : '—', joined.length ? joined.map(r => r.remark).join('、') : '备注列标记', '--pos', 'formal') +
    recruitChannelKpis(byDept);
  if (t) t.innerHTML = recruitTableHtml(open.concat(joined));
  const sn = document.getElementById('recruitNeedNote');
  if (sn) sn.innerHTML = scopeNote('formal', `共 ${rows.length} 条 · 缺口 ${recruitSum(open)} 人`);
}

/* ═══ 校招管理 · 校招需求（27届计划盘点）═══
   口径（用户拍板）：纯计划侧——要多少人、什么结构；面试评价 S/A/B+ 是
   「该岗位要招面试评价为此等级的人」，数字即人数，不涉及执行进度 */
const CAMPUS_GRADES = ['S', 'A', 'B+'];
/* 评价等级药丸。等级 → 配色的映射不在 JS 里：gradeRung() 只归一成档位后缀，
   色对在 style.css 的 .pill-grade-*（与绩效 .tag-grade-* 同一批 --gtag-* 色）。
   tail 是拼在等级后面的量（校招用「× 3」这种写法）。 */
function gradePill(v, tail) {
  if (!v) return '<span class="dim">—</span>';
  const r = gradeRung(v);
  return `<span class="pill ${r ? 'pill-grade-' + r : ''}">${esc(v)}${tail ? ' ' + esc(tail) : ''}</span>`;
}
function campusGradePill(r) {
  if (!r.grades || !r.grades.length) return '<span class="dim">—</span>';
  return r.grades.map(x => gradePill(x.g, '× ' + x.n)).join(' ');
}
/* 等级柱子的填充色：与表格里的药丸同源（gradeRung → --grade-*），
   所以同一个等级在图表与表里同色。按**等级本身**查色，不按 dataIndex 查数组
   —— 列表过滤掉 0 值后下标会错位，颜色就串到别的等级上。 */
function gradeBarColor(grade, tc) {
  return tc['grade-' + (gradeRung(grade) || 'sa')] || tc.s1;
}
function campusTableHtml(rows) {
  return '<thead><tr><th>部门</th><th>岗位名称</th><th>职类</th><th>岗位方向</th><th>具体方向</th><th>人数</th><th>面试评价</th><th>学历要求</th><th>配置原因</th><th>地域</th><th>岗位负责人</th><th>备注</th></tr></thead><tbody>' +
    rows.map(r => '<tr><td>' + esc(r.dept) + '</td><td>' + esc(r.position) + '</td><td>' + esc(r.jobType) +
      '</td><td>' + esc(r.direction) + '</td><td>' + esc(r.detail) + '</td><td>' + (r.count || 0) +
      '</td><td>' + campusGradePill(r) + '</td><td>' + esc(r.edu) + '</td><td class="wrap">' + esc(r.reason) +
      '</td><td>' + esc(r.location) + '</td><td>' + esc(r.owner) + '</td><td class="wrap">' + esc(r.note) + '</td></tr>').join('') + '</tbody>';
}
/* ═══ 校招概览（2026-10-19 从占位转真页，grilling 拍板）═══
   定位=结论层：26 届成果 + 27 届需求盘子；部门明细归需求页、名单归跟踪页。
   需求页已有的「部门×人数」「等级分布」两图这里不重复；概览独有的只有
   「26 届实际到岗 vs 27 届需求」对比——看哪个部门在校招上加码。
   数据限制：26 届名单无离职字段（名单即在职口径），留任/流失做不了。
   切面选取（用户拍板）：地域/配置原因/学历——职类与岗位方向在这批数据里近乎单值。 */
function renderCampusOverview(tc) {
  if (!pageVisible('campus_overview')) return;
  const rows26 = ledgerRows('campus26');
  const rows27 = ledgerRows('campus27');
  const OV_CHARTS = ['chartCampusCompare', 'chartCampusLoc', 'chartCampusEdu', 'chartCampusReason'];
  const el26 = document.getElementById('campusOvKpiRow26');
  if (!el26) return;
  if (!rows26.length && !rows27.length) {
    renderRecruitEmpty(el26, null, 'campusOvNote26', '校招概览');
    OV_CHARTS.forEach(destroyChart);
    return;
  }

  /* ── 26 届成果（结论卡）── */
  const g26 = { S: 0, A: 0, 'B+': 0 };
  let graded26 = 0;
  rows26.forEach(r => { const g = cleanGrade(r.grade); if (g26[g] != null) { g26[g]++; graded26++; } });
  const sa26 = g26.S + g26.A;
  const depts26 = new Set(rows26.map(r => r.dept).filter(k => k && k !== '未知'));
  const internEarly = rows26.filter(r => r.intern === '是').length;
  el26.innerHTML =
    kpi('26 届在册', rows26.length + ' 人', internEarly ? `含实习提前入职 ${internEarly} 人` : '均已入职', '--s1') +
    kpi('面试评级 S+A', pctOf(sa26, graded26, 0), `S ${g26.S} · A ${g26.A} · B+ ${g26['B+']}`, '--pos') +
    /* 小字原来是「实际到岗 N 人」，N 与左边「26 届在册」是同一个数 —— 复述，删掉 */
    kpi('覆盖部门', depts26.size, '', '--s4');
  const n26 = document.getElementById('campusOvNote26');
  if (n26) n26.textContent = '26 届校招名单 · 均已入职';

  /* ── 对比图：各部门 26 届实际到岗 vs 27 届需求（概览独有，横杠自动）── */
  const need27 = {};
  let total27 = 0;
  rows27.forEach(r => { need27[r.dept] = (need27[r.dept] || 0) + (r.count || 0); total27 += r.count || 0; });
  const act26 = {};
  rows26.forEach(r => { if (r.dept && r.dept !== '未知') act26[r.dept] = (act26[r.dept] || 0) + 1; });
  const cmpKeys = [...new Set([...Object.keys(need27), ...Object.keys(act26)])]
    .sort((a, b) => (need27[b] || 0) - (need27[a] || 0) || a.localeCompare(b, 'zh'));
  hbarChart('chartCampusCompare', cmpKeys, [
    { label: '26 届实际到岗', data: cmpKeys.map(k => act26[k] || 0), color: tc.pos },
    { label: '27 届需求', data: cmpKeys.map(k => need27[k] || 0), color: tc.s1 },
  ], { scales: { y: { ticks: { autoSkip: false } } } });
  const cn = document.getElementById('campusCmpNote');
  if (cn) cn.textContent = `${cmpKeys.length} 个部门 · 27 届合计 ${total27} 人`;

  /* ── 27 届需求盘子（结论卡）── */
  const el27 = document.getElementById('campusOvKpiRow27');
  const dCnt27 = new Set(rows27.map(r => r.dept).filter(Boolean)).size;
  const g27 = { S: 0, A: 0, 'B+': 0 };
  rows27.forEach(r => (r.grades || []).forEach(x => { if (g27[x.g] != null) g27[x.g] += x.n; }));
  const sum27 = g27.S + g27.A + g27['B+'];
  if (el27) el27.innerHTML =
    kpi('27 届需求人数', total27, `岗位 ${rows27.length} · 部门 ${dCnt27}`, '--s2') +
    kpi('S+A 需求占比', pctOf(g27.S + g27.A, sum27, 0), `S ${g27.S} · A ${g27.A} · B+ ${g27['B+']}`, '--s5');
  const n27 = document.getElementById('campusOvNote27');
  if (n27) n27.textContent = '纯计划口径 · 部门明细见需求页';

  /* 地域 / 学历 / 配置原因：按需求人数累计（与需求页人数口径一致） */
  const byKey = field => {
    const m = {};
    rows27.forEach(r => { const k = String(r[field] || '').trim(); if (k) m[k] = (m[k] || 0) + (r.count || 0); });
    return m;
  };
  const loc = byKey('location');
  const lk = Object.keys(loc).sort((a, b) => loc[b] - loc[a]);
  if (lk.length) {
    doughnutChart('chartCampusLoc', lk, lk.map(k => loc[k]),
      [tc.s1, tc.s2, tc.s3, tc.s4, tc.s5, tc.s6].slice(0, lk.length));
    const ln = document.getElementById('campusLocNote');
    if (ln) ln.textContent = `${lk.length} 个地域 · 合计 ${total27} 人`;
  } else destroyChart('chartCampusLoc');

  const edu = byKey('edu');
  const ek = Object.keys(edu).sort((a, b) => edu[b] - edu[a]);
  if (ek.length) {
    doughnutChart('chartCampusEdu', ek, ek.map(k => edu[k]),
      [tc.s2, tc.s1, tc.s4, tc.s5, tc.s6].slice(0, ek.length));
    const en = document.getElementById('campusEduNote');
    if (en) en.textContent = '按需求人数';
  } else destroyChart('chartCampusEdu');

  const reason = byKey('reason');
  const rk = Object.keys(reason).sort((a, b) => reason[b] - reason[a]);
  if (rk.length) {
    hbarChart('chartCampusReason', rk, [{ label: '需求人数', data: rk.map(k => reason[k]), color: tc.s1 }], {});
    const rn = document.getElementById('campusReasonNote');
    if (rn) rn.textContent = '按需求人数累计';
  } else destroyChart('chartCampusReason');
}

function renderCampusNeed(tc) {
  if (!pageVisible('campus_need')) return;
  const el = document.getElementById('campusNeedKpiRow');
  if (!el) return;
  const rows = ledgerRows('campus27');
  const t = document.getElementById('campusNeedTable');
  if (!rows.length) {
    renderRecruitEmpty(el, 'campusNeedTable', 'campusNeedNote', '27届校招需求');
    destroyChart('chartCampusDept'); destroyChart('chartCampusGrade');
    return;
  }
  const total = recruitSum(rows);
  const depts = new Set(rows.map(r => r.dept));
  el.innerHTML =
    kpi('需求总人数', total, '27届校招提报合计', '--s1') +
    kpi('岗位数', rows.length, '', '--s2') +
    kpi('覆盖部门数', depts.size, '', '--s4');

  /* 部门需求：代码部门名短、≤12 个 → hbarChart 自动出竖柱 */
  const byDept = {};
  rows.forEach(r => { byDept[r.dept] = (byDept[r.dept] || 0) + (r.count || 0); });
  const dk = Object.keys(byDept).sort((a, b) => byDept[b] - byDept[a]);
  hbarChart('chartCampusDept', dk, [{ label: '需求人数', data: dk.map(k => byDept[k]), color: tc.s1 }],
    { scales: { y: { ticks: { autoSkip: false } } } });
  const dn = document.getElementById('campusDeptNote');
  if (dn) dn.textContent = `${dk.length} 个部门 · 合计 ${total} 人`;

  /* 面试评价等级分布（职类/岗位方向在这批数据里近乎单值，无信息量，按数据实际换成等级分布） */
  const gCnt = {};
  CAMPUS_GRADES.forEach(g => { gCnt[g] = 0; });
  rows.forEach(r => (r.grades || []).forEach(x => { if (gCnt[x.g] != null) gCnt[x.g] += x.n; }));
  const gk = CAMPUS_GRADES.filter(g => gCnt[g] > 0);
  /* 取色按**等级本身**查，不按 dataIndex 查数组：
     gk 是过滤过 0 值的，S 为 0 时 dataIndex 0 会落到 A 上，颜色就串位了。
     与表格里的药丸同源（gradeRung → --grade-*），同等级在图表与表里同色。 */
  if (gk.length) hbarChart('chartCampusGrade', gk, [{ label: '需求数', data: gk.map(g => gCnt[g]),
    color: ctx => gradeBarColor(gk[ctx.dataIndex], tc) }], { scales: { y: { ticks: { autoSkip: false } } } });
  else destroyChart('chartCampusGrade');
  const gn = document.getElementById('campusGradeNote');
  if (gn) gn.textContent = '面试评价定级，数字即该等级招的人数';

  if (t) t.innerHTML = campusTableHtml(rows);
  const sn = document.getElementById('campusNeedNote');
  if (sn) sn.textContent = `共 ${rows.length} 条 · ${total} 人`;
}
/* CSV 导出：与表格同字段（含面试评价等级/人数），长文本换行压成空格 */
function exportCampusCsv() {
  const rows = ledgerRows('campus27');
  if (!rows.length) { showToast('暂无校招需求数据可导出：先点右上角「上传数据」，拖入含「27届校招需求」表的汇总表'); return; }
  const labels = ['部门', '岗位名称', '职类', '岗位方向', '具体方向', '校招人数', '面试评价(S/A/B+)', '学历要求', '配置原因', '地域', '岗位负责人', '备注'];
  const keys = ['dept', 'position', 'jobType', 'direction', 'detail', 'count', 'gradeStr', 'edu', 'reason', 'location', 'owner', 'note'];
  downloadCsv('27届校招需求', csvText(labels, rows.map(r => keys.map(k => r[k]))));
  showToast(`已导出 ${rows.length} 条校招需求`);
}

/* ═══ 校招管理 · 校招跟踪（26届：名单 → 入职 → 月度评价）═══
   口径（用户拍板 2026-10-12）：名单里的人都是确认已入职的，不设状态列；
   月度评价=导师/主管按月评级，解析层按表头动态抓列，后续月份加列即用 */
const TRACK_EVAL_GRADES = ['S', 'A', 'B+', 'B', 'B-'];
function trackMonths(rows) {
  const set = new Set();
  rows.forEach(r => (r.evals || []).forEach(e => set.add(e.m)));
  return Array.from(set).sort((a, b) => a - b);
}
function campusTrackTableHtml(rows, months) {
  /* 该月主管列实为阶段性评价（leadStage='7-9'）时，列头写「主管7-9月阶段性」 */
  const leadStage = m => { const e = rows.flatMap(r => r.evals || []).find(x => x.m === m && x.leadStage); return e ? e.leadStage : null; };
  const mh = months.map(m => {
    const st = leadStage(m);
    return '<th>' + m + '月·导师</th><th>' + (st ? '主管' + st + '月阶段性' : m + '月·主管') + '</th>';
  }).join('');
  const head = '<thead><tr><th>序号</th><th>部门</th><th>姓名</th><th>岗位名称</th><th>导师</th><th>上级主管</th><th>性别</th><th>学历</th><th>毕业院校</th><th>院校类别</th><th>专业</th><th>面试评级</th>' + mh + '<th>offer地点</th><th>签约</th><th>实习/提前入职</th><th>备注</th></tr></thead>';
  const body = rows.map(r => {
    const ev = months.map(m => {
      const e = (r.evals || []).find(x => x.m === m);
      return '<td>' + gradePill(e && e.mentor) + '</td><td>' + gradePill(e && e.lead) + '</td>';
    }).join('');
    return '<tr><td>' + esc(r.no) + '</td><td>' + esc(r.dept) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.position) +
      '</td><td>' + esc(r.mentor) + '</td><td>' + esc(r.lead) + '</td><td>' + esc(r.gender) + '</td><td>' + esc(r.edu) +
      '</td><td>' + esc(r.school) + '</td><td>' + esc(r.tier) + '</td><td class="wrap">' + esc(r.major) + '</td><td>' + gradePill(r.grade) +
      '</td>' + ev + '<td>' + esc(r.location) + '</td><td>' + esc(r.signed) + '</td><td>' + esc(r.intern) + '</td><td class="wrap">' + esc(r.note) + '</td></tr>';
  }).join('');
  return head + '<tbody>' + body + '</tbody>';
}
function renderCampusTrack(tc) {
  if (!pageVisible('campus_track')) return;
  const el = document.getElementById('campusTrackKpiRow');
  if (!el) return;
  const rows = ledgerRows('campus26');
  const t = document.getElementById('campusTrackTable');
  const months = trackMonths(rows);
  if (!rows.length) {
    renderRecruitEmpty(el, 'campusTrackTable', 'campusTrackNote', '26届校招名单');
    ['chartTrackDept', 'chartTrackTier', 'chartTrackGrade', 'chartTrackLoc', 'chartTrackEval', 'chartTrackTrend'].forEach(destroyChart);
    return;
  }
  const internEarly = rows.filter(r => r.intern === '是').length;
  el.innerHTML =
    kpi('校招名单', rows.length + ' 人', '26届 · 均已入职', '--s1') +
    kpi('实习/提前入职', internEarly + ' 人', '', '--s4');

  /* ① 部门分布 */
  const byDept = countBy(rows, 'dept');
  const dk = Object.keys(byDept).filter(k => k !== '未知').sort((a, b) => byDept[b] - byDept[a] || a.localeCompare(b));
  hbarChart('chartTrackDept', dk, [{ label: '人数', data: dk.map(k => byDept[k]), color: tc.s1 }],
    { scales: { y: { ticks: { autoSkip: false } } } });
  const dn = document.getElementById('campusTrackDeptNote');
  if (dn) dn.textContent = dk.length + ' 个部门 · 共 ' + rows.length + ' 人';

  /* ② 毕业院校类别（985/211/普通一本/QS20 固定序） */
  const TIER_ORDER = ['985', '211', '普通一本', 'QS20'];
  const byTier = countBy(rows, r => r.tier || '其他');
  const tk = TIER_ORDER.filter(k => byTier[k]).concat(Object.keys(byTier).filter(k => !TIER_ORDER.includes(k)));
  /* 单序列计数图一律 s1 蓝：s2 现在是绿，而绿在本系统是「不好」（--neg），
     纯人数分布借语义色会被读成「这类人不行」。站内其它单序列图（职级 / 职类 / 年龄 / 地点）也都是 s1。 */
  hbarChart('chartTrackTier', tk, [{ label: '人数', data: tk.map(k => byTier[k]), color: tc.s1 }],
    { scales: { y: { ticks: { autoSkip: false } } } });

  /* ③ 面试评级（offer 定级，Excel 列名仍为「最终评级」） */
  const byGrade = countBy(rows, r => r.grade || '—');
  const gk = TRACK_EVAL_GRADES.filter(k => byGrade[k]).concat(Object.keys(byGrade).filter(k => !TRACK_EVAL_GRADES.includes(k)));
  hbarChart('chartTrackGrade', gk, [{ label: '人数', data: gk.map(k => byGrade[k]),
    color: ctx => gradeBarColor(gk[ctx.dataIndex], tc) }],
    { scales: { y: { ticks: { autoSkip: false } } } });

  /* ④ offer 地点 */
  const byLoc = countBy(rows, r => r.location || '—');
  const lk = Object.keys(byLoc).sort((a, b) => byLoc[b] - byLoc[a]);
  hbarChart('chartTrackLoc', lk, [{ label: '人数', data: lk.map(k => byLoc[k]), color: tc.s6 }],
    { scales: { y: { ticks: { autoSkip: false } } } });

  /* ⑤⑥ 月度评价：导师+主管两列合并计（口径写进图注） */
  const evalCnt = m => {
    const c = {};
    TRACK_EVAL_GRADES.forEach(g => { c[g] = 0; });
    rows.forEach(r => (r.evals || []).forEach(e => {
      if (e.m !== m) return;
      [e.mentor, e.lead].forEach(v => { v = (v || '').trim(); if (c[v] != null) c[v]++; });
    }));
    return c;
  };
  const latest = months[months.length - 1];
  if (latest != null) {
    const lc = evalCnt(latest);
    const lk2 = TRACK_EVAL_GRADES.filter(g => lc[g] > 0);
    if (lk2.length) hbarChart('chartTrackEval', lk2, [{ label: '评价数', data: lk2.map(g => lc[g]),
      color: ctx => gradeBarColor(lk2[ctx.dataIndex], tc) }],
      { scales: { y: { ticks: { autoSkip: false } } } });
    else destroyChart('chartTrackEval');
    const en = document.getElementById('campusTrackEvalNote');
    if (en) {
      const st = rows.flatMap(r => r.evals || []).find(x => x.m === latest && x.leadStage);
      en.textContent = latest + '月 · 导师按月 · 主管为' + (st ? st.leadStage : '') + '月阶段性评价';
    }
  } else destroyChart('chartTrackEval');
  if (months.length) {
    /* 每个月的评价计数只算一遍：原先在 5 个等级里各调一次 evalCnt(m)，
       同一批数据被从头扫 5 遍（evalCnt 是 O(行 × 评价数)） */
    const byMonth = months.map(evalCnt);
    const tData = TRACK_EVAL_GRADES.map(g => ({
      label: g, data: months.map((_, mi) => byMonth[mi][g] || 0),
      color: gradeBarColor(g, tc),
    })).filter(d => d.data.some(v => v > 0));
    barChart('chartTrackTrend', months.map(m => m + '月'), tData, { stacked: true });
    const tn = document.getElementById('campusTrackTrendNote');
    if (tn) tn.textContent = months.length + ' 个月评价';
  } else destroyChart('chartTrackTrend');

  if (t) t.innerHTML = campusTrackTableHtml(rows, months);
  const sn = document.getElementById('campusTrackNote');
  if (sn) sn.textContent = '共 ' + rows.length + ' 人 · 评价 ' + months.length + ' 个月';
}
/* CSV 导出：与明细表同字段（月度评价动态列），长文本换行压成空格 */
function exportTrackCsv() {
  const rows = ledgerRows('campus26');
  if (!rows.length) { showToast('暂无校招跟踪数据可导出：先点右上角「上传数据」，拖入含「26届校招名单」表的汇总表'); return; }
  const months = trackMonths(rows);
  const labels = ['序号', '部门', '姓名', '岗位名称', '导师', '上级主管', '性别', '学历', '毕业院校', '院校类别', '专业', '面试评级'];
  const keys = ['no', 'dept', 'name', 'position', 'mentor', 'lead', 'gender', 'edu', 'school', 'tier', 'major', 'grade'];
  months.forEach(m => {
    const st = rows.flatMap(r => r.evals || []).find(x => x.m === m && x.leadStage);
    labels.push(m + '月导师评价', st ? '主管' + st.leadStage + '月阶段性评价' : m + '月主管评价');
    keys.push('m' + m + 'm', 'm' + m + 'l');
  });
  labels.push('offer地点', '签约', '实习/提前入职', '备注');
  keys.push('location', 'signed', 'intern', 'note');
  const data = rows.map(r => {
    const o = Object.assign({}, r);
    months.forEach(m => {
      const e = (r.evals || []).find(x => x.m === m);
      o['m' + m + 'm'] = e ? e.mentor : '';
      o['m' + m + 'l'] = e ? e.lead : '';
    });
    return o;
  });
  downloadCsv('26届校招跟踪', csvText(labels, data.map(r => keys.map(k => r[k]))));
  showToast(`已导出 ${rows.length} 条校招跟踪记录`);
}

/* ═══ 人员概览 · 结构分布区（三组维度）═══
   2026-10-14 用户拍板：删「仅正式/全员」开关，口径只跟顶栏「人群」筛选器
   —— 选全部=全员，选具体人群=该人群，页内不再单独区分员工类型 */
const TEN_BINS = ['<1 年', '1-3 年', '3-5 年', '5-10 年', '10 年+'];
const tenureBin = t => t < 1 ? 0 : t < 3 ? 1 : t < 5 ? 2 : t < 10 ? 3 : 4;

function renderStructDist(active, tc) {
  if (!pageVisible('people')) return;
  if (!document.getElementById('chartSDLevel')) return;
  /* 口径只跟顶栏：active 已经按下拉筛过（全部=全员，指定人群=该人群），
     这里再按 g 滤一遍是恒等操作。取值走唯一口径来源 scopeOfFilter() */
  const scope = scopeOfFilter();
  const pop = active;
  document.getElementById('structDistNote').innerHTML = scopeNote(scope, `在职 ${pop.length} 人`, scopeLabelOf());
  const valid = v => v && v !== '/' && v !== '未知';
  /* 分类图自动横竖：默认竖柱，类别名长/类别多时 hbarChart 内部自动转横条；
     去掉「未知/占位」空值、按人数倒序；limit = 只取前 N
     （countBy 把 null/'' 收进「未知」，正好被 valid 滤掉，所以调用方不用自己清空值） */
  const hbars = (id, map, color, limit) => {
    let ks = Object.keys(map).filter(k => valid(k) && map[k] > 0).sort((a, b) => map[b] - map[a]);
    if (limit) ks = ks.slice(0, limit);
    if (!ks.length) { destroyChart(id); return; }
    hbarChart(id, ks, [{ label: '人数', data: ks.map(k => map[k]), color }], { scales: { y: { ticks: { autoSkip: false } } } });
  };

  /* ── 职级体系 ── */
  hbars('chartSDLevel', countBy(pop, 'level'), tc.s1);
  hbars('chartSDLevelSub', countBy(pop, d =>
    valid(d.level) ? (valid(d.subLevel) ? d.level + '·' + d.subLevel : d.level) : null), tc.s1);
  hbars('chartSDJobFamily', countBy(pop, 'jobFamily'), tc.s1);
  hbars('chartSDPosition', countBy(pop, 'position'), tc.s1, 15);

  /* ── 人群画像 ── */
  const genMap = countBy(pop, 'gender');
  const genKeys = ['男', '女'].filter(k => genMap[k]);
  if (genKeys.length) doughnutChart('chartSDGender', genKeys, genKeys.map(k => genMap[k]), [tc.s1, tc.s3]);
  else destroyChart('chartSDGender');
  const nowY = new Date().getFullYear();
  const AGE_BINS = ['<25', '25-29', '30-34', '35-39', '40-44', '45-49', '50+'];
  const ageCnt = new Array(AGE_BINS.length).fill(0);
  pop.forEach(d => {
    if (!d.birthYear) return;
    const a = nowY - d.birthYear;
    ageCnt[a < 25 ? 0 : a < 30 ? 1 : a < 35 ? 2 : a < 40 ? 3 : a < 45 ? 4 : a < 50 ? 5 : 6]++;
  });
  if (ageCnt.some(v => v > 0)) hbarChart('chartSDAge', AGE_BINS, [{ label: '人数', data: ageCnt, color: tc.s1 }], { scales: { y: { ticks: { autoSkip: false } } } });
  else destroyChart('chartSDAge');
  hbars('chartSDPipeline', countBy(pop, d => {
    const k = String(d.talentPipeline || '').trim();
    return valid(k) ? k : '未入梯队';
  }), tc.s2);
  const eduMap = countBy(pop, 'edu');
  const EDU_MAIN = ['博士', '硕士', '本科', '大专'];
  const eduKeys = EDU_MAIN.filter(k => eduMap[k]);
  const eduOther = Object.keys(eduMap).filter(k => !EDU_MAIN.includes(k) && valid(k)).reduce((s, k) => s + eduMap[k], 0);
  const eduLabels = eduKeys.concat(eduOther ? ['其他'] : []);
  if (eduLabels.length) doughnutChart('chartSDEdu', eduLabels, eduKeys.map(k => eduMap[k]).concat(eduOther || []),
    [tc.s1, tc.s2, tc.s3, tc.s4, tc.s6].slice(0, eduLabels.length));
  else destroyChart('chartSDEdu');
  hbars('chartSDLocation', countBy(pop, 'workLocation'), tc.s1);

  /* ── 年限与来源 ── */
  const tenCnt = new Array(5).fill(0); let tenN = 0;
  pop.forEach(d => { const t = calcTenure(d.joinDate); if (t > 0) { tenCnt[tenureBin(t)]++; tenN++; } });
  if (tenN) hbarChart('chartSDTenure', TEN_BINS, [{ label: '人数', data: tenCnt, color: tc.s4 }], { scales: { y: { ticks: { autoSkip: false } } } });
  else destroyChart('chartSDTenure');
  const workCnt = new Array(5).fill(0); let workN = 0;
  pop.forEach(d => { const t = calcTenure(d.firstWorkDate); if (t > 0) { workCnt[tenureBin(t)]++; workN++; } });
  /* 总工龄（首次工作起）与社会经验同性质 → 同用 s1 蓝；司龄一律 s4 橙（颜色跨图对应） */
  if (workN) hbarChart('chartSDWorkYears', TEN_BINS, [{ label: '人数', data: workCnt, color: tc.s1 }], { scales: { y: { ticks: { autoSkip: false } } } });
  else destroyChart('chartSDWorkYears');
  const indCnt = new Array(5).fill(0); let indN = 0;
  pop.forEach(d => {
    let iy = d.industryYears;
    if ((iy == null || iy <= 0) && d.firstWorkDate) iy = calcTenure(d.firstWorkDate);
    if (iy != null && iy > 0) { indCnt[tenureBin(iy)]++; indN++; }
  });
  const sin = document.getElementById('structIndustryNote');
  if (sin) sin.innerHTML = scopeNote(scope, `覆盖 ${indN}/${pop.length} 人`);
  if (indN) hbarChart('chartSDIndustry', TEN_BINS, [
    { label: '社会经验（首次工作起）', data: indCnt, color: tc.s1 },
    { label: '公司司龄', data: tenCnt, color: tc.s4 }], { scales: { y: { ticks: { autoSkip: false } } } });
  else destroyChart('chartSDIndustry');
  hbars('chartSDSource', countBy(pop, 'source'), tc.s6);
}

/* ═══ 区间离职率（2026-10-15 用户拍板：近10年自动对比；自定义起止区间已删——
   selx 弹层在图表区被压住不可交互，且功能冗余）═══
   口径与六档窗口完全一致：区间内离职 ÷ 区间内各月末在册均值（rollingTurnover），
   区别只是起止不再「滚动到今天」——上界由结束月给出（untilMs） */
function monthsInRange(sYM, eYM) {
  if (sYM > eYM) { const t = sYM; sYM = eYM; eYM = t; }   // 起止倒挂悄悄交换
  const out = [];
  let y = +sYM.slice(0, 4), m = +sYM.slice(5, 7);
  const ey = +eYM.slice(0, 4), em = +eYM.slice(5, 7);
  while (y < ey || (y === ey && m <= em)) {
    out.push(y + '-' + String(m).padStart(2, '0'));
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
function rangeTurnover(scopeArr, sYM, eYM, pairs) {
  const months = monthsInRange(sYM, eYM);
  if (!months.length) return { leavers: 0, avg: 0, rate: null };
  /* 各月末在册数由调用方预解析好传进来（见 renderRangeCompare）——不传才现算 */
  const hcEnds = pairs ? months.map(m => headcountAtMs(pairs, monthEndMs(m))) : null;
  return rollingTurnover(scopeArr, months, monthStartMs(months[0]), hcEnds, monthEndMs(months[months.length - 1]));
}
function renderRangeCompare(rateBase, eff) {
  const rowEl = document.getElementById('rangeCompareRow');
  const noteEl = document.getElementById('rangeCompareNote');
  if (!rowEl) return;
  if (noteEl) noteEl.innerHTML = scopeNote(eff, '区间内离职 ÷ 月末在册均值', scopeLabelOf());
  const now = new Date();
  const curY = now.getFullYear(), curM = now.getMonth() + 1;
  const curYM = curY + '-' + String(curM).padStart(2, '0');
  /* 数据起点年份（与 flowWindowOf 的 all 档共用 dataStartMs）；对比区列近 10 个自然年 + 今年至今
     （2026-10-15 用户要求从 5 年扩到 10 年；数据不足 10 年时按实际起点截短） */
  const start = dataStartMs(rateBase);
  const y0 = Math.max(start ? start.getFullYear() : curY, curY - 9);
  /* 每人的入职/离职日期解析一次，供下面 10 年 × 12 个月末复用 ——
     否则每次 headcountAt 都要把全表重扫一遍、每人重新 new Date 两次（10 年约 120 次） */
  const pairs = tenurePairsOf(rateBase);
  let html = '';
  for (let y = y0; y <= curY; y++) {
    const rt = rangeTurnover(rateBase, y + '-01', y < curY ? y + '-12' : curYM, pairs);
    /* 卡体 / 文字层级直接复用 KPI 卡那套（.kpi-card / .kpi-value / .kpi-sub）——
       另立一套 .range-* 等于把 --fs-24 与「--neg 只作大字」这两条规则写两遍。
       2026-10-21 用户：卡片顶部空一行 → 把年份提到 .kpi-label（与其它 KPI 卡同构），
       下面大字是离职率，小字补「离职人数 + 月均在册」两个口径数。 */
    html += '<div class="kpi-card range-card">' +
      '<div class="kpi-label">' + y + (y < curY ? ' 年' : ' 年至今') + '</div>' +
      '<div class="kpi-value neg">' + pctText(rt.rate) + '</div>' +
      '<div class="kpi-sub">' + rt.leavers + ' 人离职 · 月均在册 ' + Math.round(rt.avg) + '</div></div>';
  }
  rowEl.innerHTML = html;
}

function renderTurnover(tc, scopeData) {
  if (!pageVisible('turnover')) return;
  const rel = scopeData || getScopeData();          // 已按顶栏「人群」下拉筛过
  const eff = scopeOfFilter();
  /* 口径统一跟随下拉（2026-10-14 拍板）：getScopeData() 已经按人群筛过，
     所以 rateBase 就是 rel —— 以前 all 档又套了一层 formalOnly()，等于
     选「全部」却只算正式员工。这层二次收窄删掉后，比率与人数同一人口。 */
  const rateBase = rel;
  const win = flowWindowOf(flowWin);
  const wn = document.getElementById('flowWinNote');
  if (wn) wn.innerHTML = scopeNote(eff, win.label, scopeLabelOf());
  const inWin = inWinOf(win.sinceMs);

  /* 每人入职/离职日期只解析一次，各月末在册数复用 ——
     否则每个 headcountAt 都要把全表重扫一遍、每人重新 new Date 两次 */
  const pairs = tenurePairsOf(rateBase);
  const hcEnds = win.months.map(m => headcountAtMs(pairs, monthEndMs(m)));
  const rt = rollingTurnover(rateBase, win.months, win.sinceMs, hcEnds);
  const leaversWin = rateBase.filter(d => d.status === '离职' && inWin(d.leaveDate));
  /* 早期流失（2026-10-14 拍板做成异动页卡片）：窗口内离职且入职到离职不足 6 个月。
     这是留存健康度的直接信号，窗口跟统计窗口切换走（看「全部历史」就是全部早期流失者） */
  /* 早期流失=入职到离职**不足 6 个日历月**（2026-10-15 从 0.5×365.25 天改为日历月，
     与标签「司龄<6月」严格一致——恰满 6 个月离职不算早期流失） */
  const earlyLeavers = leaversWin.filter(d => { const m = fullMonthsBetween(d.joinDate, d.leaveDate); return m != null && m < 6; });

  /* 离职人群司龄算到离职日，只取一遍：平均司龄卡与下面的「在职时长分布（离职时）」共用 */
  const ltTenures = tenureYearsOf(leaversWin);
  const avgLT = meanOf(ltTenures);

  const scopeLab = scopeLabelOf();
  /* 人数卡可点（第 7 参 jumpKey）；离职率/平均司龄是比率卡，不可点 */
  /* 2026-10-26 用户：删「当前在册」卡（与总览在职合计重复）、入职卡挪到离职卡右侧相邻、
     两张卡不再带下面那行说明（「近12个月内入职」这类是标题的复述）。
     同日晚再收一轮：小字里**不再重复「这个数是关于谁的」**（窗口名、人群名），
     只留「这个数怎么算的」。所以早期流失只留判定条件，平均司龄的小字整行删掉。 */
  const cards =
    // 流失类指标一律走「不好=绿」，司龄为中性指标走分类色
    kpi(win.short + '离职率', pctText(rt.rate), `${rt.leavers} 人 · 月均在册 ${Math.round(rt.avg)}`, '--neg', eff, scopeLab) +
    kpi(win.short + '离职', leaversWin.length, '', '--neg', eff, scopeLab, 'mv:leave') +
    kpi(win.short + '入职', rel.filter(d => inWin(d.joinDate)).length, '', '--pos', eff, scopeLab, 'mv:join') +
    kpi('早期流失（<6月）', earlyLeavers.length, '入职到离职不足 6 个月', '--warn', eff, scopeLab, 'mv:early') +
    kpi('离职员工平均司龄', avgLT.toFixed(1) + ' 年', '', '--s5', eff, scopeLab);
  document.getElementById('turnoverKpiRow').innerHTML = cards;
  renderRangeCompare(rateBase, eff);
  /* 明细筛选每次重绘都对**全表**跑一遍，用 Set 做成员判断；
     用 arr.includes(d) 是 O(N) 每人 = 一次重绘 O(N²)（搜索框每敲一下都会重绘） */
  const leaverSet = new Set(leaversWin);
  const earlySet = new Set(earlyLeavers);
  const relSet = new Set(rel);
  registerDetailFilter('mv:leave', win.label + ' · 离职名单', d => leaverSet.has(d));
  registerDetailFilter('mv:early', win.label + ' · 早期流失名单（司龄<6月）', d => earlySet.has(d));
  registerDetailFilter('mv:join', win.label + ' · 入职名单', d => relSet.has(d) && inWin(d.joinDate));

  /* 人员变化区（原人员概览页整块，2026-10-26 搬来，与上面共用 win） */
  renderPeopleChange(rel, win, tc);

  const months = win.months;
  /* 每月离职数一次分桶，别再按月重扫全表（口径与原来一致：按离职日落在该月） */
  const lvByMonth = countByMonth(rateBase, 'leaveDate', months);
  const monthlyRate = months.map((m, i) => {
    const lvThis = lvByMonth[i];
    const hcEnd = hcEnds[i] + lvThis;      // 月末在册 + 当月离职（口径：月初在册）
    return hcEnd > 0 ? +(lvThis / hcEnd * 100).toFixed(2) : null;
  });
  document.getElementById('monthlyTurnoverNote').innerHTML =
    scopeNote(eff, '当月离职 ÷ 月均在册 · ' + win.label, scopeLabelOf());
  barChart('chartMonthlyTurnover', months, [{ label:'离职率 %', data: monthlyRate, color: tc.neg, borderRadius: 3 }], {
    onClick: (e, els) => { if (els.length) jumpToDetail('mv:mleave:' + months[els[0].index]); },
    plugins: {
      tooltip: { callbacks: { label: ctx => `离职率 ${ctx.parsed.y}%` } },
      /* 时间轴保持竖柱；柱顶标百分数（>24 个月的历史窗口会自动关） */
      barValue: { format: v => v.toFixed(1) + '%' },
    },
  });
  months.forEach(m => registerDetailFilter('mv:mleave:' + m, m + ' 离职名单', d => leaverSet.has(d) && d.leaveDate && d.leaveDate.indexOf(m) === 0));

  const jt = document.getElementById('joinByTypeTitle');
  if (jt) jt.textContent = win.short + '入职';
  /* 不按用工类型拆分（2026-10-14 拍板）：单一系列，人口 = 顶栏下拉 */
  barChart('chartJoinByType', months, [{ label: '入职', data: countByMonth(rel, 'joinDate', months), color: tc.pos, borderRadius: 3 }], {
    onClick: (e, els) => { if (els.length) jumpToDetail('mv:mjoin:' + months[els[0].index]); },
  });
  months.forEach(m => registerDetailFilter('mv:mjoin:' + m, m + ' 入职名单', d => relSet.has(d) && d.joinDate && d.joinDate.indexOf(m) === 0));

  /* 离职人员结构图（职级/时长/部门/来源）与 KPI 同一人口（leaversWin），不再各算一次 */
  const structNote = () => scopeNote(eff, '', scopeLabelOf());
  const lvNote = document.getElementById('leaverLevelNote');
  if (lvNote) lvNote.innerHTML = structNote();
  const lvMap = countBy(leaversWin, 'level');
  const lvLabels = sortLevels(Object.keys(lvMap).filter(k => k !== '未知'));
  if (lvLabels.length) {
    hbarChart('chartLeaverLevel', lvLabels, [{ label:'离职人数', data: lvLabels.map(l => lvMap[l]), color: tc.neg }], {
      scales: { y: { ticks: { autoSkip: false } } },
      onClick: (e, els) => { if (els.length) jumpToDetail('mv:lv:' + encodeURIComponent(lvLabels[els[0].index])); },
    });
    lvLabels.forEach(l => registerDetailFilter('mv:lv:' + encodeURIComponent(l), '离职职级 · ' + l, d => leaverSet.has(d) && d.level === l));
  } else destroyChart('chartLeaverLevel');

  /* 时长桶与上面「离职员工平均司龄」共用同一份 ltTenures，不重算 */
  const ltBins = ['<3月','3-6月','6-12月','1-2年','2-5年','5年+'];
  const ltCnt = [0,0,0,0,0,0];
  ltTenures.forEach(t => { const m = t * 12;
    if (m < 3) ltCnt[0]++; else if (m < 6) ltCnt[1]++; else if (m < 12) ltCnt[2]++;
    else if (m < 24) ltCnt[3]++; else if (m < 60) ltCnt[4]++; else ltCnt[5]++; });
  const ltNote = document.getElementById('leaverTenureNote');
  if (ltNote) ltNote.innerHTML = structNote();
  hbarChart('chartLeaverTenure', ltBins, [{ label:'离职人数', data: ltCnt, color: tc.neg }], {
    scales: { y: { ticks: { autoSkip: false } } },
    onClick: (e, els) => { if (els.length) jumpToDetail('mv:tn:' + els[0].index); },
  });
  /* 时长桶与图同界（tenureYearsOf 剔除 t<=0；单位：年） */
  const tnBounds = [[0,0.25],[0.25,0.5],[0.5,1],[1,2],[2,5],[5,Infinity]];
  ltBins.forEach((b, i) => registerDetailFilter('mv:tn:' + i, '在职时长 · ' + b + '（离职者）', d => {
    const t = tenureSpanOf(d); if (t == null) return false;
    return t >= tnBounds[i][0] && t < tnBounds[i][1];
  }));

  /* 各部门流出：单一系列不按人群堆积（2026-10-14 拍板） */
  const deptTotals = countBy(leaversWin, deptKeyOf);
  const deptKeys = Object.keys(deptTotals).filter(k => k !== '未知').sort((a, b) => deptTotals[b] - deptTotals[a]);
  const ldTitle = document.getElementById('leaverDeptTitle');
  const ldNote = document.getElementById('leaverDeptNote');
  if (deptKeys.length) {
    if (ldTitle) ldTitle.textContent = '各部门流出人数 · ' + win.short;
    if (ldNote) ldNote.innerHTML = scopeNote(eff, '按二级部门 · ' + win.label, scopeLabelOf());
    hbarChart('chartLeaverDept', deptKeys.map(k => getDeptLabel(k)), [{ label: win.short + '流出', data: deptKeys.map(k => deptTotals[k]), color: tc.neg }], {
      onClick: (e, els) => { if (els.length) { const k = deptKeys[els[0].index]; if (k) jumpToDetail('mv:dp:' + encodeURIComponent(k)); } },
    });
    deptKeys.forEach(k => registerDetailFilter('mv:dp:' + encodeURIComponent(k), '部门流出 · ' + getDeptLabel(k), d => leaverSet.has(d) && deptKeyOf(d) === k));
  } else { destroyChart('chartLeaverDept'); if (ldNote) ldNote.textContent = '窗口内无流出'; }

  const srcMap = countBy(leaversWin, 'source');
  const srcLabels = Object.keys(srcMap).filter(k => k !== '未知');
  if (srcLabels.length) {
    /* s1 蓝，不用 s2 绿：本页「离职人数」三张图已经是绿（--neg），
       招聘来源是中性计数，同页同色两个意思会串。 */
    hbarChart('chartSource', srcLabels, [{ label:'人数', data: srcLabels.map(s => srcMap[s]), color: tc.s1 }], {
      scales: { y: { ticks: { autoSkip: false } } },
      onClick: (e, els) => { if (els.length) jumpToDetail('mv:src:' + encodeURIComponent(srcLabels[els[0].index])); },
    });
    srcLabels.forEach(s => registerDetailFilter('mv:src:' + encodeURIComponent(s), '招聘来源 · ' + s, d => leaverSet.has(d) && d.source === s));
  } else destroyChart('chartSource');
}

/* ═══ 转正与合同 ═══ */
function renderOps(active, tc) {
  if (!pageVisible('ops')) return;
  /* 人群档位联动（Q5=B）：实习/外协没有转正概念 → 隐藏试用期/转正相关内容，
     保留合同/协议到期（实习协议 / 外包服务协议同样有到期管理价值） */
  const eff = scopeOfFilter();
  const hideProbation = eff === 'intern' || eff === 'outsource';
  const pcEl = document.getElementById('probationCard');
  if (pcEl) pcEl.style.display = hideProbation ? 'none' : '';
  const today = new Date(); today.setHours(0,0,0,0);
  const in90 = new Date(today.getTime() + 90 * 86400000);
  const trial = active.filter(d => d.empType === '试用期');
  /* 转正日历走预定转正日（probEndPlanOf），不再估算——试用期在册 100% 有预定转正日，
     「入职+6月」兜底只在数据缺定期日时兜（2026-10-16 用户拍板） */
  const planEnd = probEndPlanOf;
  const due90 = trial.filter(d => { const p = planEnd(d); return p && p >= today && p <= in90; });
  const overdue = trial.filter(d => { const p = planEnd(d); return p && p < today; });
  const contractTypes = ['固定期限劳动合同','实习协议','外包服务协议','劳务合同'];
  const expiring = active.filter(d => contractTypes.includes(d.contractType) && (() => { const c = toDate(d.contractEnd); return c && c >= today && c <= in90; })());
  const t30 = expiring.filter(d => daysBetween(today, toDate(d.contractEnd)) <= 30);
  const t60 = expiring.filter(d => { const n = daysBetween(today, toDate(d.contractEnd)); return n > 30 && n <= 60; });
  const t90 = expiring.filter(d => { const n = daysBetween(today, toDate(d.contractEnd)); return n > 60 && n <= 90; });

  /* 转正率 = 近 12 月「应届满」的人里，实际已经转正的比例（队列法）。
     以前是「近 12 月转正数 ÷ 近 12 月届满数」两个不同时期的队列相除，
     实测跑出 239%（213 转正 ÷ 89 届满）——分子里混着早就届满、只是这个月才补录转正的老人。
     队列法天生 ≤100%，也正好对应 HR 的问法：「这半年该转正的人，转了几个」。
    注意数据语义（2026-10-15 用户澄清）：probationEnd=实际转正日（约四成填了），
    confirmDate=系统预定转正日；estProbEndOf 按 实际→预定→入职+6月 取值。 */
  const yearAgo = new Date(today.getFullYear()-1, today.getMonth(), today.getDate());
  /* 本页是**唯一**保留 formalOnly 的地方，不是口径收窄：转正只存在于正式员工，
     而 estProbEndOf 对谁都给得出日期（实际→预定→入职+6月 三级取值），
     不限定正式员工的话实习/外协会被算进「届满」分母，转正率凭空掉一截。
     上面的试用期三卡同理——empType==='试用期' 本身就只可能是正式员工。 */
  const formalScope = formalOnly(active);
  const dueCohort = formalScope.filter(d => { const p = estProbEndOf(d); return p && p >= yearAgo && p <= today; });
  const converts12 = dueCohort.filter(d => d.empType === '已转正').length;
  const due12 = dueCohort.length;
  const convRate = due12 > 0 ? (converts12 / due12 * 100) : null;

  document.getElementById('opsKpiRow').innerHTML =
    (hideProbation ? '' :
      kpi('试用期内', trial.length, '当前试用期员工', '--type-probation', 'formal', null, 'ops:trial') +
      // 临期=警告→黄；逾期=不好→绿；转正率=好→红；无异常时回落为「好」红
      kpi('90 天内届满', due90.length, '需启动转正评估', '--warn', 'formal', null, 'ops:due90') +
      kpi('逾期未转正', overdue.length, '届满日已过仍在试用期', overdue.length ? '--neg' : '--pos', 'formal', null, 'ops:overdue')) +
    kpi('合同/协议 90 天内到期', expiring.length, `≤30天 ${t30.length} · 31-60 ${t60.length} · 61-90 ${t90.length}`, expiring.length ? '--warn' : '--pos', 'all', null, 'ops:expiring') +
    (hideProbation
      /* active 已按下拉筛过，再按 eff 滤一遍是恒等操作 */
      ? kpi('当前在册', active.length, GROUP_LABEL[eff] + ' · 试用期/转正指标不适用', '--s1', eff, GROUP_SHORT[eff], 'ops:active')
      : kpi('近 12 月转正率', pctText(convRate, 0), `${converts12} 人已转正 / ${due12} 人应届满`, '--pos', 'formal'));
  /* 人数卡跳转（转正率是比率卡，不可点） */
  registerDetailFilter('ops:trial', '试用期内人员', d => trial.includes(d));
  registerDetailFilter('ops:due90', '90 天内试用届满', d => due90.includes(d));
  registerDetailFilter('ops:overdue', '逾期未转正', d => overdue.includes(d));
  registerDetailFilter('ops:expiring', '合同/协议 90 天内到期', d => expiring.includes(d));
  if (hideProbation) registerDetailFilter('ops:active', GROUP_LABEL[eff] + ' · 在册名单', d => active.includes(d));

  // 到期紧急度 = 警告黄强度梯（越紧急越深）
  hbarChart('chartContractExpiry', ['≤30 天','31-60 天','61-90 天'],
    [{ label:'到期人数', data: [t30.length, t60.length, t90.length], color: ctx => [tc['expire-30'], tc['expire-60'], tc['expire-90']][ctx.dataIndex], borderRadius: 3 }],
    { scales: { y: { ticks: { autoSkip: false } } },
      onClick: (e, els) => { if (els.length) jumpToDetail('ops:exp:' + els[0].index); } });
  const expSets = [t30, t60, t90], expNames = ['≤30 天到期', '31-60 天到期', '61-90 天到期'];
  expSets.forEach((arr, i) => registerDetailFilter('ops:exp:' + i, expNames[i], d => arr.includes(d)));

  const ctMap = countBy(active, 'contractType');
  const ctLabels = Object.keys(ctMap).filter(k => k !== '未知').sort((a,b) => ctMap[b]-ctMap[a]);
  if (ctLabels.length) {
    doughnutChart('chartContractType', ctLabels, ctLabels.map(k => ctMap[k]),
      [tc.s1, tc.s2, tc.s3, tc.s4, tc.s5, tc.s6].slice(0, ctLabels.length),
      { onClick: (e, els) => { if (els.length) jumpToDetail('ops:ct:' + encodeURIComponent(ctLabels[els[0].index])); } });
    ctLabels.forEach(k => registerDetailFilter('ops:ct:' + encodeURIComponent(k), '合同类型 · ' + k, d => active.includes(d) && d.contractType === k));
  } else destroyChart('chartContractType');

  const pRows = due90.slice().sort((a,b) => planEnd(a) - planEnd(b));
  document.getElementById('probationTable').innerHTML =
    '<thead><tr><th>姓名</th><th>工号</th><th>部门</th><th>职等</th><th>入职日期</th><th>预定转正日</th><th>剩余天数</th></tr></thead><tbody>' +
    (pRows.length ? pRows.map(d => { const p = planEnd(d);
      const cell = d.confirmDate ? esc(d.confirmDate)
        : p ? esc(p.toISOString().slice(0,10)) + ' <span class="dim" title="预定转正日缺失，按入职+6个月估算">*</span>'
        : '—';
      return `<tr><td>${esc(d.name)}</td><td>${esc(d.id)}</td><td>${esc(getDeptLabel(d.deptEn||d.dept))}</td><td>${esc(d.level||'—')}</td><td>${esc(d.joinDate)}</td><td>${cell}</td><td>${p ? daysBetween(today, p) + ' 天' : '—'}</td></tr>`; }).join('')
    : '<tr><td colspan="7" class="dim">90 天内无试用届满人员</td></tr>') + '</tbody>';

  const cRows = expiring.slice().sort((a,b) => toDate(a.contractEnd) - toDate(b.contractEnd));
  document.getElementById('contractTable').innerHTML =
    '<thead><tr><th>姓名</th><th>工号</th><th>部门</th><th>用工</th><th>合同类型</th><th>到期日期</th><th>剩余</th><th>分级</th></tr></thead><tbody>' +
    (cRows.length ? cRows.map(d => {
      const n = daysBetween(today, toDate(d.contractEnd));
      const tier = n <= 30 ? '<span class="tag tag-tier-1">紧急</span>'
        : n <= 60 ? '<span class="tag tag-tier-2">关注</span>'
        : '<span class="tag">观察</span>';
      return `<tr><td>${esc(d.name)}</td><td>${esc(d.id)}</td><td>${esc(getDeptLabel(d.deptEn||d.dept))}</td><td>${esc(d.empType)}</td><td>${esc(d.contractType)}</td><td>${esc(d.contractEnd)}</td><td>${n} 天</td><td>${tier}</td></tr>`;
    }).join('') : '<tr><td colspan="8" class="dim">90 天内无合同/协议到期</td></tr>') + '</tbody>';
}

/* ═══ 梯队绩效盘点 ═══ */
/* ═══ 高潜盘点（2026-10-19 talent_hp 占位转真页，grilling 拍板；同日二轮：跨序列+绩效列）═══
   三份名单一页看，数据发现与人工提名互补（实测重合个位数）：
   ① 快晋升 = 总工龄 <10 年且职级 ≥3 档（跨序列通用：T3/M3/S3/L3+，各序列天花板都是 4 档；
   实测 43 人 = T38·M4·S1）；<8 年标「超快」。司龄口径会混入大量「工龄 10+ 中途入职」者
   （105 vs 43），必须用总工龄——首次工作时间(firstWorkDate)，覆盖 98%。
   ② 职级停滞 = 总工龄 ≥10 年且职等 1-2 档（任何序列，21 人 = T2 19 + M2 2；
   S1/S2 工龄 10+ 为 0；L 是管理通道高层不适用「停滞」）。
   ③ 高潜提报 = 台账人工提名，自带「最快晋升 T3」预测 + 25H1/25H2 绩效。
   规则名单带近两期绩效（26H1/25H2，emp.perf）——「停滞但绩效好」和「停滞且绩效差」要分开处理。
   跟顶栏中心/部门/人群筛选联动（在职口径），点行跳人员明细。 */
function renderTalentHp() {
  if (!pageVisible('talent_hp')) return;
  const scope = scopeOfFilter(), scopeLab = scopeLabelOf();
  const act = getScopeData().filter(d => d.status === '在职');
  /* 总工龄（首次工作时间起）只解一次：下面排序比较器、8 年档筛选、逐行渲染都要读它，
     每次现算等于把日期运算重做 O(n log n) 遍 */
  const wyOf = new Map(act.map(d => [d.id, d.firstWorkDate ? calcTenure(d.firstWorkDate) : null]));
  const wy = d => wyOf.get(d.id) ?? null;
  const ten = d => calcTenure(d.joinDate);                                 // 司龄
  const fwy = d => { const v = wy(d); return v == null ? '—' : v.toFixed(1) + ' 年'; };
  /* 近三期绩效 = 动态取最近 3 个有数据的周期，**每期独立一列**、表头写周期名
     （与明细表「动态3期」同源同序：最新在左）。台账高潜行按姓名关联回名册绩效
     （Excel 只给 25H2/25H1，26H1 从名册带），找不到才回落台账原值 */
  const perfPeriods = recentPeriods(3);   // [{key,label}] 最新在左
  const perfHeadHtml = perfPeriods.map(x => `<th>${x[1]}</th>`).join('');
  const perfCell = (d, k) => d.perf && d.perf[k] ? gradeTag(d.perf[k]) : '<span class="dim">—</span>';
  const perfCells = d => perfPeriods.map(([k]) => `<td>${perfCell(d, k)}</td>`).join('');
  /* 台账行的绩效格：优先名册（近三期），缺名册关联才用台账自带的两期 */
  const hpPerfCells = r => {
    const emp = actByName.get(r.name);
    if (emp && emp.perf) return perfCells(emp);
    const legacy = { grade2025Y: r.g25H2, grade2025M: r.g25H1 };
    return perfPeriods.map(([k]) => legacy[k] ? `<td>${gradePill(legacy[k])}</td>` : '<td><span class="dim">—</span></td>').join('');
  };

  /* 职级 ≥3 档（跨序列）：档号 ≥3 即成立，各序列在职天花板都是 4 档 */
  const fast = act.filter(d => /^[TMSL][3-9]/.test(String(d.level || '')) && wy(d) != null && wy(d) < 10)
    .sort((a, b) => wy(a) - wy(b));
  const fast8 = fast.filter(d => wy(d) < 8);
  const fastSeq = countBy(fast, d => (d.level || '—')[0]);
  const seqTxt = Object.keys(fastSeq).sort().map(s => s + ' ' + fastSeq[s]).join(' · ') || '—';
  const stag = act.filter(d => /^[TMS][12]$/.test(String(d.level || '')) && wy(d) != null && wy(d) >= 10)
    .sort((a, b) => wy(b) - wy(a));
  const hp = ledgerRows('highPotential');
  const hpNames = new Set(hp.map(x => x.name));
  const overlap = fast.filter(d => hpNames.has(d.name));

  document.getElementById('hpKpiRow').innerHTML =
    kpi('快晋升 · 三档以上', fast.length, `总工龄 <10 年 · ${seqTxt}`, '--pos', scope, scopeLab, 'hpfast') +
    kpi('其中超快', fast8.length, '总工龄 <8 年', '--s5', scope, scopeLab, 'hpfast8') +
    kpi('职级停滞 · 关注', stag.length, '工龄 ≥10 年 · 职等 1-2 档', '--warn', scope, scopeLab, 'hpstag') +
    kpi('高潜提报', hp.length, '台账人工提名', '--s1', scope, scopeLab, 'hphot') +
    kpi('两单重合', overlap.length, overlap.length ? overlap.map(d => d.name).join(' · ') : '暂无互证', '--s2', scope, scopeLab, 'hpoverlap');
  registerDetailFilter('hpfast', '快晋升 · 总工龄<10年 三档以上', d => fast.includes(d));
  registerDetailFilter('hpfast8', '超快晋升 · 总工龄<8年 三档以上', d => fast8.includes(d));
  registerDetailFilter('hpstag', '职级停滞 · 工龄10年+ 职等1-2档', d => stag.includes(d));
  registerDetailFilter('hphot', '高潜提报名单', d => hpNames.has(d.name));
  registerDetailFilter('hpoverlap', '快晋升 × 高潜重合', d => overlap.includes(d));

  /* 快晋升名单：工龄升序（最快的在最上），行内标 超快/达标 + 近三期绩效（每期一列） */
  document.getElementById('hpFastTable').innerHTML =
    '<thead><tr><th>姓名</th><th>中心</th><th>部门</th><th>职等</th><th>总工龄</th><th>司龄</th>' + perfHeadHtml + '<th>标记</th></tr></thead><tbody>' +
    (fast.length ? fast.map(d => `<tr class="row-jump" onclick="jumpToDetail('hpfr:${esc(d.id)}')"><td>${esc(d.name)}</td><td>${esc(d.center || '—')}</td><td>${esc(getDeptLabel(d.deptEn || d.dept))}</td><td>${esc(d.level || '—')}</td><td>${fwy(d)}</td><td>${ten(d) ? ten(d).toFixed(1) + ' 年' : '—'}</td>${perfCells(d)}<td>${wy(d) < 8 ? '<span class="tag tag-tier-1">超快</span>' : '<span class="tag">达标</span>'}</td></tr>`).join('')
      : `<tr><td colspan="${6 + perfPeriods.length + 1}" class="dim">当前筛选下无符合条件人员</td></tr>`) + '</tbody>';
  fast.forEach(d => registerDetailFilter('hpfr:' + d.id, d.name + ' · 人员明细', x => x === d));
  const fn = document.getElementById('hpFastNote');
  if (fn) fn.textContent = `总工龄<10 年 · 三档以上 · ${fast.length} 人（超快 ${fast8.length}）`;

  /* 停滞名单：工龄降序（最久的最上）+ 近三期绩效（区分「该推的」和「要谈的」） */
  document.getElementById('hpStagTable').innerHTML =
    '<thead><tr><th>姓名</th><th>中心</th><th>部门</th><th>职等</th><th>总工龄</th><th>司龄</th>' + perfHeadHtml + '</tr></thead><tbody>' +
    (stag.length ? stag.map(d => `<tr class="row-jump" onclick="jumpToDetail('hpsr:${esc(d.id)}')"><td>${esc(d.name)}</td><td>${esc(d.center || '—')}</td><td>${esc(getDeptLabel(d.deptEn || d.dept))}</td><td>${esc(d.level || '—')}</td><td>${fwy(d)}</td><td>${ten(d) ? ten(d).toFixed(1) + ' 年' : '—'}</td>${perfCells(d)}</tr>`).join('')
      : `<tr><td colspan="${6 + perfPeriods.length}" class="dim">当前筛选下无符合条件人员</td></tr>`) + '</tbody>';
  stag.forEach(d => registerDetailFilter('hpsr:' + d.id, d.name + ' · 人员明细', x => x === d));
  const sn = document.getElementById('hpStagNote');
  if (sn) sn.textContent = `工龄≥10 年 · 职等 1-2 档（任何序列）· ${stag.length} 人`;

  /* 高潜名单：台账原序，绩效按姓名关联回名册（近三期每期一列），重合者加「已快晋升」标 */
  const actByName = new Map(act.map(d => [d.name, d]));
  document.getElementById('hpHpTable').innerHTML =
    '<thead><tr><th>姓名</th><th>中心</th><th>部门</th><th>职等</th><th>最快晋升 T3</th>' + perfHeadHtml + '<th>交叉</th></tr></thead><tbody>' +
    (hp.length ? hp.map(r => `<tr class="row-jump" onclick="jumpToDetail('hphr:${esc(r.name)}')"><td>${esc(r.name)}</td><td>${esc(r.center || (actByName.get(r.name) && actByName.get(r.name).center) || '—')}</td><td>${esc(r.dept)}</td><td>${esc(r.level || '—')}</td><td>${esc(r.promo || '—')}</td>${hpPerfCells(r)}<td>${fast.some(d => d.name === r.name) ? '<span class="tag tag-tier-1">已快晋升</span>' : '—'}</td></tr>`).join('')
      : `<tr><td colspan="${5 + perfPeriods.length + 1}" class="dim">高潜名单为空</td></tr>`) + '</tbody>';
  hp.forEach(r => registerDetailFilter('hphr:' + r.name, r.name + ' · 人员明细', x => x.name === r.name && x.status === '在职'));
  const hn = document.getElementById('hpHpotNote');
  if (hn) hn.textContent = `台账人工提名 · ${hp.length} 人 · 与快晋升重合 ${overlap.length} 人`;
}

/* ═══ 26H1 职等晋升（数据 = 台账「26H1职等晋升」sheet，2026-10-26 接入）═══
   口径（用户拍板）：
   - 三分类由 ledger.js parsePromo 给出：跨职等=大职等、子职等升档=小职等、转序列降级=转序列（不计入晋升）；
   - 名单展示全部参评人（含未通过，审批列以 pill 标出），KPI 卡按通过口径；
   - 干部梯队晋升人数由 HR 按人员名单另行统计，本页「干部梯队」列只是标记，方便筛出晋升者中的干部梯队成员；
   - 跟顶栏人群下拉（用户 2026-10-26 拍板：顶栏所有界面都要有）：晋升者全部是正式员工，
     顶栏选实习/外协OD 时本页诚实清空，不算 bug。 */
/* 台账序列名 → 短名（整值查表，勿用 replace 子串替换——
   原值已是「T研发技术序列」，把「研发技术序列」换成「T研发」会撞出「TT研发」） */
const SEQ_SHORT = { 'T研发技术序列': 'T研发', 'M营销序列': 'M营销', 'S支持序列': 'S支持' };

function renderPromo(tc) {
  if (!pageVisible('talent_promo')) return;
  const el = document.getElementById('promoKpiRow');
  if (!el) return;
  const all = ledgerRows('promo');
  if (!all.length) {
    renderRecruitEmpty(el, 'promoBigTable', 'promoNote', '26H1 职等晋升');
    destroyChart('chartPromoDept');
    return;
  }
  /* 跟顶栏：只保留当前人群筛过的在职花名册里的人（按工号关联回名册） */
  const act = getScopeData().filter(d => d.status === '在职');
  const actById = new Map(act.map(d => [d.id, d]));
  const rows = all.filter(r => actById.has(r.id));
  const passed = rows.filter(r => r.appr === '通过');
  const big = rows.filter(r => r.kind === '大职等' && r.appr === '通过');
  const small = rows.filter(r => r.kind === '小职等' && r.appr === '通过');

  const scope = scopeOfFilter(), scopeLab = scopeLabelOf();
  /* 齐账：参评 48 = 通过 46 + 不通过 2；通过 46 = 职等晋升 18 + 子等级晋升 25 + 转序列 3 */
  const seqAdj = rows.filter(r => r.kind === '转序列' && r.appr === '通过');
  el.innerHTML =
    kpi('参评', rows.length + ' 人', '', '--s1', scope, scopeLab, 'prmAll') +
    kpi('总裁审批通过', passed.length + ' 人', rows.length ? '通过率 ' + pctOf(passed.length, rows.length, 0) : '', '--pos', scope, scopeLab, 'prmPass') +
    kpi('职等晋升', big.length + ' 人', '', '--s2', scope, scopeLab, 'prmBig') +
    kpi('子等级晋升', small.length + ' 人', '', '--s6', scope, scopeLab, 'prmSmall') +
    kpi('转序列调整', seqAdj.length + ' 人', '', '--s4', scope, scopeLab, 'prmSeq');
  const bigIds = new Set(big.map(r => r.id)), smallIds = new Set(small.map(r => r.id)),
    passIds = new Set(passed.map(r => r.id)), allIds = new Set(rows.map(r => r.id)),
    seqIds = new Set(seqAdj.map(r => r.id));
  registerDetailFilter('prmAll', '26H1 职等晋升 · 全部参评', d => allIds.has(d.id));
  registerDetailFilter('prmPass', '26H1 职等晋升 · 审批通过', d => passIds.has(d.id));
  registerDetailFilter('prmBig', '26H1 职等晋升', d => bigIds.has(d.id));
  registerDetailFilter('prmSmall', '26H1 子等级晋升', d => smallIds.has(d.id));
  registerDetailFilter('prmSeq', '26H1 转序列调整', d => seqIds.has(d.id));

  /* 部门分布（晋升人数，含未通过；18 个部门 → 横条） */
  const byDept = countBy(rows, 'dept');
  const dk = Object.keys(byDept).filter(k => k && k !== '未知').sort((a, b) => byDept[b] - byDept[a] || a.localeCompare(b));
  if (dk.length) hbarChart('chartPromoDept', dk, [{ label: '人数', data: dk.map(k => byDept[k]), color: tc.s1 }],
    { scales: { y: { ticks: { autoSkip: false } } } });
  else destroyChart('chartPromoDept');
  const dn = document.getElementById('promoDeptNote');
  if (dn) dn.textContent = dk.length + ' 个部门 · 共 ' + rows.length + ' 人参评';

  /* 名单：按类别拆三张表（2026-10-26 拍板）——职等（含不通过）/子等级/转序列，
     三表人数合计 = 参评总数，齐账。分表后「调整类别」列同质冗余删；
     干部梯队列删（2026-10-26 二次拍板，干部统计用户自己在台账做）。
     调整前/后 = 职等+子等级（如 T3C）。 */
  const promoTbody = list =>
    (list.length ? list.map(r => `<tr class="row-jump" onclick="jumpToDetail('prmr:${esc(r.id)}')"><td>${esc(r.name)}</td><td>${esc(r.dept || '—')}</td><td>${esc(SEQ_SHORT[r.seq] || r.seq || '—')}</td><td>${esc(r.pre || '—')}</td><td>${esc(r.post || '—')}</td><td>${r.appr === '不通过' ? '<span class="pill pill-crit">不通过</span>' : esc(r.appr || '—')}</td></tr>`).join('')
      : `<tr><td colspan="6" class="dim">当前人群筛选下无名单（晋升者均为正式员工）</td></tr>`);
  const PROMO_HEAD = '<thead><tr><th>姓名</th><th>部门</th><th>职位序列</th><th>调整前</th><th>调整后</th><th>总裁审批</th></tr></thead>';
  /* 三张表的注记只报人数，**不描述颜色**——「不通过」在表里已经是红药丸，
     再写「标红」是复述（2026-10-26 用户要求删掉这两个字）。新增注记沿用这条。 */
  const PROMO_TABLES = [
    ['promoBigTable', 'promoBigNote', rows.filter(r => r.kind === '大职等')],
    ['promoSmallTable', 'promoSmallNote', rows.filter(r => r.kind === '小职等')],
    ['promoSeqTable', 'promoSeqNote', rows.filter(r => r.kind === '转序列')],
  ];
  PROMO_TABLES.forEach(([tid, nid, list]) => {
    document.getElementById(tid).innerHTML = PROMO_HEAD + '<tbody>' + promoTbody(list) + '</tbody>';
    const fails = list.filter(r => r.appr === '不通过').length;
    const note = document.getElementById(nid);
    if (note) note.textContent = `${list.length} 人${fails ? ` · 未通过 ${fails}` : ''}`;
  });
  rows.forEach(r => registerDetailFilter('prmr:' + r.id, r.name + ' · 人员明细', d => d.id === r.id));

  const n = document.getElementById('promoNote');
  if (n) n.textContent = `参评 ${rows.length} 人 · 通过 ${passed.length} 人 · 未通过 ${rows.length - passed.length} 人`;
}

function renderTalent(active, tc) {
  if (!pageVisible('talent')) return;
  const perfActive = active.filter(d => d.hasPerf);
  const av = availablePeriods();
  const latestKey = av.length ? av[av.length-1][0] : null;
  const latestLabel = av.length ? av[av.length-1][1] : '—';

  /* 梯队以 **花名册（KPA 格式）的「梯队」列为准**，绩效表的「梯队类型」只作兜底。
     绩效考评明细是**晋升前**的表：晋升过的人在里面还是旧档，实测 9 人「绩效表比花名册低一档」
     （8 人 干部→人才、1 人 领军→干部），整整齐齐差一档 —— 那是口径旧，不是数据错。
     反过来把绩效表当主口径还有个硬伤：它那一列**根本没有「领军梯队」这个取值**，
     于是领军梯队整行显示 0，看着像没人。 */
  const tierOf = d => d.talentPipeline || (d.perf && d.perf.tierType) || '';
  const tierMap = countBy(active.filter(d => tierOf(d)), tierOf);
  const tierLabels = ['领军梯队','干部梯队','人才梯队'].filter(t => tierMap[t]);
  const covered = tierLabels.reduce((s,t) => s + tierMap[t], 0);
  const highPerf = perfActive.filter(d => ['SA','S','A'].includes(cleanGrade(latestGrade(d.perf))));

  /* 徽标跟顶栏「人群」下拉：active 已是下拉筛过的结果，分母（active / perfActive）
     都跟着它走。原来写死 'all'，选「正式员工」时数字是正式、徽标却还写着「全员」 */
  const scope = scopeOfFilter(), scopeLab = scopeLabelOf();
  document.getElementById('talentKpiRow').innerHTML =
    kpi('梯队覆盖', covered + ' 人', active.length ? (covered/active.length*100).toFixed(1) + '% 覆盖率' : '', '--s1', scope, scopeLab) +
    kpi('盘点数据覆盖', perfActive.length + ' 人', perfMeta.centers.length ? `绩效来源：${perfMeta.centers.join(' / ')}` : '未上传绩效数据', '--s2', scope, scopeLab) +
    kpi('高绩效（S/A）', highPerf.length, perfActive.length ? `占盘点人数 ${(highPerf.length/perfActive.length*100).toFixed(1)}%` : '', '--grade-sa', scope, scopeLab) +
    kpi('最新周期', latestLabel, av.length ? `共 ${av.length} 期数据` : '—', '--s6');

  /* 三列 = 绩效等级分档。**门槛必须写在界面上**（nb-col-sub）：
     B（合格）落在「中坚力量」、B- 独占「待提升」，不写门槛没人猜得到。
     分档靠 gradeScore() 的分数切，不是按等级名硬列 —— 换公司加等级时不用改这里。 */
  const cols = [
    ['待提升',   'B- 及以下', s => s != null && s < 3],
    ['中坚力量', 'B · B+',    s => s != null && s >= 3 && s < 4],
    ['绩效之星', 'A 及以上',  s => s != null && s >= 4],
  ];
  /* 行 = 梯队。**只写数据里真有的梯队名**：数据里只有领军/干部/人才梯队三个值，
     原先并排的「高潜力 / 中潜力 / 基础潜力」是这里硬编的，界面上凭空多出来的说法（2026-10-15 删）。 */
  const rows = ['领军梯队','干部梯队','人才梯队'];
  const grid = rows.map(rname =>
    cols.map(c => perfActive.filter(d => tierOf(d) === rname && c[2](gradeScore(latestGrade(d.perf)))).length));

  let nb = '<div></div>' + cols.map(c =>
    `<div class="nb-col-label"><span class="nb-col-name">${c[0]}</span><span class="nb-col-sub">${c[1]}</span></div>`).join('');
  rows.forEach((rname, ri) => {
    nb += `<div class="nb-row-label">${rname}</div>`;
    cols.forEach((c, ci) => {
      const n = grid[ri][ci];
      /* 三档格子状态走类：空 / 常态 / 突出。原来用内联 opacity:.45 表达「空」——
         opacity 会把底色和描边一起洗淡，读起来像「没加载完」而不是「这里没有数据」。 */
      const cls = n === 0 ? ' empty' : n >= 15 ? ' hot' : '';
      /* 百分比底数 = **盘点范围**（perfActive），与旁边注记同底 —— 三列相加正好 100%。
         原先用的是全体在职（active），于是格子里的百分比只加到 66%，注记却写「盘点范围 210 人」，
         同一张图两个分母，怎么算都对不上（2026-10-15 修）。 */
      const pct = pctOf(n, perfActive.length, 1);
      nb += `<div class="nb-cell${cls}"><strong>${n}</strong><div class="nb-cap">人${n ? ' · ' + pct : ''}</div></div>`;
    });
  });
  document.getElementById('ninebox').innerHTML = nb;
  document.getElementById('nineboxNote').innerHTML =
    scopeNote('all', `纵轴=梯队 · 横轴=${latestLabel}绩效等级 · 盘点范围 ${perfActive.length} 人`);

  /* 图注：把「谁没进来、为什么某行是 0」说清楚。空行不解释，看着就像坏了。 */
  const excluded = active.length - perfActive.length;
  const emptyRows = rows.filter((rn, ri) => grid[ri].every(n => n === 0));
  const emptyWhy = emptyRows.map(rn => {
    const total = active.filter(d => tierOf(d) === rn).length;
    return total ? `${rn}（在职 ${total} 人，均无绩效数据）` : `${rn}（在职无此人）`;
  });
  document.getElementById('nineboxFoot').innerHTML =
    `在职 ${active.length} 人 · 有绩效 ${perfActive.length} 人` +
    (excluded ? ` · ${excluded} 人无绩效数据，未纳入盘点` : '') +
    (emptyWhy.length ? `<br>整行为 0：${emptyWhy.join('、')}。` : '');

  document.getElementById('tierCount').innerHTML = scopeNote('all', `覆盖 ${covered} 人`);
  if (tierLabels.length) hbarChart('chartTierType', tierLabels, [{ label:'人数', data: tierLabels.map(t => tierMap[t]), color: tierLabels.map((t,i) => [tc.s1, tc.s2, tc.s3][i]) }], { scales: { y: { ticks: { autoSkip: false } } } });
  else destroyChart('chartTierType');

  if (latestKey) {
    const gradeMap = {};
    perfActive.forEach(d => { const g = cleanGrade(latestGrade(d.perf)); if (g) gradeMap[g] = (gradeMap[g]||0)+1; });
    const gl = GRADE_ORDER.filter(g => gradeMap[g]);
    document.getElementById('perfGradeNote').innerHTML = scopeNote('all', `${latestLabel} · ${perfActive.length} 人`);
    if (gl.length) doughnutChart('chartPerfGradeDist', gl, gl.map(g => gradeMap[g]), gl.map(g => gradeBarColor(g, tc)));
    else destroyChart('chartPerfGradeDist');

    lineChart('chartPerfTrend', av.map(p => p[1]), [{ label:'平均分值', data: av.map(([k]) => {
      const vals = perfActive.map(d => gradeScore(d.perf[k])).filter(v => v != null);
      return vals.length ? +(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2) : null;
    }), color: tc.s1 }], { scales: { x: chartDefaults(tc).scales.x, y: { ...chartDefaults(tc).scales.y, min: 0, max: 5 } } });
  } else { destroyChart('chartPerfGradeDist'); destroyChart('chartPerfTrend'); }

  /* 表 = 绩效明细：把**数据里真有的每一个周期**摊成一列（24H1 … 26H1），
     不写死周期名与列数 —— 换一批数据（多一期 / 少一期）不用改这里。
     默认顺序 = 工号自然序（全量、不截断）。2026-10-21 用户报「只有干部梯队的数据」：
     原来按最新一期绩效从高到低排完再 .slice(0,40)，高绩效扎堆的干部梯队正好占满前 40 行，
     其余梯队全被截掉。表格现在有分页与排序，不需要再用「截前 40 行」当性能护栏。
     ⚠️ 2026-10-21 再修「某员工搜不到」：**取数必须用 getFiltered() 而不是 active**。
     `active` 只剩在职，28 名「有绩效但已离职」的人（某个已离职员工就是）整批进不来。
     表格是「绩效记录清单」，不是「在职人才盘点」，离职者当然要能查到 —— 加一列「状态」区分。
     KPI / 九宫格 / 趋势图仍按在职口径（perfActive），不受影响。 */
  const tRows = getFiltered().filter(d => d.hasPerf)
    .sort((a,b) => String(a.id).localeCompare(String(b.id)));
  const periodCols = av;
  const headCols = ['工号','姓名','状态','部门','职等','梯队'].concat(periodCols.map(p => p[1]));
  document.getElementById('talentTable').innerHTML =
    '<thead><tr>' + headCols.map(h => `<th>${h}</th>`).join('') + '</tr></thead><tbody>' +
    (tRows.length ? tRows.map(d =>
      `<tr><td>${esc(d.id)}</td><td>${esc(d.name)}</td>` +
      `<td>${statusTag(d)}</td>` +
      `<td>${esc(getDeptLabel(d.deptEn||d.dept))}</td><td>${esc(d.level||'—')}</td><td>${esc(tierOf(d)||'—')}</td>` +
      periodCols.map(([k]) => `<td>${d.perf[k] ? gradeTag(d.perf[k]) : '<span class="dim">—</span>'}</td>`).join('') +
      '</tr>').join('')
    : `<tr><td colspan="${headCols.length}" class="dim">未上传绩效数据或无匹配人员</td></tr>`) + '</tbody>';
}

/* ═══════════════════════════════════════════════════════════════
   人员概览（v8.7 新页面；2026-10-19 与总览拉开定位）—— 三大模块：画像 · 结构 · 变化
   定位分工：总览=「结果驾驶舱」（经营结果 + 跨域入口，汇报用）；
   本页=「人群结构工作台」（队伍长什么样、结构在怎么变）——趋势线归总览、预警归侧边条与 ops 页。
   所有可落到具体人员的地方，点击即跳「人员明细」并自动带筛选。
   ═══════════════════════════════════════════════════════════════ */

/* 序列分类（换公司可复用：逻辑不框死序列名）
   优先用 KPA「职位序列中文描述」（normSeries 已归一化为通用名：研发技术/营销/支持/管理/职能），
   该字段缺失时按职等前缀兜底（T/M/S/L/数字级）。通道清单由数据驱动 —— 数据里有什么序列就展示什么。 */
function seriesChannelOf(d) {
  const s = d.seriesNorm || d.series;
  if (s) return String(s).trim();
  const lv = String(d.level || '');
  if (/^L/i.test(lv)) return '管理';
  if (/^T/i.test(lv)) return '研发技术';
  if (/^M/i.test(lv)) return '营销';
  if (/^S/i.test(lv)) return '支持';
  if (/^\d/.test(lv)) return '数字级';
  return '未识别';
}

/* 人员概览可点击卡片（带 key → 跳明细筛选）。
   就是 kpi() 不挂口径徽标、末位传 jumpKey 的写法，模板不重抄一份 */
function kpiClick(label, value, sub, colorVar, key) {
  return kpi(label, value, sub, colorVar, null, null, key);
}

function renderPeople(active, tc) {
  if (!pageVisible('people')) return;

  /* ── ① 人员画像（2026-10-19 用户拍板：开场与总览 KPI 拉开——
     总览开场答「经营结果怎么样」，本页开场答「这支队伍长什么样」）── */
  const formal = active.filter(d => staffGroupOf(d) === 'formal');
  const probation = formal.filter(d => d.empType === '试用期');
  const interns = active.filter(d => staffGroupOf(d) === 'intern');
  const outs = active.filter(d => staffGroupOf(d) === 'outsource');
  /* 平均司龄（2026-10-23 拍板：独立卡跟顶栏筛选；各类人群卡副文案不带司龄） */
  const avgOf = list => { const a = avgTenureOf(list); return a ? a.toFixed(1) + ' 年' : '—'; };
  /* 男女比：两边都有人才算比值，缺一边给 — */
  const genMap = countBy(active, 'gender');
  const gm = genMap['男'] || 0, gf = genMap['女'] || 0;
  const genderRatio = gm && gf ? (gm >= gf ? (gm / gf).toFixed(1) + ' : 1' : '1 : ' + (gf / gm).toFixed(1)) : '—';
  /* 覆盖面写进模块小字：跟筛选变化的功能性口径，不是操作提示 */
  const deptN = new Set(active.map(d => d.deptEn || d.dept).filter(Boolean)).size;
  const locN = new Set(active.map(d => d.workLocation).filter(Boolean)).size;
  const scaleNote = document.getElementById('peopleScaleNote');
  if (scaleNote) scaleNote.textContent = `覆盖 ${deptN} 个部门${locN ? ' · ' + locN + ' 个工作地点' : ''}`;
  document.getElementById('peopleScaleRow').innerHTML =
    kpiClick('正式员工', formal.length, `含试用期 ${probation.length} 人`, '--pos', 'scale:formal') +
    kpiClick('实习生', interns.length, '签约 + 非签约', '--s3', 'scale:intern') +
    kpiClick('外协OD', outs.length, '外包 + 劳务', '--s4', 'scale:outsource') +
    kpi('平均司龄', avgOf(active), `${scopeLabelAll()} ${active.length} 人`, '--s1') +
    kpi('男女比', genderRatio, gm || gf ? `男 ${gm} · 女 ${gf}` : '性别未填写', '--s2');
  registerDetailFilter('scale:formal', '人员画像 · 正式员工', d => d.status === '在职' && staffGroupOf(d) === 'formal');
  registerDetailFilter('scale:intern', '人员画像 · 实习生', d => d.status === '在职' && staffGroupOf(d) === 'intern');
  registerDetailFilter('scale:outsource', '人员画像 · 外协OD', d => d.status === '在职' && staffGroupOf(d) === 'outsource');

  /* ── ② 部门结构（分类图自动横竖：部门多/名长自动转横条，点击部门）── */
  const deptRows = {};
  active.forEach(d => { const k = d.deptEn || d.dept; if (k) deptRows[k] = (deptRows[k] || 0) + 1; });
  const deptKeys = Object.keys(deptRows).sort((a, b) => deptRows[b] - deptRows[a]);
  document.getElementById('deptStructNote').innerHTML = scopeNote('all', `在职 ${active.length} 人 · ${deptKeys.length} 个部门`);
  hbarChart('chartPeopleDept', deptKeys.map(getDeptLabel), [{
    label: '人数', data: deptKeys.map(k => deptRows[k]), color: tc.s1,
  }], {
    /* 横向条形图的纵轴是部门名：默认 autoSkip 会跳过一半以上标签（maxTicksLimit≈11），
       18 个部门只显示 11 个 →「显示不全」。关掉跳过让所有部门名都画出来 */
    scales: { y: { ticks: { autoSkip: false } } },
    onClick: (e, els) => { if (els.length) { const k = deptKeys[els[0].index]; if (k) jumpToDetail('dept:' + k); } },
  });
  deptKeys.forEach(k => registerDetailFilter('dept:' + k, '部门结构 · ' + getDeptLabel(k), d => d.status === '在职' && (d.deptEn || d.dept) === k));

  /* ── ② 前/中/后台（组织类型环形图，全部分类都展示）── */
  const orgTypeRows = {};
  active.forEach(d => { const k = normOrgType(d.orgType); if (k) orgTypeRows[k] = (orgTypeRows[k] || 0) + 1; });
  const orgKeys = Object.keys(orgTypeRows).sort((a, b) => orgTypeRows[b] - orgTypeRows[a]);
  document.getElementById('orgTypeNote').innerHTML = scopeNote('all', `在职 ${active.length} 人`);
  makeChart('chartOrgType', 'doughnut', orgKeys, [{
    data: orgKeys.map(k => orgTypeRows[k]),
    /* tc 的 key 不带 `--` 前缀（themeColors 里 v.slice(2)），写成 tc['--s1'] 会拿到 undefined → 黑色 */
    backgroundColor: orgKeys.map((_, i) => tc[['s1','s2','s3','s4','s5','s6'][i % 6]]),
  }], {
    onClick: (e, els) => { if (els.length) { const k = orgKeys[els[0].index]; if (k) jumpToDetail('orgtype:' + k); } },
  });
  orgKeys.forEach(k => registerDetailFilter('orgtype:' + k, '组织类型 · ' + k, d => d.status === '在职' && normOrgType(d.orgType) === k));

  /* ── ② 职级结构（序列 → 职等 → 子等级 下钻）——人口 = 顶栏「人群」下拉 ──
     2026-10-14 拍板：不再写死正式员工口径；全部档把实习/外协一并算进来，
     他们的职等/序列若没填会落进「未识别」通道，那是数据的实情，不该藏。 */
  const levelPop = active;
  const channelCount = {};
  levelPop.forEach(d => { const c = seriesChannelOf(d); channelCount[c] = (channelCount[c] || 0) + 1; });
  const chLabels = Object.keys(channelCount).sort((a, b) => channelCount[b] - channelCount[a]);
  document.getElementById('levelStructNote').innerHTML = scopeNote(scopeOfFilter(), `${levelPop.length} 人`, scopeLabelOf());
  /* 这张图只做展示：点它不弹下钻面板、也不跳明细（2026-10-15 用户要求）。
     职级结构的细分看下面「结构分布」区的职级 / 子等级两张图。 */
  /* 单序列计数图走 s1 蓝（理由同校招院校图）：s2 是绿 = --neg，纯人数不该借语义色 */
  hbarChart('chartSeriesBar', chLabels, [{
    label: '人数', data: chLabels.map(k => channelCount[k]), color: tc.s1,
  }]);

}

/* ── 人员变化（2026-10-26 整块从人员概览搬到人员异动，与「统计窗口」共用同一个开关）──
   只保留原模块里**不与统计窗口重复**的部分：各人群净增（期初在册 → 当前）+ 各部门净变化。
   原「期间入职 / 期间离职 / 净增」三张卡已删——与统计窗口的「近X月入职/离职」是同一个数。
   期初在册用入职/离职日期时点重建；人群归属按当前花名册近似。
   2026-10-21 用户：「入离职数据不关系好坏」——图统一分类蓝，不借红绿语义色 */
/* 各人群净增卡：入离职是事实、不是好坏判断，四张卡一律 `--s1` 蓝，
   不借 pos/neg 与分类色板的红黄（见 设计系统 §3.1） */
function renderPeopleChange(scopeArr, win, tc) {
  const inWin = inWinOf(win.sinceMs);
  const outWin = d => d.status === '离职' && !!d.leaveDate && inWin(d.leaveDate);
  const active = scopeArr.filter(d => d.status === '在职');
  const head0 = scopeArr.filter(d => inSvcAt(d, new Date(win.sinceMs)));
  const head0ByGrp = groupCounts(head0);
  const headNowByGrp = groupCounts(active);
  const deltaAll = active.length - head0.length;

  /* 各人群「期间流动」名单一次建好 Set：明细表每行只做 O(1) 判断
     （闭包里现算人群 + 解析日期的话，搜索框每敲一下都要按全表重算一遍） */
  const chgSets = {};
  GROUP_ORDER.forEach(g => {
    chgSets[g] = new Set(scopeArr.filter(d =>
      staffGroupOf(d) === g && (inWin(d.joinDate) || outWin(d))));
  });
  const chgAllSet = new Set(scopeArr.filter(d => inWin(d.joinDate) || outWin(d)));
  const grpRow = document.getElementById('peopleGrpRow');
  if (grpRow) grpRow.innerHTML =
    GROUP_ORDER.map(g => {
      const delta = headNowByGrp[g] - head0ByGrp[g];
      return kpiClick(GROUP_LABEL[g], signed(delta),
        `期初 ${head0ByGrp[g]} → 当前 ${headNowByGrp[g]}`, '--s1', 'chg:g:' + g);
    }).join('') +
    kpiClick('合计', signed(deltaAll), `期初 ${head0.length} → 当前 ${active.length}`, '--s1', 'chg:g:all');
  GROUP_ORDER.forEach(g =>
    registerDetailFilter('chg:g:' + g, `${win.label} · ${GROUP_LABEL[g]}流动名单（期间入职∪离职）`, d => chgSets[g].has(d)));
  registerDetailFilter('chg:g:all', `${win.label} · 全人群流动名单（期间入职∪离职）`, d => chgAllSet.has(d));

  /* 各部门净变化（跟随统计窗口档位，2026-10-26 二次拍板：不再固定近12月。
     点条见该部门窗口内入职+离职名单） */
  const deptFlow = {};
  scopeArr.forEach(d => {
    const k = deptKeyOf(d); if (!k) return;
    const f = deptFlow[k] || (deptFlow[k] = { inn: 0, out: 0 });
    if (inWin(d.joinDate)) f.inn++;
    if (outWin(d)) f.out++;
  });
  const netKeys = Object.keys(deptFlow).filter(k => deptFlow[k].inn || deptFlow[k].out)
    .sort((a, b) => (deptFlow[b].inn - deptFlow[b].out) - (deptFlow[a].inn - deptFlow[a].out));
  const netVals = netKeys.map(k => deptFlow[k].inn - deptFlow[k].out);
  const netIn = netKeys.reduce((s, k) => s + deptFlow[k].inn, 0);
  const netOut = netKeys.reduce((s, k) => s + deptFlow[k].out, 0);
  const dn = document.getElementById('deptNetNote');
  if (dn) dn.innerHTML = scopeNote(scopeOfFilter(),
    `${win.label} · 流入 ${netIn} · 流出 ${netOut} · 净 ${signed(netIn - netOut)}`, scopeLabelOf());
  hbarChart('chartDeptNet', netKeys.map(getDeptLabel), [{
    label: '净变化', data: netVals,
    color: tc.s1,
    borderRadius: 3,
  }], {
    scales: { y: { ticks: { autoSkip: false } } },
    onClick: (e, els) => { if (els.length) { const k = netKeys[els[0].index]; if (k) jumpToDetail('pp:net:' + k); } },
  });
  netKeys.forEach(k => registerDetailFilter('pp:net:' + k, getDeptLabel(k) + ` · ${win.label}入职+离职`,
    d => deptKeyOf(d) === k && (inWin(d.joinDate) || outWin(d))));
}

