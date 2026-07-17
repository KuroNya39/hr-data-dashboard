/* ═══════════════════════════════════════════════════════════════════════════
   hr-render.js — All 8 Page Rendering Functions
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── KPI CARDS ── */
function renderKpiCards(active, allActive, allLeavers) {
  const centerFilter = document.getElementById('filterCenter').value;
  const deptFilter = document.getElementById('filterDept').value;
  const total = active.length;
  const totalAll = allActive.length + allLeavers.length;
  let cards = '';

  if(centerFilter === 'all' && deptFilter === 'all') {
    const centers = [...new Set(active.map(d=>d.center).filter(Boolean))].sort();
    const now = new Date();
    const yearAgo = new Date(now.getFullYear()-1, now.getMonth(), now.getDate());
    const recentLeavers = allLeavers.filter(d=>d.leaveDate && new Date(d.leaveDate)>=yearAgo).length;
    const turnoverRate = totalAll>0 ? (recentLeavers/totalAll*100) : 0;
    const tenures = active.map(d=>calcTenure(d.joinDate)).filter(Boolean);
    const avgTenure = tenures.length>0 ? (tenures.reduce((a,b)=>a+b,0)/tenures.length) : 0;
    cards = kpi('在职总人数',total,`全部中心`,'s1');
    centers.forEach(c => {
      const cnt = active.filter(d=>d.center===c).length;
      cards += kpi(c,cnt,`占比 ${total>0?(cnt/total*100).toFixed(1):0}%`,'s1');
    });
    cards += kpi('12月滚动离职率',`${turnoverRate.toFixed(1)}%`,`${recentLeavers} 人离职`,'s8') +
      kpi('平均司龄',`${avgTenure.toFixed(1)}年`,`共 ${total} 名在职`,'s5');
  } else if(centerFilter !== 'all' && deptFilter === 'all') {
    const cnt = centerFilter;
    const cntCount = active.filter(d=>d.center===cnt).length;
    const now = new Date();
    const yearAgo = new Date(now.getFullYear()-1,now.getMonth(),now.getDate());
    const recentLeavers = allLeavers.filter(d=>d.center===cnt && d.leaveDate && new Date(d.leaveDate)>=yearAgo).length;
    const cntTotal = allActive.filter(d=>d.center===cnt).length + allLeavers.filter(d=>d.center===cnt).length;
    const turnoverRate = cntTotal>0 ? (recentLeavers/cntTotal*100) : 0;
    const tenures = active.map(d=>calcTenure(d.joinDate)).filter(Boolean);
    const avgTenure = tenures.length>0 ? (tenures.reduce((a,b)=>a+b,0)/tenures.length) : 0;
    const depts = [...new Set(active.filter(d=>d.center===cnt).map(d=>d.deptEn).filter(Boolean))].length;
    const levels = [...new Set(active.filter(d=>d.center===cnt).map(d=>d.level).filter(Boolean))].length;
    cards = kpi(`${cnt} 在职人数`,cntCount,`全中心`,'s1') +
      kpi('部门数',depts,`覆盖 ${cntCount} 人`,'s5') +
      kpi('职级数',levels,`含子等级`,'s4') +
      kpi('12月离职率',`${turnoverRate.toFixed(1)}%`,`${recentLeavers} 人离职`,'s8') +
      kpi('平均司龄',`${avgTenure.toFixed(1)}年`,`共 ${cntCount} 人`,'s5');
  } else if(deptFilter !== 'all') {
    const now = new Date();
    const yearAgo = new Date(now.getFullYear()-1,now.getMonth(),now.getDate());
    const recentLeavers = allLeavers.filter(d=>(d.deptEn||d.dept)===deptFilter && d.leaveDate && new Date(d.leaveDate)>=yearAgo).length;
    const deptTotal = allActive.filter(d=>(d.deptEn||d.dept)===deptFilter).length + allLeavers.filter(d=>(d.deptEn||d.dept)===deptFilter).length;
    const turnoverRate = deptTotal>0 ? (recentLeavers/deptTotal*100) : 0;
    const tenures = active.map(d=>calcTenure(d.joinDate)).filter(Boolean);
    const avgTenure = tenures.length>0 ? (tenures.reduce((a,b)=>a+b,0)/tenures.length) : 0;
    const levels = [...new Set(active.map(d=>d.level).filter(Boolean))].length;
    cards = kpi(`${deptFilter}`,total,`在职人数`,'s1') +
      kpi('职级覆盖',levels,`个职级`,'s4') +
      kpi('平均司龄',`${avgTenure.toFixed(1)}年`,'','s5') +
      kpi('离职率',`${turnoverRate.toFixed(1)}%`,`${recentLeavers} 人`,'s8');
  }
  document.getElementById('kpiRow').innerHTML = cards;
}

