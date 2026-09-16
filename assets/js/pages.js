/* ═══════════════════════════════════════════════════════════════
   v8 pages.js — 各页面渲染
   总览 / 组织与用工 / 人员结构 / 人员流动 / 转正与合同 /
   梯队绩效盘点 / 职级健康度 / HR 工作台账 / 简报
   ═══════════════════════════════════════════════════════════════ */

const YEAR_MS = 365.25 * 86400000;
const pageVisible = name => !document.getElementById('page-' + name).classList.contains('hidden');

/* 结构类图表的口径：用户明确选人群则遵其选择，否则默认正式员工
   注意 scope 要原样透传 g —— 以前把 outsource 归成 'all'，
   筛选到「外协」时徽标会写着「全员（含外协）」，和眼前的数据对不上 */
function structureScope(active) {
  const g = document.getElementById('filterGroup').value;
  if (g !== 'all') return { data: active, scope: g };
  return { data: formalOnly(active), scope: 'formal' };
}
function scopeWord(scope) {
  return scope === 'formal' ? '正式员工' : scope === 'intern' ? '实习生' : scope === 'outsource' ? '外协人员' : '全员';
}
/* 百分比统一显示：分母为 0 时给「—」，不要显示成笃定的 0.0% */
function pctText(v, digits) {
  return v == null || !isFinite(v) ? '—' : v.toFixed(digits == null ? 1 : digits) + '%';
}

/* 滚动 12 月离职率：近12月离职 ÷ 同期月均在册（务必传入同一口径的人群） */
function rollingTurnover(scopeArr) {
  const now = new Date();
  const yearAgo = new Date(now.getFullYear()-1, now.getMonth(), now.getDate());
  const leavers12 = scopeArr.filter(d => d.status==='离职' && d.leaveDate && toDate(d.leaveDate) >= yearAgo).length;
  const months = getMonthsList(12);
  let sum = 0, n = 0;
  months.forEach(m => {
    const start = new Date(m + '-01');
    const end = new Date(start.getFullYear(), start.getMonth()+1, 1).getTime() - 1;
    const hc = headcountAt(scopeArr, end);
    if (hc > 0) { sum += hc; n++; }
  });
  const avg = n ? sum / n : 0;
  // 分母为 0（筛选后一个正式员工都没有）时给 null，让调用方显示「—」而不是 0.0%
  return { leavers12, avg, rate: avg > 0 ? leavers12 / avg * 100 : null };
}
/* 近 12 月流出人数（按离职日期） */
function flowOut12(scopeArr) {
  const yearAgo = new Date(); yearAgo.setFullYear(yearAgo.getFullYear()-1);
  return scopeArr.filter(d => d.status==='离职' && d.leaveDate && toDate(d.leaveDate) >= yearAgo).length;
}
/* 近 12 月流入人数（按入职日期，现存人员） */
function flowIn12(scopeArr) {
  const yearAgo = new Date(); yearAgo.setFullYear(yearAgo.getFullYear()-1);
  return scopeArr.filter(d => d.joinDate && toDate(d.joinDate) >= yearAgo).length;
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
  const netAdd = joins12 - rt.leavers12;
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
  cards += kpi('滚动 12 月离职率', pctText(rt.rate), `${rt.leavers12} 人离职 · 月均在册 ${Math.round(rt.avg)}`, '--neg', 'formal') +
    kpi('近 12 月净增', (netAdd >= 0 ? '+' : '') + netAdd, `${joins12} 入职 − ${rt.leavers12} 离职`, '--pos', 'formal') +
    kpi('平均司龄', avgTenure.toFixed(1) + ' 年', `正式员工 ${pop.length} 人`, '--s5', 'formal');
  document.getElementById('kpiRow').innerHTML = cards;
}

/* ═══ 总览 ═══ */
function renderOverview(active, allActive, allLeavers, tc) {
  if (!pageVisible('overview')) return;
  const scopeData = getScopeData();
  renderSegCards(active, scopeData);

  const centerFilter = document.getElementById('filterCenter').value;
  if (centerFilter !== 'all') {
    const depts = [...new Set(active.map(d => d.deptEn || d.dept).filter(Boolean))].sort();
    const aCnt = depts.map(k => active.filter(d => (d.deptEn||d.dept) === k).length);
    const lCnt = depts.map(k => allLeavers.filter(d => d.center === centerFilter && (d.deptEn||d.dept) === k).length);
    document.getElementById('hcTitle').textContent = `部门编制分布 — ${centerFilter}`;
    document.getElementById('hcCount').innerHTML = scopeNote('all', `在职 ${active.length} 人 · ${depts.length} 个部门`);
    barChart('chartHeadcount', depts, [
      { label:'在职', data: aCnt, color: tc.s1 },
      { label:'已离职', data: lCnt, color: tc.neg },
    ]);
  } else {
    const centers = [...new Set(rawData.map(d => d.center).filter(Boolean))].sort();
    document.getElementById('hcTitle').textContent = '各中心编制分布';
    document.getElementById('hcCount').innerHTML = scopeNote('all', `在职 ${active.length} 人 · ${centers.length} 个中心`);
    barChart('chartHeadcount', centers, [
      { label:'在职', data: centers.map(c => active.filter(d => d.center === c).length), color: tc.s1 },
      { label:'已离职', data: centers.map(c => allLeavers.filter(d => d.center === c).length), color: tc.neg },
    ]);
  }

  // 入离职趋势：正式员工口径
  const formalScope = formalOnly(scopeData);
  const months = getMonthsList(12);
  document.getElementById('trendNote').innerHTML = scopeNote('formal', '按月');
  lineChart('chartTurnoverTrend', months, [
    // 红入绿出：入职=好→红，离职=不好→绿（公司语义）
    { label:'入职', data: countByMonth(formalScope.filter(d => d.status==='在职'), 'joinDate', months), color: tc.pos },
    { label:'离职', data: countByMonth(formalScope.filter(d => d.status==='离职'), 'leaveDate', months), color: tc.neg },
  ]);

  const empTypeMap = countBy(active, 'empType');
  const labels = EMP_TYPES.filter(t => empTypeMap[t]);
  const data = labels.map(t => empTypeMap[t]);
  const colors = labels.map(t => tc[EMP_TYPE_COLORS[EMP_TYPES.indexOf(t)].slice(2)]);
  document.getElementById('typeCount').innerHTML = scopeNote('all', `${active.length} 人`);
  if (data.length) doughnutChart('chartEmpType', labels, data, colors);
  else destroyChart('chartEmpType');
}

