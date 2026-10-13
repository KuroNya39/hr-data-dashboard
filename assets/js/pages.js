/* ═══════════════════════════════════════════════════════════════
   v8 pages.js — 各页面渲染
   总览 / 人员概览 / 人员异动 / 转正与合同 / 梯队绩效盘点 /
   社招概览 · 社招需求 / 校招需求 · 校招跟踪 / 简报
   ═══════════════════════════════════════════════════════════════ */

const YEAR_MS = 365.25 * 86400000;
const pageVisible = name => !document.getElementById('page-' + name).classList.contains('hidden');

/* 百分比统一显示：分母为 0 时给「—」，不要显示成笃定的 0.0% */
function pctText(v, digits) {
  return v == null || !isFinite(v) ? '—' : v.toFixed(digits == null ? 1 : digits) + '%';
}

/* ═══ 流失统计窗口（人员异动页）═══
   预设档位切换「流失 + 入职」板块；转正与合同的试用期队列口径不跟随 */
let flowWin = 'm12';
const FLOW_WINS = {
  m3:  { label: '近 3 个月',  short: '近3月' },
  m6:  { label: '近 6 个月',  short: '近6月' },
  m12: { label: '近 12 个月', short: '近12月' },
  m24: { label: '近 24 个月', short: '近24月' },
  ytd: { label: '年初至今',   short: '年初至今' },
  all: { label: '全部历史',   short: '历史累计' },
};
/* 分段切换通用：点亮选中项 + 重绘（统计窗口 / 结构分布口径两个开关共用） */
function setSegSwitch(selId, attr, value) {
  document.querySelectorAll('#' + selId + ' button').forEach(b => b.classList.toggle('on', b.dataset[attr] === value));
  refreshAll();
}
function setFlowWin(w) {
  if (!FLOW_WINS[w]) return;
  flowWin = w;
  setSegSwitch('flowWinSwitch', 'w', w);
}

/* ═══ 人群档位（人员异动页）═══
   2026-10-13 用户拍板：页内「全部/正式/实习/外协」开关删除；
   档位只跟顶栏「人群」筛选器——指定了具体人群就按该人群重算，否则 all 口径
   （比率按正式 + 实习/外协流出对照卡） */
const FLOW_TYPES = ['all', ...GROUP_ORDER];
function effFlowType() {
  const el = document.getElementById('filterGroup');
  const g = groupFilterVal(el ? el.value : 'all');
  return FLOW_TYPES.includes(g) && g !== 'all' ? g : 'all';
}
/* 'YYYY-MM' → 该月 1 号 00:00 的时间戳（窗口起算点） */
function monthStartMs(m) {
  const p = m.split('-');
  return new Date(+p[0], +p[1] - 1, 1).getTime();
}
/* 窗口 → 月份列表 + 起始时刻（scopeArr 供 all 档探测数据起点） */
function flowWindowOf(win, scopeArr) {
  const now = new Date();
  const meta = FLOW_WINS[win] || FLOW_WINS.m12;
  let months, sinceMs, note = '';
  if (win === 'ytd') {
    months = getMonthsList(now.getMonth() + 1);       // 本年第 1 月 → 本月
    sinceMs = new Date(now.getFullYear(), 0, 1).getTime();
  } else if (win === 'all') {
    let min = null;
    (scopeArr || []).forEach(d => [d.joinDate, d.leaveDate].forEach(x => {
      const t = toDate(x); if (t && (min == null || t < min)) min = t;
    }));
    const startY = min ? min.getFullYear() : now.getFullYear() - 5;
    const span = (now.getFullYear() - startY) * 12 + now.getMonth() + 1;
    months = getMonthsList(Math.min(span, 60));
    sinceMs = min ? new Date(startY, min.getMonth(), 1).getTime() : new Date(now.getFullYear() - 5, 0, 1).getTime();
    if (span > 60) note = '趋势图最多展示近 60 个月，比率仍按全部历史';
  } else {
    const n = win === 'm3' ? 3 : win === 'm6' ? 6 : win === 'm24' ? 24 : 12;
    months = getMonthsList(n);
    sinceMs = monthStartMs(months[0]);
  }
  return { months, sinceMs, label: meta.label, short: meta.short, note };
}
/* 月末时刻（当月最后一毫秒） */
function monthEndMs(m) {
  const p = m.split('-');
  return new Date(+p[0], +p[1], 1).getTime() - 1;
}
/* 窗口离职率：窗口内离职 ÷ 窗口各月末在册均值（务必传入同一口径的人群）。
   hcEnds = 各月末在册数（与 months 同序）——调用方若已算过就传进来，
   免得同一份数组被 headcountAt 扫两遍（每行都要 new Date 两次，长窗口下很可观） */
function rollingTurnover(scopeArr, months, sinceMs, hcEnds) {
  months = months || getMonthsList(12);
  if (sinceMs == null) sinceMs = monthStartMs(months[0]);
  const leavers = scopeArr.filter(d => d.status === '离职' && d.leaveDate && toDate(d.leaveDate).getTime() >= sinceMs).length;
  const ends = hcEnds || months.map(m => headcountAt(scopeArr, monthEndMs(m)));
  let sum = 0, n = 0;
  ends.forEach(hc => { if (hc > 0) { sum += hc; n++; } });
  const avg = n ? sum / n : 0;
  // 分母为 0（筛选后一个正式员工都没有）时给 null，让调用方显示「—」而不是 0.0%
  return { leavers, avg, rate: avg > 0 ? leavers / avg * 100 : null };
}

/* 近 12 月流入 / 流出（按入职·离职日期，滚动一年）。
   总览页与简报页固定用这个窗口，不跟随人员异动页的统计窗口切换 */
function flowYearAgoMs() {
  const d = new Date(); d.setFullYear(d.getFullYear() - 1);
  return d.getTime();
}
function flowOut12(scopeArr) {
  const since = flowYearAgoMs();
  return scopeArr.filter(d => d.status === '离职' && d.leaveDate && toDate(d.leaveDate).getTime() >= since).length;
}
function flowIn12(scopeArr) {
  const since = flowYearAgoMs();
  return scopeArr.filter(d => d.joinDate && toDate(d.joinDate).getTime() >= since).length;
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
    return `<div class="seg-card ${c.cls}">
      <div class="seg-head"><span class="seg-title">${GROUP_LABEL[c.key]}</span>${scopeTag(c.key, GROUP_SHORT[c.key])}</div>
      <div class="seg-num">${n}</div>
      <div class="seg-split">${esc(innerTxt)}</div>
      <div class="seg-flow">近 12 月流入 ${inn} · 流出 ${out}${c.key === 'formal' ? '' : ' · 不计离职率'}</div>
    </div>`;
  }).join('');
  el.innerHTML = cards;
}