/* ── OVERVIEW ── */
function renderOverview(active, allActive, allLeavers, tc) {
  if(document.getElementById('page-overview').classList.contains('hidden')) return;
  const centerFilter = document.getElementById('filterCenter').value;

  // Headcount chart
  if(centerFilter !== 'all') {
    const cnt = centerFilter;
    const cntActive = active.filter(d=>d.center===cnt);
    const cntLeavers = allLeavers.filter(d=>d.center===cnt);
    const deptCount = countBy(cntActive, 'deptEn');
    const deptLeaverCount = countBy(cntLeavers, 'deptEn');
    const allDeptKeys = [...new Set([...Object.keys(deptCount),...Object.keys(deptLeaverCount)])].filter(Boolean).sort();
    document.getElementById('hcTitle').textContent = `部门编制分布 — ${cnt}`;
    document.getElementById('hcCount').textContent = `在职 ${cntActive.length} 人 · ${allDeptKeys.length} 个部门`;
    if(allDeptKeys.length) barChart('chartHeadcount', allDeptKeys, [
      {label:'在职', data:allDeptKeys.map(k=>deptCount[k]||0), color:tc.s1},
      {label:'已离职', data:allDeptKeys.map(k=>deptLeaverCount[k]||0), color:tc.s8},
    ]);
  } else {
    const centers = [...new Set(rawData.map(d=>d.center).filter(Boolean))].sort();
    const activeCounts = centers.map(c => active.filter(d=>d.center===c).length);
    const leaverCounts = centers.map(c => allLeavers.filter(d=>d.center===c).length);
    document.getElementById('hcTitle').textContent = '各中心编制分布';
    document.getElementById('hcCount').textContent = `在职 ${activeCounts.reduce((a,b)=>a+b,0)} 人 · ${centers.length} 个中心`;
    barChart('chartHeadcount', centers, [
      {label:'在职', data:activeCounts, color:tc.s1},
      {label:'已离职', data:leaverCounts, color:tc.s8},
    ]);
  }

  // ═══ FIX: Turnover trend now uses FILTERED data ═══
  const filteredRaw = getFiltered();
  const filteredActive = filteredRaw.filter(d => d.status === '在职');
  const filteredLeavers = filteredRaw.filter(d => d.status === '离职');
  const months = getMonthsList(rawData, 12);
  const joins = countByMonth(filteredActive, 'joinDate', months);
  const leaves = countByMonth(filteredLeavers, 'leaveDate', months);
  lineChart('chartTurnoverTrend', months, [
    {label:'入职', data:joins, color:tc.s5},
    {label:'离职', data:leaves, color:tc.s8},
  ]);

  // Employment type doughnut
  const empType = countBy(active, 'empType');
  const typeLabels = ['已转正','试用期','签约实习生','非签约实习生','外包人员'];
  const typeColors = [tc.typePerm, tc.typeProb, tc.typePaid, tc.typeUnpaid, tc.typeOut];
  const typeDataFiltered = typeLabels.map(l=>empType[l]||0).filter(v=>v>0);
  const typeLabelsFiltered = typeLabels.filter((_,i)=>typeDataFiltered[i]!==undefined).filter((_,i)=>typeDataFiltered[i]>0);
  const typeDataClean = typeDataFiltered.filter(v=>v>0);
  document.getElementById('typeCount').textContent = `${active.length} 人`;
  if(typeDataClean.length) doughnutChart('chartEmpType', typeLabelsFiltered, typeDataClean,
    typeColors.filter((_,i)=>typeDataFiltered[i]!==undefined).filter((_,i)=>typeDataFiltered[i]>0));
}