/* ═══ 组织与用工 ═══ */
function renderStructure(active, tc) {
  if (!pageVisible('structure')) return;
  const sc = structureScope(active);
  const pop = sc.data;
  const scope = sc.scope;
  const centers = [...new Set(active.map(d => d.center).filter(Boolean))].sort();
  const levels = sortLevels([...new Set(pop.map(d => d.level).filter(Boolean))]);   // 去重后排序（v7 此处误用全量数组）
  /* 手工数据源：编制达成率（仅当 data/看板数据源.xlsx 填了「部门编制」才出现） */
  const bg = typeof dsBudgetSummary === 'function' ? dsBudgetSummary() : null;
  document.getElementById('structureKpiRow').innerHTML =
    kpi('部门数', [...new Set(pop.map(d => d.deptEn || d.dept).filter(Boolean))].length, `${scopeWord(scope)}口径`, '--s1', scope) +
    kpi('总人数', pop.length, `${levels.length} 个职级 · T/M/P/S/L 全识别`, '--s2', scope) +
    kpi('岗位序列', [...new Set(pop.map(d => d.seriesNorm).filter(Boolean))].length, '归一化后', '--s3') +
    (bg
      ? kpi('编制达成率', bg.rate != null ? bg.rate.toFixed(0) + '%' : '—',
          `已到位 ${bg.actual} / 编制 ${bg.plan}（${bg.depts} 个部门）· 手工数据源`,
          bg.rate != null && bg.rate >= 95 ? '--pos' : bg.rate != null && bg.rate >= 85 ? '--warn' : '--neg', 'formal')
      : kpi('外包+劳务', active.filter(d => d.group === 'outsource').length, '弹性用工规模（全员口径）', '--s6', 'all'));

  /* 编制缺口图（有手工编制数据时才画，否则清图） */
  if (typeof renderBudgetGap === 'function') renderBudgetGap();

  barChart('chartLevel', levels, centers.map(c => ({
    label: c, data: levels.map(l => pop.filter(d => d.center === c && d.level === l).length),
  })), { stacked: true });
  document.getElementById('levelCount').innerHTML = scopeNote(scope, `${levels.length} 个职级`);

  renderDeptMatrix(active, tc);

  const seriesMap = countBy(pop, 'seriesNorm');
  const seriesLabels = Object.keys(seriesMap).filter(k => k !== '未知');
  barChart('chartSeries', seriesLabels, [{ label:'人数', data: seriesLabels.map(s => seriesMap[s]), color: tc.s1 }]);

  const crossEL = countByTwo(active, d => d.empType, d => d.level);
  const elLabels = sortLevels([...new Set(active.map(d => d.level).filter(Boolean))]);
  barChart('chartEmpTypeLevel', elLabels, EMP_TYPES.map((t, i) => ({
    label: t, data: elLabels.map(l => (crossEL[t] && crossEL[t][l]) || 0),
    color: tc[EMP_TYPE_COLORS[i].slice(2)],
  })), { stacked: true });

  barChart('chartCenterType', centers, EMP_TYPES.map((t, i) => ({
    label: t, data: centers.map(c => active.filter(d => d.center === c && d.empType === t).length),
    color: tc[EMP_TYPE_COLORS[i].slice(2)],
  })), { stacked: true });
}

/* ═══ 部门透视表（二级部门 × 三块人群 × 离职率） ═══ */
function renderDeptMatrix(active, tc) {
  const wrap = document.getElementById('deptMatrixWrap');
  if (!wrap) return;
  const scopeData = getScopeData();
  const depts = [...new Set(active.map(d => d.deptEn || d.dept).filter(Boolean))];
  const rows = depts.map(dk => {
    const act = active.filter(d => (d.deptEn||d.dept) === dk);
    const seg = segByGroup(act);
    const formalScope = formalOnly(scopeData.filter(d => (d.deptEn||d.dept) === dk));
    const rt = rollingTurnover(formalScope);
    const ten = formalScope.filter(d => d.status==='在职').map(d => calcTenure(d.joinDate)).filter(t => t > 0);
    const avgTen = ten.length ? ten.reduce((a,b)=>a+b,0)/ten.length : 0;
    const lvMap = countBy(act, 'level');
    const topLevel = Object.keys(lvMap).filter(k => k !== '未知').sort((a,b) => lvMap[b]-lvMap[a])[0] || '—';
    return { dk, act: act.length, formal: seg.formal.length, intern: seg.intern.length, outsource: seg.outsource.length, rt: rt.rate, avgTen, topLevel };
  }).sort((a,b) => b.act - a.act);
  if (!rows.length) { wrap.innerHTML = '<div class="ledger-empty">当前筛选范围内无部门数据</div>'; return; }
  const maxAct = Math.max(...rows.map(r => r.act));
  const totals = rows.reduce((s,r) => ({ act:s.act+r.act, formal:s.formal+r.formal, intern:s.intern+r.intern, outsource:s.outsource+r.outsource }), { act:0,formal:0,intern:0,outsource:0 });
  const rateCell = r => {
    // 只有「算不出来」才是「—」；真的 0% 要如实显示成 0.0%
    if (r.rt == null || !isFinite(r.rt)) return '<span class="dim">—</span>';
    const cls = r.rt >= 40 ? 'crit' : r.rt >= 22 ? 'warn' : '';
    return `<span class="mbar ${cls}" style="width:${Math.min(60, r.rt*1.2)}px"></span>${r.rt.toFixed(1)}%`;
  };
  wrap.innerHTML = '<table class="matrix-table"><thead><tr>' +
    '<th>二级部门</th><th>在职合计</th><th>正式</th><th>实习</th><th>外协</th><th>滚动12月离职率</th><th>正式平均司龄</th><th>主要职等</th>' +
    '</tr></thead><tbody>' +
    rows.map(r => `<tr>
      <td>${esc(getDeptLabel(r.dk))}</td>
      <td><span class="mbar" style="width:${Math.round(r.act/maxAct*56)}px"></span>${r.act}</td>
      <td>${r.formal}</td><td>${r.intern}</td><td>${r.outsource}</td>
      <td>${rateCell(r)}</td>
      <td>${r.avgTen ? r.avgTen.toFixed(1) + ' 年' : '<span class="dim">—</span>'}</td>
      <td>${esc(r.topLevel)}</td></tr>`).join('') +
    '</tbody><tfoot><tr><td>合计</td><td>' + totals.act + '</td><td>' + totals.formal + '</td><td>' + totals.intern + '</td><td>' + totals.outsource + '</td><td colspan="3" class="dim">离职率与司龄均为正式员工口径</td></tr></tfoot></table>';
}