/* ═══ KPI 卡（比率型指标，默认正式员工口径） ═══ */
function renderKpiCards(active, allActive, allLeavers) {
  if (!pageVisible('overview')) return;
  const scopeData = getScopeData();
  const formalScope = formalOnly(scopeData);
  const rt = rollingTurnover(formalScope);
  const pop = formalOnly(active);
  const tenures = pop.map(d => calcTenure(d.joinDate)).filter(t => t > 0);
  const avgTenure = tenures.length ? tenures.reduce((a,b)=>a+b,0)/tenures.length : 0;
  const joins12 = flowIn12(formalScope.filter(d => d.status === '在职'));
  const netAdd = joins12 - rt.leavers;
  const centerFilter = document.getElementById('filterCenter').value;
  const deptFilter = document.getElementById('filterDept').value;
  const seg = segByGroup(active);

  let cards = '';
  const label = centerFilter !== 'all' ? centerFilter : deptFilter !== 'all' ? deptFilter : '全公司';
  cards += kpi(label + ' · 在职合计', active.length, `正式 ${seg.formal.length} · 实习 ${seg.intern.length} · 外协 ${seg.outsource.length}`, '--s1', 'all');
  if (centerFilter !== 'all') {
    const depts = [...new Set(active.map(d => d.deptEn).filter(Boolean))].length;
    cards += kpi('部门数', depts, `覆盖 ${active.length} 人`, '--s2');
  }
  // 语义：离职率=不好→绿；净增=好→红；司龄为中性指标，走分类色
  cards += kpi('滚动 12 月离职率', pctText(rt.rate), `${rt.leavers} 人离职 · 月均在册 ${Math.round(rt.avg)}`, '--neg', 'formal') +
    kpi('近 12 月净增', (netAdd >= 0 ? '+' : '') + netAdd, `${joins12} 入职 − ${rt.leavers} 离职`, '--pos', 'formal') +
    kpi('平均司龄', avgTenure.toFixed(1) + ' 年', `正式员工 ${pop.length} 人`, '--s5', 'formal');
  document.getElementById('kpiRow').innerHTML = cards;
}

/* ═══ 总览 ═══ */
function renderOverview(active, allActive, allLeavers, tc) {
  if (!pageVisible('overview')) return;
  const scopeData = getScopeData();
  renderSegCards(active, scopeData);

  // 入离职趋势：正式员工口径
  const formalScope = formalOnly(scopeData);
  const months = getMonthsList(12);
  document.getElementById('trendNote').innerHTML = scopeNote('formal', '');
  lineChart('chartTurnoverTrend', months, [
    // 红入绿出：入职=好→红，离职=不好→绿（公司语义）
    { label:'入职', data: countByMonth(formalScope.filter(d => d.status==='在职'), 'joinDate', months), color: tc.pos },
    { label:'离职', data: countByMonth(formalScope.filter(d => d.status==='离职'), 'leaveDate', months), color: tc.neg },
  ]);
  renderOverviewMods();
}

/* ── 总览 · 业务模块摘要卡（大数字 + 一句要点，整卡点击跳转）──
   口径：社招=未达成缺口（已剔除已入职）；校招=26届名单 + 27届需求；
   绩效关注=B-C 名单在册跟踪数；外包=台账在岗/离岗；梯队=高潜/储备干部。
   目标页是占位页的卡片带「建设中」标。 */