/* ── STRUCTURE ── */
function renderStructure(active, tc) {
  if(document.getElementById('page-structure').classList.contains('hidden')) return;
  const centers = [...new Set(active.map(d=>d.center).filter(Boolean))].sort();
  const deptCount = [...new Set(active.map(d=>d.dept).filter(Boolean))].length;
  const levelCnt = [...new Set(active.map(d=>d.level).filter(Boolean))].length;
  const seriesCount = [...new Set(active.map(d=>d.series).filter(Boolean))].length;
  document.getElementById('structureKpiRow').innerHTML =
    kpi('部门数',deptCount,`共 ${active.length} 人`,'s1') +
    kpi('职级数',levelCnt,`含子等级`,'s5') +
    kpi('岗位序列',seriesCount,`种序列`,'s4');

  const centerLevelCounts = {};
  centers.forEach(c => { centerLevelCounts[c] = countBy(active.filter(d=>d.center===c), 'level'); });
  const allLevels = sortBy([...new Set(active.map(d=>d.level).filter(Boolean))], LEVEL_ORDER);
  document.getElementById('levelCount').textContent = `${allLevels.length} 个职级`;
  if(centers.length) {
    const centerColors = [tc.s1, tc.s2, tc.s5, tc.s4, tc.s6, tc.s7];
    barChart('chartLevel', allLevels, centers.map((c,i) => ({
      label: c, data: allLevels.map(l => (centerLevelCounts[c]&&centerLevelCounts[c][l])||0),
      color: centerColors[i%centerColors.length],
    })));
  }

  const cross = countByTwo(active, 'level', 'subLevel');
  const levels = sortBy(Object.keys(cross).filter(k=>k!=='未知').filter(k=>LEVEL_ORDER.includes(k)), LEVEL_ORDER);
  const subLevels = [...new Set(active.map(d=>d.subLevel).filter(Boolean).filter(s=>s!=='/'))].sort();
  const subColors = [tc.s1, tc.s5, tc.s4, tc.s6, tc.s7];
  if(levels.length && subLevels.length) {
    barChart('chartLevelMatrix', levels, subLevels.map((sl,i)=>({
      label:sl, data:levels.map(l=>(cross[l]&&cross[l][sl])||0), color:subColors[i%subColors.length],
    })));
  } else { destroyChart('chartLevelMatrix'); }

  const deptCountMap = countBy(active, 'deptEn');
  const depts = Object.keys(deptCountMap).filter(Boolean);
  depts.sort((a,b)=>(deptCountMap[b]||0)-(deptCountMap[a]||0));
  const deptData2 = depts.map(d=>deptCountMap[d]);
  const deptColors = depts.map((_,i)=>[tc.s1,tc.s5,tc.s4,tc.s6,tc.s7,tc.s3,tc.s8,tc.s2][i%8]);
  if(depts.length) barChart('chartDept', depts.slice(0,15), [{label:'人数',data:deptData2.slice(0,15), color:(ctx)=>deptColors[ctx.dataIndex%deptColors.length]}]);

  const series = countBy(active, 'series');
  const seriesLabels = Object.keys(series).filter(Boolean).sort();
  if(seriesLabels.length) barChart('chartSeries', seriesLabels, [{label:'人数',data:seriesLabels.map(l=>series[l]), color:[tc.s1,tc.s4,tc.s5,tc.s6,tc.s7]}]);
}