/* ═══ 人员结构 ═══ */
function renderDemographics(active, tc) {
  if (!pageVisible('demographics')) return;
  const sc = structureScope(active);
  const pop = sc.data;
  const nowY = new Date().getFullYear();
  const ageBins = ['25岁以下','25-29','30-34','35-39','40-44','45岁以上'];
  const ageCnt = [0,0,0,0,0,0];
  pop.forEach(d => {
    if (!d.birthYear) return;
    const age = nowY - d.birthYear;
    if (age < 25) ageCnt[0]++; else if (age < 30) ageCnt[1]++; else if (age < 35) ageCnt[2]++;
    else if (age < 40) ageCnt[3]++; else if (age < 45) ageCnt[4]++; else ageCnt[5]++;
  });
  barChart('chartAge', ageBins, [{ label:'人数', data: ageCnt, color: tc.s1 }]);

  const tenBins = ['<1年','1-3年','3-5年','5-8年','8年+'];
  const bucket = t => t < 1 ? 0 : t < 3 ? 1 : t < 5 ? 2 : t < 8 ? 3 : 4;
  const tenCnt = [0,0,0,0,0];
  // 没填入职日期的行不计入：calcTenure 对空日期返回 0，会被算进「<1年」，这一档就虚高了
  pop.forEach(d => { const t = calcTenure(d.joinDate); if (t > 0) tenCnt[bucket(t)]++; });
  barChart('chartTenure', tenBins, [{ label:'人数', data: tenCnt, color: tc.s4 }]);

  const eduMap = countBy(pop, 'edu');
  const eduLabels = ['博士','硕士','本科','大专'].filter(k => eduMap[k]);
  if (eduLabels.length) doughnutChart('chartEdu', eduLabels, eduLabels.map(k => eduMap[k]), [tc.s1, tc.s2, tc.s3, tc.s4].slice(0, eduLabels.length));
  else destroyChart('chartEdu');

  const genMap = countBy(pop, 'gender');
  const genLabels = ['男','女'].filter(k => genMap[k]);
  if (genLabels.length) doughnutChart('chartGender', genLabels, genLabels.map(k => genMap[k]), [tc.s1, tc.s3]);
  else destroyChart('chartGender');

  const locMap = countBy(pop, 'workLocation');
  const locLabels = Object.keys(locMap).filter(k => k !== '未知').sort((a,b) => locMap[b] - locMap[a]);
  barChart('chartLocation', locLabels, [{ label:'人数', data: locLabels.map(l => locMap[l]), color: tc.s1 }]);

  // 经验结构：以「首次工作时间」为主（行业年限# 字段覆盖率低），兜底用 行业年限#
  const indCnt = [0,0,0,0,0], coCnt = tenCnt.slice();
  let indCovered = 0;
  pop.forEach(d => {
    let iy = d.industryYears;
    if (iy == null && d.firstWorkDate) iy = calcTenure(d.firstWorkDate);
    if (iy != null && iy > 0) { indCnt[bucket(iy)]++; indCovered++; }
  });
  document.getElementById('industryNote').innerHTML = scopeNote(sc.scope, `覆盖 ${indCovered}/${pop.length} 人`);
  barChart('chartIndustry', tenBins, [
    { label:'社会经验（首次工作起）', data: indCnt, color: tc.s1 },
    { label:'公司司龄', data: coCnt, color: tc.s4 },
  ]);
  const dn = document.getElementById('demoScopeNote');
  if (dn) dn.innerHTML = scopeNote(sc.scope, '结构类图表口径');
}

/* ═══ 人员流动 ═══ */
function renderTurnover(allLeavers, allActive, tc, scopeData) {
  if (!pageVisible('turnover')) return;
  const rel = scopeData || getScopeData();
  const seg = segByGroup(rel);
  const formalScope = seg.formal;
  const rt = rollingTurnover(formalScope);
  const formalLeavers = formalScope.filter(d => d.status === '离职');

  const tenures = formalLeavers.map(d => {
    const j = toDate(d.joinDate), l = toDate(d.leaveDate);
    return j && l ? (l - j) / YEAR_MS : null;
  }).filter(t => t > 0);
  const avgLT = tenures.length ? tenures.reduce((a,b)=>a+b,0)/tenures.length : 0;

  document.getElementById('turnoverKpiRow').innerHTML =
    // 流失类指标一律走「不好=绿」，司龄为中性指标走分类色
    kpi('滚动 12 月离职率', pctText(rt.rate), `${rt.leavers12} 人 · 月均在册 ${Math.round(rt.avg)}`, '--neg', 'formal') +
    kpi('正式员工历史累计离职', formalLeavers.length, '数据范围内全部', '--neg', 'formal') +
    kpi('离职员工平均司龄', avgLT.toFixed(1) + ' 年', '入职到离职时长', '--s5', 'formal') +
    kpi('实习生近12月流出', flowOut12(seg.intern), `在册 ${seg.intern.filter(d=>d.status==='在职').length} 人 · 不计率`, '--neg', 'intern') +
    kpi('外协近12月流出', flowOut12(seg.outsource), `在册 ${seg.outsource.filter(d=>d.status==='在职').length} 人 · 不计率`, '--neg', 'all');

  const months = getMonthsList(12);
  const monthlyRate = months.map(m => {
    const start = new Date(m + '-01');
    const end = new Date(start.getFullYear(), start.getMonth()+1, 1);
    const endMs = end.getTime() - 1;
    const inMonth = d => { const t = toDate(d); return t && t >= start && t.getTime() <= endMs; };
    const lvThis = formalScope.filter(d => inMonth(d.leaveDate)).length;
    const hcEnd = headcountAt(formalScope, endMs) + lvThis;
    return hcEnd > 0 ? +(lvThis / hcEnd * 100).toFixed(2) : null;
  });
  document.getElementById('monthlyTurnoverNote').innerHTML = scopeNote('formal', '当月离职 ÷ 月均在册');
  barChart('chartMonthlyTurnover', months, [{ label:'离职率 %', data: monthlyRate, color: tc.neg, borderRadius: 3 }], {
    plugins: { tooltip: { callbacks: { label: ctx => `离职率 ${ctx.parsed.y}%` } } },
  });

  const jData = EMP_TYPES.map((t, i) => ({
    label: t, data: countByMonth(rel.filter(d => d.empType === t), 'joinDate', months),
    color: tc[EMP_TYPE_COLORS[i].slice(2)], borderRadius: 0,
  })).filter(d => d.data.some(v => v > 0));
  barChart('chartJoinByType', months, jData, { stacked: true });

  const lvMap = countBy(formalLeavers, 'level');
  const lvLabels = sortLevels(Object.keys(lvMap).filter(k => k !== '未知'));
  if (lvLabels.length) barChart('chartLeaverLevel', lvLabels, [{ label:'离职人数', data: lvLabels.map(l => lvMap[l]), color: tc.neg }]);
  else destroyChart('chartLeaverLevel');

  const ltBins = ['<3月','3-6月','6-12月','1-2年','2-5年','5年+'];
  const ltCnt = [0,0,0,0,0,0];
  tenures.forEach(t => { const m = t * 12;
    if (m < 3) ltCnt[0]++; else if (m < 6) ltCnt[1]++; else if (m < 12) ltCnt[2]++;
    else if (m < 24) ltCnt[3]++; else if (m < 60) ltCnt[4]++; else ltCnt[5]++; });
  barChart('chartLeaverTenure', ltBins, [{ label:'离职人数', data: ltCnt, color: tc.neg }]);

  // 三块人群流出对照
  const outLabels = GROUP_ORDER.map(k => GROUP_LABEL[k]);
  barChart('chartLeaverType', outLabels, [{ label:'近12月流出', data: [
    flowOut12(seg.formal), flowOut12(seg.intern), flowOut12(seg.outsource),
  ], color: ctx => [tc.s1, tc.s2, tc.s4][ctx.dataIndex] }]);

  const srcMap = countBy(formalLeavers, 'source');
  const srcLabels = Object.keys(srcMap).filter(k => k !== '未知');
  if (srcLabels.length) barChart('chartSource', srcLabels, [{ label:'人数', data: srcLabels.map(s => srcMap[s]), color: tc.s2 }]);
  else destroyChart('chartSource');
}