function overviewModCard(o) {
  const badge = o.todo ? '<span class="mod-badge">建设中</span>' : '';
  return '<button class="mod-card" onclick="switchPage(\'' + o.page + '\')">' +
    '<div class="mod-head"><span class="mi">' + o.icon + '</span>' + o.title + badge + '</div>' +
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
    note: 'B-C 名单 ' + bc.length + ' 人 · 已离职/优化 ' + bcLeft, todo:true }));

  /* 外包用工 */
  const out = (typeof ledgerData !== 'undefined' && ledgerData && ledgerData.outsource) || { active: [], left: [] };
  if (out.active.length || out.left.length) {
    cards.push(overviewModCard({ page:'outsource_overview', icon:'group', title:'外包用工', num:out.active.length, unit:'人在岗',
      note: '离岗 ' + out.left.length + ' 人', todo:true }));
  } else {
    /* 台账无「外包名单」sheet（OD名单尚未接入）——显示诚实态，不出 0/0 */
    cards.push(overviewModCard({ page:'outsource_overview', icon:'group', title:'外包用工', num:'—', unit:'', note:'台账暂无外包名单', todo:true }));
  }

  /* 人才梯队 */
  const hp = (typeof ledgerData !== 'undefined' && ledgerData && ledgerData.highPotential) || [];
  const rc = (typeof ledgerData !== 'undefined' && ledgerData && ledgerData.reserveCandidates) || [];
  cards.push(overviewModCard({ page:'talent_hp', icon:'military_tech', title:'人才盘点', num:hp.length, unit:'高潜',
    note: '储备干部 ' + rc.length + ' 人', todo:true }));

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
    kpi('未达成需求', totalOpen, `已剔除已入职 · ${open.length} 条`, '--neg', 'formal') +
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
  if (!rows.length) { showToast('暂无数据可导出'); return; }
  const labels = ['部门', '岗位名称', '职类', '岗位方向', '具体方向', '校招人数', '面试评价(S/A/B+)', '学历要求', '配置原因', '地域', '岗位负责人', '备注'];
  const keys = ['dept', 'position', 'jobType', 'direction', 'detail', 'count', 'gradeStr', 'edu', 'reason', 'location', 'owner', 'note'];
  const csv = ['\ufeff' + labels.join(',')].concat(rows.map(r => keys.map(k => {
    const v = r[k] == null ? '' : String(r[k]).replace(/\r?\n/g, ' ');
    return '"' + v.replace(/"/g, '""') + '"';
  }).join(',')));
  downloadCsv('27届校招需求', csv.join('\r\n'));
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
  const mh = months.map(m => '<th>' + m + '月·导师</th><th>' + m + '月·主管</th>').join('');
  const head = '<thead><tr><th>序号</th><th>部门</th><th>姓名</th><th>岗位名称</th><th>导师</th><th>上级主管</th><th>性别</th><th>学历</th><th>毕业院校</th><th>院校类别</th><th>专业</th><th>最终评级</th>' + mh + '<th>offer地点</th><th>签约</th><th>实习/提前入职</th><th>备注</th></tr></thead>';
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
  const signed = rows.filter(r => r.signed === '是').length;
  const internEarly = rows.filter(r => r.intern === '是').length;
  const mentored = rows.filter(r => r.mentor && r.mentor !== '-').length;
  el.innerHTML =
    kpi('校招名单', rows.length + ' 人', '26届 · 均已入职', '--s1') +
    kpi('已签约', signed + ' 人', '', '--s2') +
    kpi('实习/提前入职', internEarly + ' 人', '', '--s4') +
    kpi('导师覆盖', mentored + '/' + rows.length, '', '--s6');

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
  hbarChart('chartTrackTier', tk, [{ label: '人数', data: tk.map(k => byTier[k]), color: tc.s2 }],
    { scales: { y: { ticks: { autoSkip: false } } } });

  /* ③ 最终评级（offer 定级） */
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
    if (en) en.textContent = latest + '月 · 导师+主管评价合并计';
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
  if (!rows.length) { showToast('暂无数据可导出'); return; }
  const months = trackMonths(rows);
  const labels = ['序号', '部门', '姓名', '岗位名称', '导师', '上级主管', '性别', '学历', '毕业院校', '院校类别', '专业', '最终评级'];
  const keys = ['no', 'dept', 'name', 'position', 'mentor', 'lead', 'gender', 'edu', 'school', 'tier', 'major', 'grade'];
  months.forEach(m => { labels.push(m + '月导师评价', m + '月主管评价'); keys.push('m' + m + 'm', 'm' + m + 'l'); });
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
  const csv = ['\ufeff' + labels.join(',')].concat(data.map(r => keys.map(k => {
    const v = r[k] == null ? '' : String(r[k]).replace(/\r?\n/g, ' ');
    return '"' + v.replace(/"/g, '""') + '"';
  }).join(',')));
  downloadCsv('26届校招跟踪', csv.join('\r\n'));
  showToast(`已导出 ${rows.length} 条校招跟踪记录`);
}

/* ═══ 人员概览 · 结构分布区（三组维度 + 仅正式/全员口径）═══ */
let structScopeMode = 'formal';
function setStructScope(m) {
  if (m !== 'formal' && m !== 'all') return;
  structScopeMode = m;
  setSegSwitch('structScopeSwitch', 'sc', m);
}
const TEN_BINS = ['<1 年', '1-3 年', '3-5 年', '5-10 年', '10 年+'];
const tenureBin = t => t < 1 ? 0 : t < 3 ? 1 : t < 5 ? 2 : t < 10 ? 3 : 4;

function renderStructDist(active, tc) {
  if (!pageVisible('people')) return;
  if (!document.getElementById('chartSDLevel')) return;
  const g = groupFilterVal(document.getElementById('filterGroup').value);
  /* 左侧筛选器指定了具体人群则遵从；否则按本区口径开关（默认仅正式） */
  const pop = g !== 'all' ? active.filter(d => staffGroupOf(d) === g)
    : (structScopeMode === 'formal' ? active.filter(d => staffGroupOf(d) === 'formal') : active);
  const scope = g !== 'all' ? g : structScopeMode;
  document.getElementById('structDistNote').innerHTML = scopeNote(scope, `在职 ${pop.length} 人`);
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
  if (workN) hbarChart('chartSDWorkYears', TEN_BINS, [{ label: '人数', data: workCnt, color: tc.s4 }], { scales: { y: { ticks: { autoSkip: false } } } });
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

function renderTurnover(tc, scopeData) {
  if (!pageVisible('turnover')) return;
  const rel = scopeData || getScopeData();
  const seg = segByGroup(rel);
  const formalScope = seg.formal;
  /* 人群档位：all=维持原口径（比率按正式，实习/外协流出单列对照）；
     单一人群=所有指标/图表都按该人群重算（离职率照常算，无「不计率」特例，Q3） */
  const eff = effFlowType();
  const rateBase = eff === 'all' ? formalScope : seg[eff];
  const win = flowWindowOf(flowWin, rateBase);
  const wn = document.getElementById('flowWinNote');
  if (wn) wn.innerHTML = scopeNote(eff === 'all' ? 'formal' : eff, win.label + (win.note ? '（' + win.note + '）' : ''), eff === 'all' ? null : GROUP_SHORT[eff]);
  const inWinDate = d => { const t = toDate(d); return t && t.getTime() >= win.sinceMs; };

  /* 各月末在册数只算一遍：上面的窗口均值与下面的月度趋势图共用 */
  const hcEnds = win.months.map(m => headcountAt(rateBase, monthEndMs(m)));
  const rt = rollingTurnover(rateBase, win.months, win.sinceMs, hcEnds);
  const leaversWin = rateBase.filter(d => d.status === '离职' && inWinDate(d.leaveDate));

  const tenures = leaversWin.map(d => {
    const j = toDate(d.joinDate), l = toDate(d.leaveDate);
    return j && l ? (l - j) / YEAR_MS : null;
  }).filter(t => t > 0);
  const avgLT = tenures.length ? tenures.reduce((a,b)=>a+b,0)/tenures.length : 0;

  let cards;
  if (eff === 'all') {
    cards =
      // 流失类指标一律走「不好=绿」，司龄为中性指标走分类色
      kpi(win.short + '离职率', pctText(rt.rate), `${rt.leavers} 人 · 月均在册 ${Math.round(rt.avg)}`, '--neg', 'formal') +
      kpi(win.short + '离职', leaversWin.length, win.label, '--neg', 'formal') +
      kpi('离职员工平均司龄', avgLT.toFixed(1) + ' 年', win.short + '离职者 · 入职到离职时长', '--s5', 'formal') +
      kpi('实习' + win.short + '流出', seg.intern.filter(d => d.status === '离职' && inWinDate(d.leaveDate)).length, `在册 ${seg.intern.filter(d=>d.status==='在职').length} 人`, '--neg', 'intern') +
      kpi('外协' + win.short + '流出', seg.outsource.filter(d => d.status === '离职' && inWinDate(d.leaveDate)).length, `在册 ${seg.outsource.filter(d=>d.status==='在职').length} 人`, '--neg', 'all');
  } else {
    const inPop = rel.filter(d => staffGroupOf(d) === eff);
    cards =
      kpi(win.short + '离职率', pctText(rt.rate), `${rt.leavers} 人 · 月均在册 ${Math.round(rt.avg)}`, '--neg', eff, GROUP_LABEL[eff]) +
      kpi(win.short + '离职', leaversWin.length, win.label, '--neg', eff, GROUP_LABEL[eff]) +
      kpi('离职员工平均司龄', avgLT.toFixed(1) + ' 年', win.short + '离职者 · 入职到离职时长', '--s5', eff, GROUP_LABEL[eff]) +
      kpi('当前在册', inPop.filter(d => d.status === '在职').length, GROUP_LABEL[eff] + ' · 截至数据更新', '--s1', eff, GROUP_LABEL[eff]) +
      kpi(win.short + '入职', inPop.filter(d => inWinDate(d.joinDate)).length, GROUP_LABEL[eff] + ' · 窗口内入职', '--pos', eff, GROUP_LABEL[eff]);
  }
  document.getElementById('turnoverKpiRow').innerHTML = cards;

  const months = win.months;
  const monthlyRate = months.map((m, i) => {
    const start = new Date(m + '-01');
    const endMs = monthEndMs(m);
    const inMonth = d => { const t = toDate(d); return t && t >= start && t.getTime() <= endMs; };
    const lvThis = rateBase.filter(d => inMonth(d.leaveDate)).length;
    const hcEnd = hcEnds[i] + lvThis;      // 月末在册 + 当月离职（口径：月初在册）
    return hcEnd > 0 ? +(lvThis / hcEnd * 100).toFixed(2) : null;
  });
  document.getElementById('monthlyTurnoverNote').innerHTML =
    scopeNote(eff === 'all' ? 'formal' : eff, '当月离职 ÷ 月均在册 · ' + win.label, eff === 'all' ? null : GROUP_SHORT[eff]);
  barChart('chartMonthlyTurnover', months, [{ label:'离职率 %', data: monthlyRate, color: tc.neg, borderRadius: 3 }], {
    plugins: {
      tooltip: { callbacks: { label: ctx => `离职率 ${ctx.parsed.y}%` } },
      /* 时间轴保持竖柱；柱顶标百分数（>24 个月的历史窗口会自动关） */
      barValue: { format: v => v.toFixed(1) + '%' },
    },
  });

  const jt = document.getElementById('joinByTypeTitle');
  if (jt) jt.textContent = win.short + '入职 · 按用工类型';
  /* 单一人群只画该人群的用工类型系列（正式=已转正/试用期，实习=签约/非签约，外协=外包/劳务） */
  const joinPop = eff === 'all' ? rel : rel.filter(d => staffGroupOf(d) === eff);
  const jTypes = eff === 'all' ? EMP_TYPES : EMP_TYPES.filter(t => staffGroupOf({ empType: t }) === eff);
  const jData = jTypes.map(t => ({
    label: t, data: countByMonth(joinPop.filter(d => d.empType === t), 'joinDate', months),
    color: tc[EMP_TYPE_COLORS[EMP_TYPES.indexOf(t)].slice(2)], borderRadius: 0,
  })).filter(d => d.data.some(v => v > 0));
  barChart('chartJoinByType', months, jData, { stacked: true });

  const lvMap = countBy(leaversWin, 'level');
  const lvLabels = sortLevels(Object.keys(lvMap).filter(k => k !== '未知'));
  if (lvLabels.length) hbarChart('chartLeaverLevel', lvLabels, [{ label:'离职人数', data: lvLabels.map(l => lvMap[l]), color: tc.neg }], { scales: { y: { ticks: { autoSkip: false } } } });
  else destroyChart('chartLeaverLevel');

  const ltBins = ['<3月','3-6月','6-12月','1-2年','2-5年','5年+'];
  const ltCnt = [0,0,0,0,0,0];
  tenures.forEach(t => { const m = t * 12;
    if (m < 3) ltCnt[0]++; else if (m < 6) ltCnt[1]++; else if (m < 12) ltCnt[2]++;
    else if (m < 24) ltCnt[3]++; else if (m < 60) ltCnt[4]++; else ltCnt[5]++; });
  hbarChart('chartLeaverTenure', ltBins, [{ label:'离职人数', data: ltCnt, color: tc.neg }], { scales: { y: { ticks: { autoSkip: false } } } });

  /* 流出对照：全部=三块人群对照；单一人群=该人群内部按用工类型细分（Q4=B） */
  const ltTitle = document.getElementById('leaverTypeTitle');
  const ltNote = document.getElementById('leaverTypeNote');
  const outInWin = arr => arr.filter(d => d.status === '离职' && inWinDate(d.leaveDate)).length;
  if (eff === 'all') {
    if (ltTitle) ltTitle.textContent = '三块人群流出对照';
    if (ltNote) ltNote.textContent = '按人群对照';
    hbarChart('chartLeaverType', GROUP_ORDER.map(k => GROUP_LABEL[k]), [{ label: win.short + '流出', data: [
      outInWin(seg.formal), outInWin(seg.intern), outInWin(seg.outsource),
    ], color: ctx => [tc.s1, tc.s2, tc.s4][ctx.dataIndex] }], { scales: { y: { ticks: { autoSkip: false } } } });
  } else {
    const types = EMP_TYPES.filter(t => staffGroupOf({ empType: t }) === eff);
    if (ltTitle) ltTitle.textContent = GROUP_LABEL[eff] + '流出 · 按用工类型';
    if (ltNote) ltNote.textContent = '按用工类型细分';
    hbarChart('chartLeaverType', types, [{ label: win.short + '流出',
      data: types.map(t => outInWin(rel.filter(d => d.empType === t))),
      color: ctx => tc[EMP_TYPE_COLORS[EMP_TYPES.indexOf(types[ctx.dataIndex])].slice(2)] }],
      { scales: { y: { ticks: { autoSkip: false } } } });
  }

  /* 各部门流出：全部=按人群堆积（哪个部门走了哪些人一目了然）；单一人群=只画该人群 */
  const deptWin = eff === 'all' ? rel.filter(d => d.status === '离职' && inWinDate(d.leaveDate)) : leaversWin;
  const deptKeyOf = d => d.deptEn || d.dept;
  const deptTotals = countBy(deptWin, deptKeyOf);
  const deptKeys = Object.keys(deptTotals).filter(k => k !== '未知').sort((a, b) => deptTotals[b] - deptTotals[a]);
  const ldTitle = document.getElementById('leaverDeptTitle');
  const ldNote = document.getElementById('leaverDeptNote');
  if (deptKeys.length) {
    if (ldTitle) ldTitle.textContent = '各部门流出人数 · ' + win.short;
    if (ldNote) ldNote.innerHTML = eff === 'all'
      ? scopeNote('all', '按人群堆积 · ' + win.label)
      : scopeNote(eff, '按二级部门 · ' + win.label, GROUP_SHORT[eff]);
    if (eff === 'all') {
      const gColors = [tc.s1, tc.s2, tc.s4];
      /* 一遍分桶：原先在 GROUP_ORDER.map 里对每个 (人群, 部门) 重扫 deptWin，
         「全部历史」窗口下是 O(人群 × 部门 × 离职数)。同 recruitByDept 的做法 */
      const bucket = {};
      deptKeys.forEach(k => { bucket[k] = { formal: 0, intern: 0, outsource: 0 }; });
      deptWin.forEach(d => {
        const b = bucket[deptKeyOf(d)];
        if (!b) return;
        const g = staffGroupOf(d);
        if (b[g] !== undefined) b[g]++;
      });
      hbarChart('chartLeaverDept', deptKeys.map(k => getDeptLabel(k)), GROUP_ORDER.map((g, gi) => ({
        label: GROUP_LABEL[g], color: gColors[gi],
        data: deptKeys.map(k => bucket[k][g]),
      })), { stacked: true, scales: { x: { beginAtZero: true, stacked: true }, y: { stacked: true } } });
    } else {
      hbarChart('chartLeaverDept', deptKeys.map(k => getDeptLabel(k)), [{ label: win.short + '流出', data: deptKeys.map(k => deptTotals[k]), color: tc.neg }], {});
    }
  } else { destroyChart('chartLeaverDept'); if (ldNote) ldNote.textContent = '窗口内无流出'; }

  const srcMap = countBy(leaversWin, 'source');
  const srcLabels = Object.keys(srcMap).filter(k => k !== '未知');
  if (srcLabels.length) hbarChart('chartSource', srcLabels, [{ label:'人数', data: srcLabels.map(s => srcMap[s]), color: tc.s2 }], { scales: { y: { ticks: { autoSkip: false } } } });
  else destroyChart('chartSource');
}

/* ═══ 转正与合同 ═══ */
function renderOps(active, tc) {
  if (!pageVisible('ops')) return;
  /* 人群档位联动（Q5=B）：实习/外协没有转正概念 → 隐藏试用期/转正相关内容，
     保留合同/协议到期（实习协议 / 外包服务协议同样有到期管理价值） */
  const eff = effFlowType();
  const hideProbation = eff === 'intern' || eff === 'outsource';
  const pcEl = document.getElementById('probationCard');
  if (pcEl) pcEl.style.display = hideProbation ? 'none' : '';
  const cvEl = document.getElementById('convertTrendCard');
  if (cvEl) cvEl.style.display = hideProbation ? 'none' : '';
  const today = new Date(); today.setHours(0,0,0,0);
  const in90 = new Date(today.getTime() + 90 * 86400000);
  const trial = active.filter(d => d.empType === '试用期');
  const estProbEnd = estProbEndOf;
  const due90 = trial.filter(d => { const p = estProbEnd(d); return p && p >= today && p <= in90; });
  const overdue = trial.filter(d => { const p = estProbEnd(d); return p && p < today; });
  const contractTypes = ['固定期限劳动合同','实习协议','外包服务协议','劳务合同'];
  const expiring = active.filter(d => contractTypes.includes(d.contractType) && (() => { const c = toDate(d.contractEnd); return c && c >= today && c <= in90; })());
  const t30 = expiring.filter(d => daysBetween(today, toDate(d.contractEnd)) <= 30);
  const t60 = expiring.filter(d => { const n = daysBetween(today, toDate(d.contractEnd)); return n > 30 && n <= 60; });
  const t90 = expiring.filter(d => { const n = daysBetween(today, toDate(d.contractEnd)); return n > 60 && n <= 90; });

  /* 转正率 = 近 12 月「应届满」的人里，实际已经转正的比例（队列法）。
     以前是「近 12 月转正数 ÷ 近 12 月届满数」两个不同时期的队列相除，
     实测跑出 239%（213 转正 ÷ 89 届满）——分子里混着早就届满、只是这个月才补录转正的老人。
     队列法天生 ≤100%，也正好对应 HR 的问法：「这半年该转正的人，转了几个」。
    注意 probationEnd 九成人没填，缺的按 入职+6个月 估（estProbEndOf 统一口径，试用期 3-6 月按 6 月算）。 */
  const yearAgo = new Date(today.getFullYear()-1, today.getMonth(), today.getDate());
  const formalScope = formalOnly(active);
  const dueCohort = formalScope.filter(d => { const p = estProbEnd(d); return p && p >= yearAgo && p <= today; });
  const converts12 = dueCohort.filter(d => d.empType === '已转正').length;
  const due12 = dueCohort.length;
  const convRate = due12 > 0 ? (converts12 / due12 * 100) : null;

  document.getElementById('opsKpiRow').innerHTML =
    (hideProbation ? '' :
      kpi('试用期内', trial.length, '当前试用期员工', '--type-probation', 'formal') +
      // 临期=警告→黄；逾期=不好→绿；转正率=好→红；无异常时回落为「好」红
      kpi('90 天内届满', due90.length, '需启动转正评估', '--warn', 'formal') +
      kpi('逾期未转正', overdue.length, '届满日已过仍在试用期', overdue.length ? '--neg' : '--pos', 'formal')) +
    kpi('合同/协议 90 天内到期', expiring.length, `≤30天 ${t30.length} · 31-60 ${t60.length} · 61-90 ${t90.length}`, expiring.length ? '--warn' : '--pos', 'all') +
    (hideProbation
      ? kpi('当前在册', active.filter(d => staffGroupOf(d) === eff).length, GROUP_LABEL[eff] + ' · 试用期/转正指标不适用', '--s1', eff, GROUP_LABEL[eff])
      : kpi('近 12 月转正率', convRate != null ? convRate.toFixed(0) + '%' : '—', `${converts12} 人已转正 / ${due12} 人应届满`, '--pos', 'formal'));

  // 到期紧急度 = 警告黄强度梯（越紧急越深）
  hbarChart('chartContractExpiry', ['≤30 天','31-60 天','61-90 天'],
    [{ label:'到期人数', data: [t30.length, t60.length, t90.length], color: ctx => [tc['expire-30'], tc['expire-60'], tc['expire-90']][ctx.dataIndex], borderRadius: 3 }],
    { scales: { y: { ticks: { autoSkip: false } } } });

  const ctMap = countBy(active, 'contractType');
  const ctLabels = Object.keys(ctMap).filter(k => k !== '未知').sort((a,b) => ctMap[b]-ctMap[a]);
  if (ctLabels.length) doughnutChart('chartContractType', ctLabels, ctLabels.map(k => ctMap[k]),
    [tc.s1, tc.s2, tc.s3, tc.s4, tc.s5, tc.s6].slice(0, ctLabels.length));
  else destroyChart('chartContractType');

  // 和上面的转正率同一口径（正式员工、同一筛选范围）；「届满」用估算值，
  // 否则三分之一没填 probationEnd 的人在这张图上根本不会出现
  const months = getMonthsList(12);
  if (hideProbation) {
    destroyChart('chartConvertTrend');   // 卡片已隐藏，实例一并释放
  } else {
    lineChart('chartConvertTrend', months, [
      { label:'实际转正', data: countByMonth(formalScope, 'confirmDate', months), color: tc.pos },
      { label:'试用届满', data: countByMonth(formalScope, estProbEnd, months), color: tc.s1 },
    ]);
  }

  const pRows = due90.slice().sort((a,b) => estProbEnd(a) - estProbEnd(b));
  document.getElementById('probationTable').innerHTML =
    '<thead><tr><th>姓名</th><th>工号</th><th>部门</th><th>职等</th><th>入职日期</th><th>试用届满(估)</th><th>剩余天数</th></tr></thead><tbody>' +
    (pRows.length ? pRows.map(d => { const p = estProbEnd(d); return `<tr><td>${esc(d.name)}</td><td>${esc(d.id)}</td><td>${esc(getDeptLabel(d.deptEn||d.dept))}</td><td>${esc(d.level||'—')}</td><td>${esc(d.joinDate)}</td><td>${d.probationEnd ? esc(d.probationEnd) : esc(p.toISOString().slice(0,10))}${d.probationEnd ? '' : ' *'}</td><td>${daysBetween(today, p)} 天</td></tr>`; }).join('')
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
function renderTalent(active, tc) {
  if (!pageVisible('talent')) return;
  const perfActive = active.filter(d => d.hasPerf);
  const av = availablePeriods();
  const latestKey = av.length ? av[av.length-1][0] : null;
  const latestLabel = av.length ? av[av.length-1][1] : '—';

  const tierOf = d => (d.perf && d.perf.tierType) || d.talentPipeline || '';
  const tierMap = countBy(active.filter(d => tierOf(d)), tierOf);
  const tierLabels = ['领军梯队','干部梯队','人才梯队'].filter(t => tierMap[t]);
  const covered = tierLabels.reduce((s,t) => s + tierMap[t], 0);
  const highPerf = perfActive.filter(d => ['SA','S','A'].includes(cleanGrade(latestGrade(d.perf))));

  document.getElementById('talentKpiRow').innerHTML =
    // 这三个数的分母都是「当前范围内所有有绩效记录的人」（含实习/外协），
    // 徽标写「正式」会和旁边的九宫格注释自相矛盾，统一按 全员 标
    kpi('梯队覆盖', covered + ' 人', active.length ? (covered/active.length*100).toFixed(1) + '% 覆盖率' : '', '--s1', 'all') +
    kpi('盘点数据覆盖', perfActive.length + ' 人', perfMeta.centers.length ? `绩效来源：${perfMeta.centers.join(' / ')}` : '未上传绩效数据', '--s2', 'all') +
    kpi('高绩效（SA/S/A）', highPerf.length, perfActive.length ? `占盘点人数 ${(highPerf.length/perfActive.length*100).toFixed(1)}%` : '', '--grade-sa', 'all') +
    kpi('最新周期', latestLabel, av.length ? `共 ${av.length} 期数据` : '—', '--s6');

  const cols = [['待提升', s => s != null && s < 3], ['中坚力量', s => s != null && s >= 3 && s < 4], ['绩效之星', s => s != null && s >= 4]];
  const rows = ['领军梯队','干部梯队','人才梯队'];
  let nb = '<div></div>' + cols.map(c => `<div class="nb-col-label">${c[0]}</div>`).join('');
  rows.forEach((rname, ri) => {
    nb += `<div class="nb-row-label">${rname}<br>${['高潜力','中潜力','基础潜力'][ri]}</div>`;
    cols.forEach(c => {
      const members = perfActive.filter(d => tierOf(d) === rname && c[1](gradeScore(latestGrade(d.perf))));
      /* 三档格子状态走类：空 / 常态 / 突出。原来用内联 opacity:.45 表达「空」——
         opacity 会把底色和描边一起洗淡，读起来像「没加载完」而不是「这里没有数据」。 */
      const cls = members.length === 0 ? ' empty' : members.length >= 15 ? ' hot' : '';
      nb += `<div class="nb-cell${cls}"><strong>${members.length}</strong><div class="nb-cap">人${members.length ? ' · ' + (active.length ? (members.length/active.length*100).toFixed(1) : 0) + '%' : ''}</div></div>`;
    });
  });
  document.getElementById('ninebox').innerHTML = nb;
  document.getElementById('nineboxNote').innerHTML =
    scopeNote('all', `纵轴=梯队（潜力） · 横轴=${latestLabel}绩效 · 盘点范围 ${perfActive.length} 人`);

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

    const bracketOrder = ['X<125%','125%≤X<135%','135%≤X<145%','X≥145%'];
    const brMap = {};
    perfActive.forEach(d => { const b = d.perf.inputBracket; if (b && bracketOrder.includes(b)) brMap[b] = (brMap[b]||0)+1; });
    const bl = bracketOrder.filter(b => brMap[b]);
    if (bl.length) hbarChart('chartInputCoeff', bl, [{ label:'人数', data: bl.map(b => brMap[b]),
      color: ctx => ctx.dataIndex === bl.length-1 ? tc.s1 : tc['ink-3'], borderRadius: 3 }],
      { scales: { y: { ticks: { autoSkip: false } } } });
    else destroyChart('chartInputCoeff');
  } else { destroyChart('chartPerfGradeDist'); destroyChart('chartPerfTrend'); destroyChart('chartInputCoeff'); }

  const rankNum = s => { const m = String(s||'').match(/(\d+)\s*$/); return m ? +m[1] : null; };
  const tRows = perfActive.slice().sort((a,b) => {
    const ra = rankNum(a.perf.rank), rb = rankNum(b.perf.rank);
    if (ra != null && rb != null && ra !== rb) return ra - rb;
    if (ra != null && rb == null) return -1;
    if (ra == null && rb != null) return 1;
    return (b.perf.inputCoeff||0) - (a.perf.inputCoeff||0);
  }).slice(0, 40);
  document.getElementById('talentTable').innerHTML =
    '<thead><tr><th>工号</th><th>姓名</th><th>部门</th><th>职等</th><th>梯队</th><th>' + latestLabel + '</th><th>绩效变动</th><th>推荐排名</th><th>投入系数</th></tr></thead><tbody>' +
    (tRows.length ? tRows.map(d => `<tr><td>${esc(d.id)}</td><td>${esc(d.name)}</td><td>${esc(getDeptLabel(d.deptEn||d.dept))}</td><td>${esc(d.level||'—')}</td><td>${esc(tierOf(d)||'—')}</td><td>${gradeTag(latestGrade(d.perf))}</td><td>${esc(d.perf.gradeChange||'—')}</td><td>${esc(d.perf.rank||'—')}</td><td>${d.perf.inputCoeff ? d.perf.inputCoeff.toFixed(2) : '—'}</td></tr>`).join('')
    : '<tr><td colspan="9" class="dim">未上传绩效数据或无匹配人员</td></tr>') + '</tbody>';
}

/* ═══════════════════════════════════════════════════════════════
   人员概览（v8.7 新页面）—— 四大模块：规模 · 结构 · 变化 · 预警
   定位：看板负责「发现问题」，人员明细负责「找到人」。
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
/* 内联 onclick 里的 JS 字符串转义（序列/职等名直接拼进属性，防引号破坏） */
function jsStr(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
/* 职级下钻状态：序列 → 职等 → 子等级（L 通道不做子等级） */
let peopleDrill = { series:null, level:null };

/* 人员概览可点击卡片（带 key → 跳明细筛选） */
function kpiClick(label, value, sub, colorVar, key) {
  const dot = colorVar ? `<span class="kpi-dot" style="--tone:var(${colorVar})"></span>` : '';
  return `<div class="kpi-card clickable" onclick="jumpToDetail('${key}')" aria-label="查看名单"><div class="kpi-label">${dot}${label}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub||''}</div></div>`;
}

function renderPeople(active, allLeavers, tc) {
  if (!pageVisible('people')) return;
  const now = new Date(); now.setHours(0,0,0,0);
  const base = getFiltered();                       // 全局筛选后（含在职与离职）
  const active2 = base.filter(d => d.status === '在职');
  const in60 = new Date(now.getTime() + 60 * 86400000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const inMonth = (d, field) => { const t = toDate(d[field]); return t && t >= monthStart && t <= monthEnd; };
  const reg = (key, title, filter) => { if (typeof registerDetailFilter === 'function') registerDetailFilter(key, title, filter); };

  /* ── ① 人员规模（5 卡）── */
  const formal = active2.filter(d => staffGroupOf(d) === 'formal');
  const probation = formal.filter(d => d.empType === '试用期');
  const interns = active2.filter(d => staffGroupOf(d) === 'intern');
  const outs = active2.filter(d => staffGroupOf(d) === 'outsource');
  document.getElementById('peopleScaleRow').innerHTML =
    kpiClick('总人数', active2.length, '正式 + 实习 + 外包', '--s1', 'scale:all') +
    kpiClick('正式员工', formal.length, `含试用期 ${probation.length} 人`, '--pos', 'scale:formal') +
    kpiClick('试用期', probation.length, '正式员工的子集', '--s2', 'scale:probation') +
    kpiClick('实习生', interns.length, '签约 + 非签约', '--s3', 'scale:intern') +
    kpiClick('外包', outs.length, '外包 + 劳务', '--s4', 'scale:outsource');
  reg('scale:all', '人员规模 · 全体在职', d => d.status === '在职');
  reg('scale:formal', '人员规模 · 正式员工', d => d.status === '在职' && staffGroupOf(d) === 'formal');
  reg('scale:probation', '人员规模 · 试用期', d => d.status === '在职' && d.empType === '试用期');
  reg('scale:intern', '人员规模 · 实习生', d => d.status === '在职' && staffGroupOf(d) === 'intern');
  reg('scale:outsource', '人员规模 · 外包', d => d.status === '在职' && staffGroupOf(d) === 'outsource');

  /* ── ② 部门结构（分类图自动横竖：部门多/名长自动转横条，点击部门）── */
  const deptRows = {};
  active2.forEach(d => { const k = d.deptEn || d.dept; if (k) deptRows[k] = (deptRows[k] || 0) + 1; });
  const deptKeys = Object.keys(deptRows).sort((a, b) => deptRows[b] - deptRows[a]);
  document.getElementById('deptStructNote').innerHTML = scopeNote('all', `在职 ${active2.length} 人 · ${deptKeys.length} 个部门`);
  hbarChart('chartPeopleDept', deptKeys.map(getDeptLabel), [{
    label: '人数', data: deptKeys.map(k => deptRows[k]), color: tc.s1,
  }], {
    /* 横向条形图的纵轴是部门名：默认 autoSkip 会跳过一半以上标签（maxTicksLimit≈11），
       18 个部门只显示 11 个 →「显示不全」。关掉跳过让所有部门名都画出来 */
    scales: { y: { ticks: { autoSkip: false } } },
    onClick: (e, els) => { if (els.length) { const k = deptKeys[els[0].index]; if (k) jumpToDetail('dept:' + k); } },
  });
  deptKeys.forEach(k => reg('dept:' + k, '部门结构 · ' + getDeptLabel(k), d => d.status === '在职' && (d.deptEn || d.dept) === k));

  /* ── ② 前/中/后台（组织类型环形图，全部分类都展示）── */
  const orgTypeRows = {};
  active2.forEach(d => { const k = normOrgType(d.orgType); if (k) orgTypeRows[k] = (orgTypeRows[k] || 0) + 1; });
  const orgKeys = Object.keys(orgTypeRows).sort((a, b) => orgTypeRows[b] - orgTypeRows[a]);
  document.getElementById('orgTypeNote').innerHTML = scopeNote('all', `在职 ${active2.length} 人`);
  makeChart('chartOrgType', 'doughnut', orgKeys, [{
    data: orgKeys.map(k => orgTypeRows[k]),
    /* tc 的 key 不带 `--` 前缀（themeColors 里 v.slice(2)），写成 tc['--s1'] 会拿到 undefined → 黑色 */
    backgroundColor: orgKeys.map((_, i) => tc[['s1','s2','s3','s4','s5','s6'][i % 6]]),
  }], {
    onClick: (e, els) => { if (els.length) { const k = orgKeys[els[0].index]; if (k) jumpToDetail('orgtype:' + k); } },
  });
  orgKeys.forEach(k => reg('orgtype:' + k, '组织类型 · ' + k, d => d.status === '在职' && normOrgType(d.orgType) === k));

  /* ── ② 职级结构（序列 → 职等 → 子等级 下钻，正式员工口径）── */
  const formalActive = active2.filter(d => staffGroupOf(d) === 'formal');
  const channelCount = {};
  formalActive.forEach(d => { const c = seriesChannelOf(d); channelCount[c] = (channelCount[c] || 0) + 1; });
  const chLabels = Object.keys(channelCount).sort((a, b) => channelCount[b] - channelCount[a]);
  document.getElementById('levelStructNote').innerHTML = scopeNote('formal', `正式员工 ${formalActive.length} 人`);
  hbarChart('chartSeriesBar', chLabels, [{
    label: '人数', data: chLabels.map(k => channelCount[k]), color: tc.s2,
  }], {
    onClick: (e, els) => { if (els.length) { const c = chLabels[els[0].index]; if (c) { peopleDrill = { series: c, level: null }; renderLevelDrill(formalActive, tc); } } },
  });
  renderLevelDrill(formalActive, tc);

  /* ── ③ 人员变化（本月入职 / 离职 / 净增）── */
  const joinsThisMonth = base.filter(d => inMonth(d, 'joinDate'));
  const leavesThisMonth = base.filter(d => inMonth(d, 'leaveDate'));
  const netChange = joinsThisMonth.length - leavesThisMonth.length;
  document.getElementById('peopleChangeRow').innerHTML =
    kpiClick('本月入职', joinsThisMonth.length, `${monthStart.getMonth()+1} 月 1 日至数据更新时间`, '--pos', 'change:join') +
    kpiClick('本月离职', leavesThisMonth.length, `${monthStart.getMonth()+1} 月 1 日至数据更新时间`, '--neg', 'change:leave') +
    `<div class="kpi-card"><div class="kpi-label"><span class="kpi-dot" style="--tone:var(--s5)"></span>净增</div><div class="kpi-value ${netChange >= 0 ? 'pos' : 'neg'}">${netChange >= 0 ? '+' : ''}${netChange}</div><div class="kpi-sub">本月入职 − 本月离职</div></div>`;
  reg('change:join', '本月入职', d => inMonth(d, 'joinDate'));
  reg('change:leave', '本月离职', d => inMonth(d, 'leaveDate'));

  /* ── ③ 近 12 个月入离职趋势（全体人员，点击数据点）── */
  const months = getMonthsList(12);
  document.getElementById('trend12Note').innerHTML = scopeNote('all', '按月');
  lineChart('chartPeopleTrend', months, [
    { label: '入职', data: countByMonth(base, 'joinDate', months), color: tc.pos },
    { label: '离职', data: countByMonth(base, 'leaveDate', months), color: tc.neg },
  ], {
    onClick: (e, els) => { if (els.length) {
      const i = els[0].index, ds = els[0].datasetIndex, m = months[i];
      jumpToDetail(ds === 0 ? 'trend:join:' + m : 'trend:leave:' + m);
    } },
  });
  months.forEach(m => {
    reg('trend:join:' + m, m + ' 入职', d => d.joinDate && d.joinDate.indexOf(m) === 0);
    reg('trend:leave:' + m, m + ' 离职', d => d.leaveDate && d.leaveDate.indexOf(m) === 0);
  });

  /* ── ④ 人员预警（未来 60 天，三卡）── */
  const probationDue = active2.filter(d => {
    if (d.empType !== '试用期') return false;
    const p = estProbEndOf(d);
    return p && p >= now && p <= in60;
  });
  const contractDue = active2.filter(d => { const c = toDate(d.contractEnd); return c && c >= now && c <= in60; });
  const leaveSoon = active2.filter(d => { const l = toDate(d.leaveDate); return l && l >= now && l <= in60; });
  document.getElementById('peopleAlertRow').innerHTML =
    kpiClick('近期转正', probationDue.length + ' 人', '未来 60 天试用期届满', '--s2', 'alert:probation60') +
    kpiClick('合同到期', contractDue.length + ' 人', '未来 60 天合同到期', '--s6', 'alert:contract60') +
    kpiClick('近期离职', leaveSoon.length + ' 人', '未来 60 天已确定离职', '--s4', 'alert:leave60');
  reg('alert:probation60', '未来 60 天试用期届满', d => probationDue.includes(d));
  reg('alert:contract60', '未来 60 天合同到期', d => contractDue.includes(d));
  reg('alert:leave60', '未来 60 天已确定离职', d => leaveSoon.includes(d));
}

/* 职级下钻面板：序列 → 职等 → 子等级 → 名单（全数据驱动，不假设任何序列名） */
function renderLevelDrill(formalActive, tc) {
  const panel = document.getElementById('drillPanel');
  if (!panel) return;
  const st = peopleDrill;
  if (!st.series) { panel.innerHTML = ''; return; }
  const pop = formalActive.filter(d => seriesChannelOf(d) === st.series);
  const levelMap = {};
  pop.forEach(d => { const lv = d.level || '（未填）'; levelMap[lv] = (levelMap[lv] || 0) + 1; });
  const levels = Object.keys(levelMap).sort((a, b) => sortLevels([a, b])[0] === a ? -1 : 1);

  let html = `<div class="drill-head">
      <button class="link-btn mi-btn" onclick="resetLevelDrill()"><span class="mi">arrow_back</span>序列</button>
      <span class="drill-crumb">${esc(st.series)}</span>
      ${st.level ? `<span class="drill-crumb">→</span><span class="drill-crumb strong">${esc(st.level)}</span>` : ''}
      <span class="chart-note">${pop.length} 人</span>
    </div><div class="drill-chips">`;
  const chip = (label, n, click) => `<button class="drill-chip" onclick="${click}">${esc(label)}<span class="drill-count">${n}</span></button>`;
  if (st.level) {
    /* 第三层：子等级（数据里有子等级就展示，没有则直接到名单） */
    const subPop = pop.filter(d => (d.level || '（未填）') === st.level);
    html += chip('全部', subPop.length, `jumpToDetail('drill:${st.series}:${encodeURIComponent(st.level)}')`);
    const hasSub = subPop.some(d => d.subLevel);
    if (hasSub) {
      const subMap = {};
      subPop.forEach(d => { const s = d.subLevel || '未填'; subMap[s] = (subMap[s] || 0) + 1; });
      Object.keys(subMap).sort().forEach(s => html += chip(s, subMap[s], `jumpToDetail('drill:${st.series}:${encodeURIComponent(st.level)}:${encodeURIComponent(s)}')`));
    }
  } else {
    /* 第二层：职等 */
    levels.forEach(lv => {
      if (lv === '（未填）') { html += chip('未填职等', levelMap[lv], `jumpToDetail('drill:${st.series}:NA')`); return; }
      html += chip(lv, levelMap[lv], `peopleDrill={series:'${jsStr(st.series)}',level:'${encodeURIComponent(lv)}'};renderLevelDrill(window.__formalActive||[],window.__drillTc);`);
    });
  }
  html += '</div>';
  panel.innerHTML = html;
  /* 供内联 onclick 取数（renderPeople 每次刷新已重算，这里缓存一份） */
  window.__formalActive = formalActive;
  window.__drillTc = tc;
}
function resetLevelDrill() { peopleDrill = { series:null, level:null }; const p = document.getElementById('drillPanel'); if (p) p.innerHTML = ''; }