/* ── DEMOGRAPHICS ── */
function renderDemographics(active, tc) {
  if(document.getElementById('page-demographics').classList.contains('hidden')) return;
  const ageBins = ['25岁以下','25-29','30-34','35-39','40-44','45岁以上'];
  const ageCounts = [0,0,0,0,0,0];
  const nowY = new Date().getFullYear();
  active.forEach(d=>{const y=parseInt(d.birthYear); if(!y)return; const age=nowY-y; if(age<25)ageCounts[0]++;else if(age<30)ageCounts[1]++;else if(age<35)ageCounts[2]++;else if(age<40)ageCounts[3]++;else if(age<45)ageCounts[4]++;else ageCounts[5]++;});
  barChart('chartAge', ageBins, [{label:'人数',data:ageCounts, color:tc.s6}]);

  const tenBins = ['<1年','1-3年','3-5年','5-8年','8-10年','10年+'];
  const tenCounts = [0,0,0,0,0,0];
  active.forEach(d=>{const t=calcTenure(d.joinDate); if(t<1)tenCounts[0]++;else if(t<3)tenCounts[1]++;else if(t<5)tenCounts[2]++;else if(t<8)tenCounts[3]++;else if(t<10)tenCounts[4]++;else tenCounts[5]++;});
  barChart('chartTenure', tenBins, [{label:'人数',data:tenCounts, color:tc.s5}]);

  const edu = countBy(active, 'edu');
  const eduOrder = ['博士','硕士','本科','大专'];
  const eduLabels = eduOrder.filter(k=>edu[k]);
  const eduData = eduLabels.map(k=>edu[k]);
  if(eduData.length) doughnutChart('chartEdu', eduLabels, eduData, [tc.s7,tc.s1,tc.s5,tc.s4].slice(0,eduData.length));

  const gen = countBy(active, 'gender');
  const genLabels = ['男','女'].filter(k=>gen[k]);
  const genData = genLabels.map(k=>gen[k]);
  if(genData.length) doughnutChart('chartGender', genLabels, genData, [tc.s1,tc.s3]);

  const eduGroups = eduOrder.filter(k=>edu[k]&&k!=='未知');
  const tenGroups = ['<1年','1-3年','3-5年','5-8年','8年+'];
  const eduTenureMap = {};
  eduGroups.forEach(e=>{eduTenureMap[e]=[0,0,0,0,0];});
  active.forEach(d=>{const e=d.edu; if(!e||!eduGroups.includes(e))return; const t=calcTenure(d.joinDate); let idx=0; if(t>=1&&t<3)idx=1;else if(t>=3&&t<5)idx=2;else if(t>=5&&t<8)idx=3;else if(t>=8)idx=4; if(eduTenureMap[e])eduTenureMap[e][idx]++;});
  if(eduGroups.length) barChart('chartTenureEdu', eduGroups, tenGroups.map((tg,i)=>({label:tg,data:eduGroups.map(e=>eduTenureMap[e]?eduTenureMap[e][i]:0), color:[tc.s5,tc.s1,tc.s4,tc.s6,tc.s7][i%5]})));
}

/* ── TURNOVER ── */
function renderTurnover(leavers, allActive, tc) {
  if(document.getElementById('page-turnover').classList.contains('hidden')) return;
  const centerFilter = document.getElementById('filterCenter').value;
  const deptFilter = document.getElementById('filterDept').value;

  let filteredLeavers = leavers;
  if(centerFilter !== 'all') filteredLeavers = filteredLeavers.filter(d => d.center === centerFilter);
  if(deptFilter !== 'all') filteredLeavers = filteredLeavers.filter(d => (d.deptEn||d.dept) === deptFilter);

  const relevantRaw = centerFilter!=='all'
    ? rawData.filter(d=>d.center===centerFilter)
    : (deptFilter!=='all' ? rawData.filter(d=>(d.deptEn||d.dept)===deptFilter) : rawData);
  const relevantActive = relevantRaw.filter(d=>d.status==='在职');
  const totalEver = relevantActive.length + filteredLeavers.length;
  const turnoverRate = totalEver>0 ? (filteredLeavers.length/totalEver*100) : 0;

  const now = new Date();
  const yearAgo = new Date(now.getFullYear()-1, now.getMonth(), now.getDate());
  const recent12 = filteredLeavers.filter(d=>d.leaveDate && new Date(d.leaveDate)>=yearAgo).length;
  const leaverTenures = filteredLeavers.map(d=>{if(!d.joinDate||!d.leaveDate)return 0; return (new Date(d.leaveDate)-new Date(d.joinDate))/(365.25*86400000);}).filter(t=>t>0);
  const avgLeaverTenure = leaverTenures.length>0 ? (leaverTenures.reduce((a,b)=>a+b,0)/leaverTenures.length) : 0;

  document.getElementById('turnoverKpiRow').innerHTML =
    kpi('累计离职',filteredLeavers.length,`历史总计`,'s8') +
    kpi('近12月离职',recent12,`${recent12} 人`,'s6') +
    kpi('离职率',`${turnoverRate.toFixed(1)}%`,`占全部 ${totalEver} 人`,'s8') +
    kpi('离职平均司龄',`${avgLeaverTenure.toFixed(1)}年`,`从入职到离职`,'s4');

  const byLevel = countBy(filteredLeavers, 'level');
  const lvLabels = sortBy(Object.keys(byLevel).filter(k=>k!=='未知'), LEVEL_ORDER);
  if(lvLabels.length) barChart('chartLeaverLevel', lvLabels, [{label:'离职人数',data:lvLabels.map(l=>byLevel[l]), color:tc.s8}]);
  else destroyChart('chartLeaverLevel');

  const ltBins = ['<3月','3-6月','6-12月','1-2年','2-5年','5年+'];
  const ltCounts = [0,0,0,0,0,0];
  filteredLeavers.forEach(d=>{if(!d.joinDate||!d.leaveDate)return; const m=(new Date(d.leaveDate)-new Date(d.joinDate))/(30*86400000); if(m<3)ltCounts[0]++;else if(m<6)ltCounts[1]++;else if(m<12)ltCounts[2]++;else if(m<24)ltCounts[3]++;else if(m<60)ltCounts[4]++;else ltCounts[5]++;});
  barChart('chartLeaverTenure', ltBins, [{label:'离职人数',data:ltCounts, color:tc.s6}]);

  const byType = countBy(filteredLeavers, 'empType');
  const typeLabels = ['已转正','试用期','签约实习生','非签约实习生','外包人员'];
  const typeColors = [tc.typePerm,tc.typeProb,tc.typePaid,tc.typeUnpaid,tc.typeOut];
  const typeData2 = typeLabels.map(l=>byType[l]||0).filter(v=>v>0);
  const typeLabels2 = typeLabels.filter((_,i)=>typeData2[i]!==undefined).filter((_,i)=>typeData2[i]>0);
  const typeColors2 = typeColors.filter((_,i)=>typeData2[i]!==undefined).filter((_,i)=>typeData2[i]>0);
  const typeDataClean2 = typeData2.filter(v=>v>0);
  if(typeDataClean2.length) barChart('chartLeaverType', typeLabels2, [{label:'离职人数',data:typeDataClean2, color:(ctx)=>typeColors2[ctx.dataIndex%typeColors2.length]}]);
  else destroyChart('chartLeaverType');

  const src = countBy(filteredLeavers, 'source');
  const srcLabels = Object.keys(src).filter(Boolean);
  if(srcLabels.length) barChart('chartSource', srcLabels, [{label:'人数',data:srcLabels.map(l=>src[l]), color:tc.s4}]);
  else destroyChart('chartSource');
}