/* ═══ 转正与合同 ═══ */
function renderOps(active, tc) {
  if (!pageVisible('ops')) return;
  const today = new Date(); today.setHours(0,0,0,0);
  const in90 = new Date(today.getTime() + 90 * 86400000);
  const trial = active.filter(d => d.empType === '试用期');
  const estProbEnd = d => { let p = toDate(d.probationEnd); if (!p) { const j = toDate(d.joinDate); if (j) p = new Date(j.getTime() + 183 * 86400000); } return p; };
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
     注意 probationEnd 有三分之一的人没填，缺的按 入职+183 天 估（和页面别处「试用届满(估)」同一口径）。 */
  const yearAgo = new Date(today.getFullYear()-1, today.getMonth(), today.getDate());
  const formalScope = formalOnly(active);
  const dueCohort = formalScope.filter(d => { const p = estProbEnd(d); return p && p >= yearAgo && p <= today; });
  const converts12 = dueCohort.filter(d => d.empType === '已转正').length;
  const due12 = dueCohort.length;
  const convRate = due12 > 0 ? (converts12 / due12 * 100) : null;

  document.getElementById('opsKpiRow').innerHTML =
    kpi('试用期内', trial.length, '当前试用期员工', '--type-probation', 'formal') +
    // 临期=警告→黄；逾期=不好→绿；转正率=好→红；无异常时回落为「好」红
    kpi('90 天内届满', due90.length, '需启动转正评估', '--warn', 'formal') +
    kpi('逾期未转正', overdue.length, '届满日已过仍在试用期', overdue.length ? '--neg' : '--pos', 'formal') +
    kpi('合同/协议 90 天内到期', expiring.length, `≤30天 ${t30.length} · 31-60 ${t60.length} · 61-90 ${t90.length}`, expiring.length ? '--warn' : '--pos', 'all') +
    kpi('近 12 月转正率', convRate != null ? convRate.toFixed(0) + '%' : '—', `${converts12} 人已转正 / ${due12} 人应届满`, '--pos', 'formal');

  // 到期紧急度 = 警告黄强度梯（越紧急越深）
  barChart('chartContractExpiry', ['≤30 天','31-60 天','61-90 天'],
    [{ label:'到期人数', data: [t30.length, t60.length, t90.length], color: ctx => [tc['expire-30'], tc['expire-60'], tc['expire-90']][ctx.dataIndex], borderRadius: 3 }]);

  const ctMap = countBy(active, 'contractType');
  const ctLabels = Object.keys(ctMap).filter(k => k !== '未知').sort((a,b) => ctMap[b]-ctMap[a]);
  if (ctLabels.length) doughnutChart('chartContractType', ctLabels, ctLabels.map(k => ctMap[k]),
    [tc.s1, tc.s2, tc.s3, tc.s4, tc.s5, tc.s6].slice(0, ctLabels.length));
  else destroyChart('chartContractType');

  // 和上面的转正率同一口径（正式员工、同一筛选范围）；「届满」用估算值，
  // 否则三分之一没填 probationEnd 的人在这张图上根本不会出现
  const months = getMonthsList(12);
  lineChart('chartConvertTrend', months, [
    { label:'实际转正', data: countByMonth(formalScope, 'confirmDate', months), color: tc.pos },
    { label:'试用届满', data: countByMonth(formalScope, estProbEnd, months), color: tc.s1 },
  ]);

  const pRows = due90.slice().sort((a,b) => estProbEnd(a) - estProbEnd(b));
  document.getElementById('probationTable').innerHTML =
    '<thead><tr><th>姓名</th><th>工号</th><th>部门</th><th>职等</th><th>入职日期</th><th>试用届满(估)</th><th>剩余天数</th></tr></thead><tbody>' +
    (pRows.length ? pRows.map(d => { const p = estProbEnd(d); return `<tr><td>${esc(d.name)}</td><td>${esc(d.id)}</td><td>${esc(getDeptLabel(d.deptEn||d.dept))}</td><td>${esc(d.level||'—')}</td><td>${esc(d.joinDate)}</td><td>${d.probationEnd ? esc(d.probationEnd) : esc(p.toISOString().slice(0,10))}${d.probationEnd ? '' : ' *'}</td><td>${daysBetween(today, p)} 天</td></tr>`; }).join('')
    : '<tr><td colspan="7" style="color:var(--ink-3)">90 天内无试用届满人员</td></tr>') + '</tbody>';

  const cRows = expiring.slice().sort((a,b) => toDate(a.contractEnd) - toDate(b.contractEnd));
  document.getElementById('contractTable').innerHTML =
    '<thead><tr><th>姓名</th><th>工号</th><th>部门</th><th>用工</th><th>合同类型</th><th>到期日期</th><th>剩余</th><th>分级</th></tr></thead><tbody>' +
    (cRows.length ? cRows.map(d => {
      const n = daysBetween(today, toDate(d.contractEnd));
      const tier = n <= 30 ? '<span class="tag tag-tier-1">紧急</span>'
        : n <= 60 ? '<span class="tag tag-tier-2">关注</span>'
        : '<span class="tag">观察</span>';
      return `<tr><td>${esc(d.name)}</td><td>${esc(d.id)}</td><td>${esc(getDeptLabel(d.deptEn||d.dept))}</td><td>${esc(d.empType)}</td><td>${esc(d.contractType)}</td><td>${esc(d.contractEnd)}</td><td>${n} 天</td><td>${tier}</td></tr>`;
    }).join('') : '<tr><td colspan="8" style="color:var(--ink-3)">90 天内无合同/协议到期</td></tr>') + '</tbody>';
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
      const shade = members.length === 0 ? 'opacity:.45' : members.length >= 15 ? 'background:var(--accent-soft);border-color:var(--accent)' : '';
      nb += `<div class="nb-cell" style="${shade}"><strong>${members.length}</strong><div class="nb-cap">人${members.length ? ' · ' + (active.length ? (members.length/active.length*100).toFixed(1) : 0) + '%' : ''}</div></div>`;
    });
  });
  document.getElementById('ninebox').innerHTML = nb;
  document.getElementById('nineboxNote').innerHTML =
    scopeNote('all', `纵轴=梯队（潜力） · 横轴=${latestLabel}绩效 · 盘点范围 ${perfActive.length} 人`);

  document.getElementById('tierCount').innerHTML = scopeNote('all', `覆盖 ${covered} 人`);
  if (tierLabels.length) barChart('chartTierType', tierLabels, [{ label:'人数', data: tierLabels.map(t => tierMap[t]), color: tierLabels.map((t,i) => [tc.s1, tc.s2, tc.s3][i]) }]);
  else destroyChart('chartTierType');

  if (latestKey) {
    const gradeMap = {};
    perfActive.forEach(d => { const g = cleanGrade(latestGrade(d.perf)); if (g) gradeMap[g] = (gradeMap[g]||0)+1; });
    const gl = GRADE_ORDER.filter(g => gradeMap[g]);
    document.getElementById('perfGradeNote').innerHTML = scopeNote('all', `${latestLabel} · ${perfActive.length} 人`);
    if (gl.length) doughnutChart('chartPerfGradeDist', gl, gl.map(g => gradeMap[g]), gl.map(g => tc['grade-' + (g==='S'?'sa':g.toLowerCase().replace('+','p').replace('-','m'))] || tc.s1));
    else destroyChart('chartPerfGradeDist');

    lineChart('chartPerfTrend', av.map(p => p[1]), [{ label:'平均分值', data: av.map(([k]) => {
      const vals = perfActive.map(d => gradeScore(d.perf[k])).filter(v => v != null);
      return vals.length ? +(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2) : null;
    }), color: tc.s1 }], { scales: { x: chartDefaults(tc).scales.x, y: { ...chartDefaults(tc).scales.y, min: 0, max: 5 } } });

    const bracketOrder = ['X<125%','125%≤X<135%','135%≤X<145%','X≥145%'];
    const brMap = {};
    perfActive.forEach(d => { const b = d.perf.inputBracket; if (b && bracketOrder.includes(b)) brMap[b] = (brMap[b]||0)+1; });
    const bl = bracketOrder.filter(b => brMap[b]);
    if (bl.length) barChart('chartInputCoeff', bl, [{ label:'人数', data: bl.map(b => brMap[b]),
      color: ctx => ctx.dataIndex === bl.length-1 ? tc.s1 : tc['ink-3'], borderRadius: 3 }]);
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
    : '<tr><td colspan="9" style="color:var(--ink-3)">未上传绩效数据或无匹配人员</td></tr>') + '</tbody>';
}