/* ── PERFORMANCE ── */
function getPerfGradeField() { return document.getElementById('perfPeriod').value; }

function onPerfPeriodChange() {
  if(document.getElementById('page-performance').classList.contains('hidden')) return;
  const filtered = getFiltered();
  const active = filtered.filter(d=>d.status==='在职');
  const tc = getThemeColors();
  renderPerfKpiAndCharts(active, tc);
}

function renderPerformance(active, tc) {
  if(document.getElementById('page-performance').classList.contains('hidden')) return;
  renderPerfKpiAndCharts(active, tc);
}

function renderPerfKpiAndCharts(active, tc) {
  const perfActive = active.filter(d=>d.hasPerf);
  const periodField = getPerfGradeField();
  const periodLabel = PERIOD_KEYS[periodField] || '终评';

  const totalPerf = perfActive.length;
  const grades = perfActive.map(d => {
    const v = d[`perf${periodField.charAt(0).toUpperCase()+periodField.slice(1)}`] || d[periodField];
    return v ? v.toString().trim() : '';
  }).filter(Boolean);
  const gradeDist = {};
  grades.forEach(g => { const clean=g.replace(/[^A-Za-z+\-]/g,''); if(clean) gradeDist[clean]=(gradeDist[clean]||0)+1; });
  const avgGrade = grades.length>0 ? (grades.reduce((s,g)=>{const n=GRADE_NUM[g.replace(/[^A-Za-z+\-]/g,'')]; return s+(n!==undefined?n:0);},0)/grades.length) : 0;
  const changed = perfActive.filter(d=>d.perfGradeChange&&d.perfGradeChange.includes('变')).length;
  const upCount = perfActive.filter(d=>d.perfGradeChange&&d.perfGradeChange.includes('升')).length;
  const downCount = perfActive.filter(d=>d.perfGradeChange&&d.perfGradeChange.includes('降')).length;
  const topGrade = Object.keys(gradeDist).filter(g=>gradeDist[g]>0)
    .sort((a,b)=>(GRADE_NUM[b]||0)-(GRADE_NUM[a]||0))[0]||'—';

  document.getElementById('perfKpiRow').innerHTML =
    kpi('绩效覆盖人数',totalPerf,`${active.length} 名在职中的 ${totalPerf} 人`,'grade-a') +
    kpi('平均绩效等级',avgGrade>0?avgGrade.toFixed(2):'—','SA=5 A=4 B+=3.5 B=3','grade-sa') +
    kpi('绩效变动',`${upCount+downCount} 人`,`↑${upCount} 升 · ↓${downCount} 降`,'s4') +
    kpi('最高绩效',topGrade,`占比最高的等级`,'s1');

  document.getElementById('perfGradeTitle').textContent = `${periodLabel}绩效等级分布`;
  document.getElementById('perfGradeCount').textContent = `${grades.length} 人`;
  const gradeOrder = ['SA','A','B+','B','B-','C','D'];
  const gl = gradeOrder.filter(g=>gradeDist[g]);
  const gd = gl.map(g=>gradeDist[g]);
  const gc = gl.map(g=>getGradeColor(g,tc));
  if(gd.length) doughnutChart('chartPerfGradeDist', gl, gd, gc);
  else destroyChart('chartPerfGradeDist');

  // Performance × Level matrix
  const perfLevelCross = {};
  perfActive.forEach(d => {
    const lv = d.level||'未知';
    const gr = (d.perfFinalGrade||'').replace(/[^A-Za-z+\-]/g,'')||'未知';
    if(!perfLevelCross[lv]) perfLevelCross[lv]={};
    perfLevelCross[lv][gr]=(perfLevelCross[lv][gr]||0)+1;
  });
  const perfLevels = sortBy(Object.keys(perfLevelCross).filter(k=>k!=='未知'), LEVEL_ORDER);
  const perfGradeHeaders = gradeOrder.filter(g => Object.values(perfLevelCross).some(m=>m[g]));
  if(perfLevels.length && perfGradeHeaders.length) {
    const pgColors = perfGradeHeaders.map(g=>getGradeColor(g,tc));
    barChart('chartPerfLevelMatrix', perfLevels, perfGradeHeaders.map((g,i)=>({label:g,data:perfLevels.map(l=>(perfLevelCross[l]&&perfLevelCross[l][g])||0), color:pgColors[i%pgColors.length]})));
  } else destroyChart('chartPerfLevelMatrix');

  // Input coefficient
  const bracketOrder = ['X<125%','125%≤X<135%','135%≤X<145%','X≥145%'];
  const bracketMap = {};
  perfActive.forEach(d=>{const b=d.perfInputBracket; if(b&&bracketOrder.includes(b)) bracketMap[b]=(bracketMap[b]||0)+1;});
  const bracketLabels = bracketOrder.filter(b=>bracketMap[b]);
  const bracketData = bracketLabels.map(b=>bracketMap[b]);
  if(bracketLabels.length) barChart('chartInputCoeff', bracketLabels, [{label:'人数',data:bracketData, color:(ctx)=>[tc.s6,tc.s4,tc.s1,tc.s2][ctx.dataIndex%4]}]);
  else destroyChart('chartInputCoeff');

  // Performance change
  const changeData = [upCount, downCount, perfActive.length-upCount-downCount];
  barChart('chartPerfChange', ['晋升','降级','持平'], [{label:'人数',data:changeData, color:(ctx)=>[tc.s2,tc.s8,tc.s7][ctx.dataIndex%3]}]);

  // Historical trend
  const histLabels = ['2024中','2024终','2025中','2025终','2026H1'];
  const histKeys = ['grade2024M','grade2024Y','grade2025M','grade2025Y','finalGrade'];
  const avgByPeriod = histKeys.map(key => {
    const vals = perfActive.map(d => {
      const pf = d['perf'+key.charAt(0).toUpperCase()+key.slice(1)];
      const g = (pf||'').replace(/[^A-Za-z+\-]/g,'');
      return GRADE_NUM[g]!==undefined ? GRADE_NUM[g] : null;
    }).filter(v=>v!==null);
    return vals.length>0 ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
  });
  lineChart('chartPerfTrend', histLabels, [{label:'平均绩效(分值)', data:avgByPeriod, color:tc.s1}], {
    scales: { y: { ...CHART_DEFAULTS.scales.y, min:0, max:5, beginAtZero:false } },
  });
}

/* ── EMPLOYMENT ── */
function renderEmployment(active, tc) {
  if(document.getElementById('page-employment').classList.contains('hidden')) return;
  const empType = countBy(active, 'empType');
  const types = ['已转正','试用期','签约实习生','非签约实习生','外包人员'];
  const typeColors = [tc.typePerm,tc.typeProb,tc.typePaid,tc.typeUnpaid,tc.typeOut];
  const perm = empType['已转正']||0; const trial = empType['试用期']||0;
  const intern = (empType['签约实习生']||0)+(empType['非签约实习生']||0);
  const outsource = empType['外包人员']||0;
  document.getElementById('empKpiRow').innerHTML =
    kpi('已转正',perm,`${active.length>0?(perm/active.length*100).toFixed(1):0}%`,'s1') +
    kpi('试用期',trial,`${active.length>0?(trial/active.length*100).toFixed(1):0}%`,'s4') +
    kpi('实习生',intern,`签约+非签约`,'s5') +
    kpi('外包人员',outsource,`${active.length>0?(outsource/active.length*100).toFixed(1):0}%`,'s6');

  const centers = [...new Set(active.map(d=>d.center).filter(Boolean))].sort();
  const centerTypeMap = {};
  centers.forEach(c => { centerTypeMap[c] = countBy(active.filter(d=>d.center===c), 'empType'); });
  const typeLabels = types.filter(t => centers.some(c => centerTypeMap[c][t]));
  if(typeLabels.length) {
    const centerColors = [tc.s1, tc.s2, tc.s5, tc.s6];
    barChart('chartEmpTypeByCenter', typeLabels, centers.map((c,i)=>({
      label:c, data:typeLabels.map(l=>centerTypeMap[c][l]||0), color:centerColors[i%centerColors.length],
    })));
  }

  const crossEL = countByTwo(active, 'empType', 'level');
  const empTypeLabels = types.filter(t=>crossEL[t]&&Object.keys(crossEL[t]).length);
  const allLevels2 = sortBy([...new Set(active.map(d=>d.level).filter(Boolean))], LEVEL_ORDER);
  if(empTypeLabels.length && allLevels2.length) barChart('chartEmpTypeLevel', allLevels2, empTypeLabels.map((t,i)=>({label:t, data:allLevels2.map(l=>(crossEL[t]&&crossEL[t][l])||0), color:typeColors[i%typeColors.length]})));

  const org = countBy(active, 'orgType');
  const orgLabels = Object.keys(org).filter(Boolean);
  if(orgLabels.length) barChart('chartOrgType', orgLabels, [{label:'人数',data:orgLabels.map(l=>org[l]), color:(ctx)=>[tc.s1,tc.s5,tc.s4,tc.s6][ctx.dataIndex%4]}]);
  else destroyChart('chartOrgType');
}