/* ═══ 职级健康度 ═══ */
function renderHealth(active, tc) {
  if (!pageVisible('health')) return;
  const sc = structureScope(active);
  const pop = sc.data;
  const isMgmt = d => /^M/i.test(d.level || '') || (d.mgmtLevel && String(d.mgmtLevel).trim() && String(d.mgmtLevel).trim() !== '/');
  const mgmt = pop.filter(isMgmt);
  const tech = pop.filter(d => /^T/.test(d.level || '') && !isMgmt(d));
  const other = pop.length - mgmt.length - tech.length;
  const levelMap = countBy(pop, 'level');
  const tLevels = sortLevels(Object.keys(levelMap).filter(k => /^T/.test(k)));
  document.getElementById('healthKpiRow').innerHTML =
    kpi('T 序列职级数', tLevels.length, '技术通道纵深', '--s5', sc.scope) +
    kpi('技术通道', tech.length, pop.length ? (tech.length/pop.length*100).toFixed(1) + '%' : '', '--s1', sc.scope) +
    kpi('管理通道', mgmt.length, pop.length ? (mgmt.length/pop.length*100).toFixed(1) + '% · 按管理通道职等判定' : '', '--s2', sc.scope) +
    kpi('专业/其他', Math.max(other, 0), 'P/S/L 序列及未分级', '--s3', sc.scope);
  if (tLevels.length) barChart('chartPyramid', tLevels, [{ label:'人数', data: tLevels.map(l => levelMap[l]), color: tc.s1 }]);
  else destroyChart('chartPyramid');
  barChart('chartChannel', ['技术通道','管理通道','专业/其他'], [{ label:'人数', data: [tech.length, mgmt.length, Math.max(other,0)], color: ctx => [tc.s1, tc.s2, tc.s3][ctx.dataIndex], borderRadius: 3 }]);
  const centers = [...new Set(pop.map(d => d.center).filter(Boolean))].sort();
  const allLevels = sortLevels([...new Set(pop.map(d => d.level).filter(Boolean))]);
  if (centers.length && allLevels.length) barChart('chartCenterLevel', allLevels, centers.map(c => ({
    label: c, data: allLevels.map(l => pop.filter(d => d.center === c && d.level === l).length) })), { stacked: true });
  else destroyChart('chartCenterLevel');
}