/* ── TALENT DEVELOPMENT ── */
function renderTalent(active, tc) {
  if(document.getElementById('page-talent').classList.contains('hidden')) return;
  const perfActive = active.filter(d=>d.hasPerf);
  const highPerf = perfActive.filter(d=>{
    const g = (d.perfFinalGrade||'').replace(/[^A-Za-z+\-]/g,'');
    return g === 'SA' || g === 'S' || g === 'A';
  });
  const highPerfCount = highPerf.length;
  const talentCount = active.filter(d=>d.talentPipeline).length;
  const highTenureRisk = active.filter(d=>{
    const t = calcTenure(d.joinDate);
    return t > 3 && t < 5;
  }).length;

  document.getElementById('talentKpiRow').innerHTML =
    kpi('高绩效人才(SA/A)',highPerfCount,`占绩效人数的 ${perfActive.length>0?(highPerfCount/perfActive.length*100).toFixed(1):0}%`,'grade-sa') +
    kpi('梯队后备人才',talentCount,`${active.length>0?(talentCount/active.length*100).toFixed(1):0}% 覆盖率`,'s1') +
    kpi('司龄3-5年人数',highTenureRisk,`留存关注人群`,'s4');

  const levelCount = countBy(active, 'level');
  const levels = sortBy(Object.keys(levelCount).filter(k=>k!=='未知'), LEVEL_ORDER);
  if(levels.length) {
    const levelColors = levels.map((l,i) => {
      if(l.startsWith('T')) return [tc.s1, tc.s5, tc.s4, tc.s6, tc.s7, tc.s3, tc.s2][parseInt(l.slice(1))%7||0];
      if(l.startsWith('M')) return tc.s8;
      if(l.startsWith('P')) return tc.s2;
      return tc.s1;
    });
    barChart('chartPromoChannel', levels, [{label:'人数',data:levels.map(l=>levelCount[l]), color:(ctx)=>levelColors[ctx.dataIndex%levelColors.length]}]);
  }

  const hpByDept = countBy(highPerf, 'deptEn');
  const hpDepts = Object.keys(hpByDept).filter(Boolean).sort();
  if(hpDepts.length) barChart('chartHighPerf', hpDepts, [{label:'高绩效人数',data:hpDepts.map(d=>hpByDept[d]), color:tc.gradeSa}]);

  const tier = countBy(active, 'talentPipeline');
  const tierLabels = Object.keys(tier).filter(Boolean);
  if(tierLabels.length) {
    const tierColors = [tc.s1, tc.gradeSa, tc.s4, tc.s6, tc.s7];
    barChart('chartTierType', tierLabels, [{label:'人数',data:tierLabels.map(t=>tier[t]), color:(ctx)=>tierColors[ctx.dataIndex%tierColors.length]}]);
  } else destroyChart('chartTierType');

  const riskBins = ['<1年','1-3年','3-5年','5-8年','8年+'];
  const highPerfByTenure = [0,0,0,0,0];
  const allByTenure = [0,0,0,0,0];
  active.forEach(d=>{
    const t = calcTenure(d.joinDate);
    let idx = 0; if(t>=1&&t<3) idx=1; else if(t>=3&&t<5) idx=2; else if(t>=5&&t<8) idx=3; else if(t>=8) idx=4;
    allByTenure[idx]++;
    if(highPerf.includes(d)) highPerfByTenure[idx]++;
  });
  barChart('chartRetentionRisk', riskBins, [
    {label:'总人数', data:allByTenure, color:tc.s1},
    {label:'高绩效(SA/A)', data:highPerfByTenure, color:tc.gradeSa},
  ]);
}