/* ═══ HR 工作台账 ═══ */
function renderLedger() {
  if (!pageVisible('ledger')) return;
  const el = document.getElementById('ledgerContent');
  if (!el) return;
  if (!ledgerData) {
    el.innerHTML = `<div class="ledger-hint">尚未加载台账文件<br><span style="font-size:11.5px">把汇总表（含台账 sheet）拖入窗口，或点击右上角「上传台账」——它将自动识别各业务 sheet</span><br><br><button class="tb-btn primary" onclick="uploadLedgerData()">选择台账文件</button></div>`;
    return;
  }
  const L = ledgerData;
  const act = rawData.filter(d => d.status === '在职');
  const kpaOut = act.filter(d => d.group === 'outsource' && (d.center === BU.code || !d.center)).length;
  let html = '';

  /* ① 抬头：公司口径总账 */
  if (L.summary) {
    const s = L.summary;
    const lvTxt = s.levelDist.map(x => `${x.level} ${x.count}`).join(' · ');
    html += `<div class="ledger-hero">
      <h2>本部门 · 人才现状总账 <span class="scope-note scope-all" style="font-size:10px">台账口径</span></h2>
      <p>${esc((s.notes || []).slice(0, 3).join('　|　'))}</p>
      <div class="brief-seg" style="margin:12px 0 0">
        <div class="bs-item"><div class="bs-label">在职总人数（正式）</div><div class="bs-val">${s.headcount != null ? s.headcount : '—'}</div><div class="bs-note">含试用期 ${s.probation != null ? s.probation : '—'} 人</div></div>
        <div class="bs-item"><div class="bs-label">实习生</div><div class="bs-val">${s.intern != null ? s.intern : '—'}</div><div class="bs-note">含签约 ${s.internPaid != null ? s.internPaid : '—'} 人</div></div>
        <div class="bs-item"><div class="bs-label">技术外协</div><div class="bs-val">${s.outsource != null ? s.outsource : '—'}</div><div class="bs-note">KPA 口径 ${kpaOut} 人</div></div>
        <div class="bs-item"><div class="bs-label">年度招聘</div><div class="bs-val">${s.done != null ? s.done : '—'}<span style="font-size:14px;color:var(--ink-3)">/${s.demand != null ? s.demand : '—'}</span></div><div class="bs-note">待招 ${s.pending != null ? s.pending : '—'} 人（含 ${s.pendingOutsource != null ? s.pendingOutsource : 0} 个外包）</div></div>
      </div>
      ${lvTxt ? `<div class="ri-meta" style="margin-top:10px">职等分布：${esc(lvTxt)}</div>` : ''}
    </div>`;
  } else {
    html += `<div class="ledger-hint">台账已加载，但未识别到「组织架构」汇总表</div>`;
  }

  html += '<div class="ledger-grid">';

  /* ② 招聘缺口 */
  if (L.recruitOpen.length) {
    const byDept = countBy(L.recruitOpen, 'dept');
    const depts = Object.keys(byDept).sort((a,b) => byDept[b]-byDept[a]);
    const total = L.recruitOpen.reduce((s,x) => s + x.count, 0);
    html += `<div class="ledger-card wide">
      <h3>招聘缺口看板<span class="count-pill">待招 ${total} 人</span></h3>
      <div class="chart-box" style="height:200px"><canvas id="chartRecruitDept"></canvas></div>
      <div style="overflow:auto;max-height:320px;margin-top:12px"><table class="mini-table" id="recruitTable">
        <thead><tr><th>部门</th><th>岗位</th><th>方向</th><th>需求</th><th>原因</th><th>影响项目</th><th>渠道</th></tr></thead>
        <tbody>${L.recruitOpen.map(x => `<tr><td>${esc(x.dept)}</td><td>${esc(x.position)}</td><td>${esc(x.direction)}</td><td>${x.count}</td><td class="wrap">${esc(x.reason)}</td><td class="wrap">${esc(x.project)}</td><td>${esc(x.channel)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  }

  /* ③ 末位改进跟踪 */
  if (L.bcPeople.length) {
    const activeBC = L.bcPeople.filter(p => !/已离职|已优化/.test(p.grades.join('') + p.progress));
    html += `<div class="ledger-card wide">
      <h3>末位（B-/C）人员改进跟踪<span class="count-pill">${L.bcPeople.length} 人 · 在跟踪 ${activeBC.length}</span></h3>
      <div style="overflow:auto;max-height:420px"><table class="mini-table">
        <thead><tr><th>工号</th><th>姓名</th><th>部门</th><th>职等</th><th>23H2</th><th>24H1</th><th>24H2</th><th>25H1</th><th>25H2</th><th>26H1</th><th>后续计划</th><th>把关结论</th><th>当前进展</th></tr></thead>
        <tbody>${L.bcPeople.map(p => `<tr>
          <td>${esc(p.id)}</td><td>${esc(p.name)}</td><td>${esc(p.dept)}</td><td>${esc(p.level)}${p.sub ? '/' + esc(p.sub) : ''}</td>
          ${p.grades.map(g => `<td>${gradeTag(g)}</td>`).join('')}
          <td class="wrap">${esc(p.plan)}</td><td class="wrap">${esc(p.conclusion)}</td><td class="wrap">${esc(p.progress)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  }

  /* ④ 储备干部池 */
  if (L.reserveCandidates.length) {
    html += `<div class="ledger-card">
      <h3>储备干部培养池<span class="count-pill">${L.reserveCandidates.length} 人</span></h3>
      <div class="row-list" style="max-height:420px;overflow:auto">
        ${L.reserveCandidates.map(p => `<div class="row-item">
          <div class="ri-head"><span class="ri-name">${esc(p.name)}</span>
            <span class="pill pill-blue">${esc(p.targetRole || '—')}</span>
            <span class="pill">${esc(p.level)}${p.sub ? '/' + esc(p.sub) : ''}</span>
            ${p.tier ? `<span class="pill pill-cyan">${esc(p.tier)}</span>` : ''}
          </div>
          <div class="ri-meta">${esc(p.position)} · ${esc(p.school)} ${esc(p.edu)} · 工龄 ${p.workYears} 年 · 司龄 ${p.tenure} 年</div>
          <div class="ri-note">近 6 期绩效（由近及远）：${esc(p.trend || p.grades.filter(Boolean).join(' '))}</div>
        </div>`).join('')}
      </div>
    </div>`;
  }

  /* ⑤ 高潜名单 */
  if (L.highPotential.length) {
    html += `<div class="ledger-card wide">
      <h3>高潜名单<span class="count-pill">${L.highPotential.length} 人</span></h3>
      <div style="overflow:auto;max-height:420px"><table class="mini-table">
        <thead><tr><th>序号</th><th>部门</th><th>姓名</th><th>职位</th><th>上级主管</th><th>入职日期</th><th>职等</th><th>25H2</th><th>25H1</th><th>最快晋升到 T3</th></tr></thead>
        <tbody>${L.highPotential.map(p => `<tr>
          <td>${p.seq}</td><td>${esc(p.dept)}</td><td>${esc(p.name)}</td><td>${esc(p.position)}</td><td>${esc(p.manager)}</td>
          <td>${esc(p.joinDate)}</td><td>${esc(p.level)}${p.sub ? '/' + esc(p.sub) : ''}</td>
          <td>${gradeTag(p.g25H2)}</td><td>${gradeTag(p.g25H1)}</td><td>${esc(p.promo || '—')}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  }

  /* ⑥ 外协 OD 台账 */
  if (L.outsource.active.length || L.outsource.left.length) {
    html += `<div class="ledger-card">
      <h3>外协 OD 台账<span class="count-pill">在岗 ${L.outsource.active.length} · 离岗 ${L.outsource.left.length}</span></h3>
      <div class="row-list" style="max-height:420px;overflow:auto">
        ${L.outsource.active.map(p => `<div class="row-item">
          <div class="ri-head"><span class="ri-name">${esc(p.name)}</span><span class="pill">${esc(p.dept)}</span><span class="pill pill-cyan">${esc(p.joinDate)}</span></div>
          <div class="ri-note">${esc(p.status)}</div>
        </div>`).join('')}
      </div>
      ${L.outsource.left.length ? `<div class="ri-meta" style="margin-top:8px">离岗：${L.outsource.left.map(p => esc(p.name) + '（' + esc(p.status || p.dept) + '）').join('、')}</div>` : ''}
    </div>`;
  }

  /* ⑦ 本年度入职 */
  if (L.onboard.length) {
    const stMap = countBy(L.onboard, 'status');
    html += `<div class="ledger-card">
      <h3>本年度社招入职<span class="count-pill">${L.onboard.length} 人</span></h3>
      <div class="ri-meta" style="margin-bottom:8px">${Object.keys(stMap).map(k => `<span class="pill" style="margin-right:4px">${esc(k)} ${stMap[k]}</span>`).join('')}</div>
      <div style="overflow:auto;max-height:360px"><table class="mini-table">
        <thead><tr><th>姓名</th><th>部门</th><th>职等</th><th>职位</th><th>入职日期</th><th>状态</th></tr></thead>
        <tbody>${L.onboard.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.dept)}</td><td>${esc(p.level)}${p.sub ? '/' + esc(p.sub) : ''}</td><td>${esc(p.position)}</td><td>${esc(p.joinDate)}</td><td>${esc(p.status)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  }

  /* ⑧ 27届校招需求 */
  if (L.campus27.length) {
    const total = L.campus27.reduce((s,x) => s + x.count, 0);
    html += `<div class="ledger-card">
      <h3>27 届校招需求<span class="count-pill">${total} 人 · ${L.campus27.length} 个方向</span></h3>
      <div style="overflow:auto;max-height:360px"><table class="mini-table">
        <thead><tr><th>部门</th><th>岗位</th><th>具体方向</th><th>人数</th><th>地域</th><th>配置原因</th></tr></thead>
        <tbody>${L.campus27.map(p => `<tr><td>${esc(p.dept)}</td><td>${esc(p.position)}</td><td class="wrap">${esc(p.detail || p.direction)}</td><td>${p.count}</td><td>${esc(p.location)}</td><td class="wrap">${esc(p.reason)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  }

  /* ⑨ 部门梯队 */
  if (L.deptTier.length) {
    html += `<div class="ledger-card">
      <h3>部门梯队分组</h3>
      <div style="overflow:auto;max-height:300px"><table class="mini-table">
        <tbody>${L.deptTier.map(r => `<tr>${r.map((c, i) => `<td${i === 0 ? ' style="color:var(--ink-3)"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  }

  html += '</div>';
  el.innerHTML = html;

  /* 图表需在 DOM 就绪后绘制 */
  if (L.recruitOpen.length) {
    const byDept = countBy(L.recruitOpen, 'dept');
    const depts = Object.keys(byDept).sort((a,b) => byDept[b]-byDept[a]);
    barChart('chartRecruitDept', depts, [{ label:'待招人数', data: depts.map(d => byDept[d]), color: tc2().s2 }]);
  }
}
function tc2() { return themeColors(); }

/* ═══ 编制缺口（手工数据源）═══
   数据来自 data/看板数据源.xlsx 的「部门编制」sheet。
   没填的话图会清空，KPI 卡也退回原来的「外包+劳务」—— 不报错、不留白框。 */
function renderBudgetGap() {
  const el = document.getElementById('chartBudgetGap');
  if (!el) return;
  const rows = (typeof dsData !== 'undefined' && dsData.budget ? dsData.budget : [])
    .filter(b => b.plan !== null && b.plan > 0)
    .map(b => {
      /* 已到位：优先用手工填的，没填就用 KPA 在职「正式员工」数兜底
         （编制是正式编制，不含实习与外协，口径与 dsBudgetSummary 保持一致） */
      const actual = b.actual !== null ? b.actual
        : (typeof rawData !== 'undefined'
            ? rawData.filter(d => d.status === '在职'
                && (typeof staffGroupOf !== 'function' || staffGroupOf(d) === 'formal')
                && (d.deptEn || d.dept) === b.dept).length
            : 0);
      return { ...b, actualCalc: actual, gap: b.gap !== null ? b.gap : (b.plan - actual) };
    });
  if (!rows.length) { destroyChart('chartBudgetGap'); return; }
  /* 按缺口从大到小，一眼看出哪个部门最缺人 */
  rows.sort((a, b) => b.gap - a.gap);
  const labels = rows.map(r => r.dept);
  const tc = themeColors();
  barChart('chartBudgetGap', labels, [
    { label:'已到位', data: rows.map(r => r.actualCalc), color: tc.s1, stack: 'x' },
    { label:'缺口',   data: rows.map(r => Math.max(0, r.gap)), color: tc.neg, stack: 'x' },
  ], { stacked: true });
}

/* ═══ 简报 ═══ */
function renderBrief(active, allActive, allLeavers, tc) {
  if (!pageVisible('brief')) return;
  document.getElementById('briefDate').textContent =
    new Date().toLocaleDateString('zh-CN', { year:'numeric', month:'long', day:'numeric' }) +
    (dataSavedAt ? ' · 数据快照 ' + dataSavedAt : '');
  const scopeData = getScopeData();
  const formalScope = formalOnly(scopeData);
  const rt = rollingTurnover(formalScope);
  const alerts = typeof generateAlerts === 'function' ? generateAlerts() : [];
  const joins12 = flowIn12(formalScope.filter(d => d.status === '在职'));
  const seg = segByGroup(active);
  document.getElementById('briefKpiRow').innerHTML =
    kpi('在职合计', active.length, '正式 + 实习 + 外协', '--s1', 'all') +
    kpi('滚动 12 月离职率', pctText(rt.rate), `${rt.leavers12} 人离职`, '--neg', 'formal') +
    kpi('近 12 月净增', (joins12 - rt.leavers12 >= 0 ? '+' : '') + (joins12 - rt.leavers12), `${joins12} 入 / ${rt.leavers12} 出`, '--pos', 'formal') +
    kpi('待办预警', alerts.length + ' 类', alerts.reduce((s,a) => s + a.count, 0) + ' 人涉及', alerts.length ? '--warn' : '--pos');
  document.getElementById('briefSeg').innerHTML =
    `<div class="bs-item"><div class="bs-label">正式员工</div><div class="bs-val">${seg.formal.length}</div><div class="bs-note">已转正 + 试用期</div></div>` +
    `<div class="bs-item"><div class="bs-label">实习生</div><div class="bs-val">${seg.intern.length}</div><div class="bs-note">签约 + 非签约</div></div>` +
    `<div class="bs-item"><div class="bs-label">外协 OD</div><div class="bs-val">${seg.outsource.length}</div><div class="bs-note">外包 + 劳务</div></div>`;
  document.getElementById('briefAlerts').innerHTML = '<h3>预警摘要</h3><ul>' +
    (alerts.length ? alerts.map(a => `<li><span class="mi">${a.icon}</span> <b>${esc(a.title)}</b> — ${esc(a.desc)}</li>`).join('') : '<li>当前无预警，各项人力资源指标正常。</li>') + '</ul>';
  const centers = [...new Set(active.map(d => d.center).filter(Boolean))].sort();
  barChart('chartBriefCenter', centers, [{ label:'在职', data: centers.map(c => active.filter(d => d.center === c).length), color: tc.s1 }]);
  const months = getMonthsList(12);
  lineChart('chartBriefTrend', months, [
    // 红入绿出：入职=好→红，离职=不好→绿（公司语义）
    { label:'入职', data: countByMonth(formalScope.filter(d => d.status==='在职'), 'joinDate', months), color: tc.pos },
    { label:'离职', data: countByMonth(formalScope.filter(d => d.status==='离职'), 'leaveDate', months), color: tc.neg },
  ]);
  const empTypeMap = countBy(active, 'empType');
  const tl = EMP_TYPES.filter(t => empTypeMap[t]);
  doughnutChart('chartBriefType', tl, tl.map(t => empTypeMap[t]), tl.map(t => tc[EMP_TYPE_COLORS[EMP_TYPES.indexOf(t)].slice(2)]));
  const tierMap2 = countBy(active.filter(d => d.talentPipeline), 'talentPipeline');
  const trl = ['领军梯队','干部梯队','人才梯队'].filter(t => tierMap2[t]);
  if (trl.length) doughnutChart('chartBriefTier', trl, trl.map(t => tierMap2[t]), [tc.s1, tc.s2, tc.s3]);
  else destroyChart('chartBriefTier');
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
  const dot = colorVar ? `<span class="kpi-dot" style="background:var(${colorVar})"></span>` : '';
  return `<div class="kpi-card clickable" onclick="jumpToDetail('${key}')" title="查看名单"><div class="kpi-label">${dot}${label}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub||''}</div></div>`;
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

  /* ── ② 部门结构（横向条形图，点击部门）── */
  const deptRows = {};
  active2.forEach(d => { const k = d.deptEn || d.dept; if (k) deptRows[k] = (deptRows[k] || 0) + 1; });
  const deptKeys = Object.keys(deptRows).sort((a, b) => deptRows[b] - deptRows[a]);
  document.getElementById('deptStructNote').innerHTML = scopeNote('all', `在职 ${active2.length} 人 · ${deptKeys.length} 个部门`);
  barChart('chartPeopleDept', deptKeys.map(getDeptLabel), [{
    label: '人数', data: deptKeys.map(k => deptRows[k]), color: tc.s1,
  }], {
    indexAxis: 'y',
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
  document.getElementById('orgTypeNote').innerHTML = scopeNote('all', `在职 ${active2.length} 人 · 按组织类型`);
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
  document.getElementById('levelStructNote').innerHTML = scopeNote('formal', `正式员工 ${formalActive.length} 人 · 序列 → 职等 → 子等级`);
  barChart('chartSeriesBar', chLabels, [{
    label: '人数', data: chLabels.map(k => channelCount[k]), color: tc.s2,
  }], {
    indexAxis: 'y',
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
    `<div class="kpi-card"><div class="kpi-label"><span class="kpi-dot" style="background:var(--s5)"></span>净增</div><div class="kpi-value" style="color:${netChange >= 0 ? 'var(--pos)' : 'var(--neg)'}">${netChange >= 0 ? '+' : ''}${netChange}</div><div class="kpi-sub">本月入职 − 本月离职</div></div>`;
  reg('change:join', '本月入职', d => inMonth(d, 'joinDate'));
  reg('change:leave', '本月离职', d => inMonth(d, 'leaveDate'));

  /* ── ③ 近 12 个月入离职趋势（全体人员，点击数据点）── */
  const months = getMonthsList(12);
  document.getElementById('trend12Note').innerHTML = scopeNote('all', '全体人员 · 按月 · 点击数据点查看名单');
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
    let p = toDate(d.probationEnd);
    if (!p) { const j = toDate(d.joinDate); if (!j) return false; p = new Date(j.getTime() + 183 * 86400000); }
    return p >= now && p <= in60;
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
      <span class="chart-note">${pop.length} 人 · 点击职等 / 子等级查看名单</span>
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