/* ── TITLE HEALTH ── */
function renderHealth(active, tc) {
  if(document.getElementById('page-health').classList.contains('hidden')) return;
  const tSeries = active.filter(d=>d.series&&d.series.includes('技术')).length;
  const mSeries = active.filter(d=>d.series&&(d.series.includes('管理'))).length;
  const pSeries = active.filter(d=>d.series&&(d.series.includes('专业')||d.series.includes('营销')||d.series.includes('产品')||d.series.includes('设计')||d.series.includes('职能'))).length;
  const centers = [...new Set(active.map(d=>d.center).filter(Boolean))].sort();
  const levelCount = [...new Set(active.map(d=>d.level).filter(Boolean))].length;
  const levelDist = countBy(active, 'level');

  document.getElementById('healthKpiRow').innerHTML =
    kpi('职级数',levelCount,`T/P/M 序列`,'s1') +
    kpi('技术通道',tSeries,`${active.length>0?(tSeries/active.length*100).toFixed(1):0}%`,'s1') +
    kpi('管理通道',mSeries,`${active.length>0?(mSeries/active.length*100).toFixed(1):0}%`,'s8') +
    kpi('专业/营销/职能',pSeries,`${active.length>0?(pSeries/active.length*100).toFixed(1):0}%`,'s5');

  const techPLevels = sortBy(Object.keys(levelDist).filter(k=>k!=='未知'&&(k.startsWith('T')||k.startsWith('P'))), LEVEL_ORDER);
  if(techPLevels.length) {
    barChart('chartPyramid', techPLevels, [{label:'人数',data:techPLevels.map(l=>levelDist[l]), color:(ctx)=>[tc.s1,tc.s5,tc.s4,tc.s6][ctx.dataIndex%4]}]);
  } else destroyChart('chartPyramid');

  const channelLabels = ['技术', '管理', '专业/营销/职能'];
  const channelData = [tSeries, mSeries, pSeries];
  barChart('chartChannel', channelLabels, [{label:'人数',data:channelData, color:(ctx)=>[tc.s1,tc.s8,tc.s5][ctx.dataIndex%3]}]);

  const centerLevelDist = {};
  centers.forEach(c => { centerLevelDist[c] = countBy(active.filter(d=>d.center===c), 'level'); });
  const allLev = sortBy([...new Set(active.map(d=>d.level).filter(Boolean))], LEVEL_ORDER);
  if(centers.length && allLev.length) {
    const centerColors = [tc.s1, tc.s2, tc.s5, tc.s6];
    barChart('chartCenterLevel', allLev, centers.map((c,i)=>({
      label:c, data:allLev.map(l=>(centerLevelDist[c]&&centerLevelDist[c][l])||0), color:centerColors[i%centerColors.length],
    })));
  } else destroyChart('chartCenterLevel');
}
