/* ═══════════════════════════════════════════════════════════════
   v8 alerts.js — 8 条预警规则（动态绩效周期 · 遵循筛选器 · 标注人群口径）
   ═══════════════════════════════════════════════════════════════ */

/* 严重度档位：红（critical）→ 黄（warning）→ 蓝（info）。模块级常量，
   不在每次 renderAlerts() 里重建一份 */
const TYPE_ORDER = { critical: 0, warning: 1, info: 2 };

let dismissedAlertTitles = new Set();
/* 清空/关闭要跨会话记住（用户反馈「每次打开都弹」），但换数据后作废——
   stamp = 人数 + 数据包保存时间，数据一变提醒就回来（新的人进了 80-105 天窗口） */
let alertDismissHydrated = false;
function alertDataStamp() {
  const n = (typeof rawData !== 'undefined' && rawData) ? rawData.length : 0;
  const t = (typeof dataSavedAt !== 'undefined' && dataSavedAt) ? dataSavedAt : '';
  return n + ':' + t;
}
function hydrateAlertDismissed() {
  if (alertDismissHydrated) return;
  alertDismissHydrated = true;
  try {
    const raw = JSON.parse(localStorage.getItem('hrAlertDismissed') || 'null');
    if (raw && raw.stamp === alertDataStamp() && Array.isArray(raw.titles)) dismissedAlertTitles = new Set(raw.titles);
  } catch (e) { /* localStorage 不可用就退回会话级 */ }
}
function persistAlertDismissed() {
  try { localStorage.setItem('hrAlertDismissed', JSON.stringify({ stamp: alertDataStamp(), titles: [...dismissedAlertTitles] })); } catch (e) {}
}
let activeAlertFilter = null;
let activeAlertTitle = null;

function clearAlertFilter() {
  resetEmpOrder();   // 预警筛选清除=新的一局，叠序回默认
  activeAlertFilter = null; activeAlertTitle = null;
  if (!document.getElementById('page-employee').classList.contains('hidden')) renderEmployeeTable();
}

/* ── 通用跳转筛选：人员概览 / 预警 共用 ──
   看板页注册一个 key → 筛选条件，点击卡片/图表 → jumpToDetail(key) → 人员明细自动带筛选。
   key 必须先在 DETAIL_FILTERS 里注册；没注册的直接不跳（空跳会让用户以为点了没反应）。 */
const DETAIL_FILTERS = {};
function registerDetailFilter(key, title, filter) { DETAIL_FILTERS[key] = { title, filter }; }
function jumpToDetail(key) {
  const f = DETAIL_FILTERS[key];
  if (!f) return;
  resetEmpOrder();   // 跳转=新的一局，明细表进默认顺序
  activeAlertFilter = f.filter;
  activeAlertTitle = f.title;
  switchPage('employee');
}

function generateAlerts() {
  const alerts = [];
  const now = new Date(); now.setHours(0,0,0,0);
  const base = getFiltered();
  const active = base.filter(d => d.status === '在职');
  /* 全部 8 条预警口径统一跟顶栏「人群」下拉（2026-10-14 拍板）：人口一律 active。
     试用期两条（2/3）保留 empType==='试用期' 的闸门——试用期只存在于正式员工，
     筛「实习生/外协」时这两条自然为 0，无需特判 */
  const nd = title => !dismissedAlertTitles.has(title);
  const push = a => { if (a.count > 0 && nd(a.title)) alerts.push(a); };
  /* 名单 → 筛选器：编号后在 Set 里查 O(1)。直接用 arr.includes(d) 是 O(人数×名单)，
     而每个 filter 会被 getFiltered() 对每一行调用一次 */
  const hit = arr => { const s = new Set(arr); return d => s.has(d); };

  /* 1. 新员工访谈（80–105 天）— 全员（含实习生） */
  const interview = active.filter(d => {
    const j = toDate(d.joinDate); if (!j) return false;
    const days = (now - j) / 86400000;
    return days >= 80 && days <= 105;
  });
  push({ type:'info', icon:'support_agent', title:'新员工入职访谈提醒（80–105天）',
    desc:`${interview.length} 名员工入职约 3 个月，建议安排新员工/导师访谈`,
    count: interview.length, page:'employee', filter: hit(interview) });

  /* 2. 转正到期提醒（试用届满前 30 天）— 正式员工
     取数与 ops 页转正日历同口径：预定转正日优先（probEndPlanOf），不估算 */
  const in30 = new Date(now.getTime() + 30 * 86400000);
  const probationDue = active.filter(d => {
    if (d.empType !== '试用期') return false;
    const p = probEndPlanOf(d);
    return p && p >= now && p <= in30;
  });
  push({ type:'warning', icon:'schedule', title:'试用期届满提醒（30 天内）',
    desc:`${probationDue.length} 名试用期员工即将届满，请及时启动转正评估`,
    count: probationDue.length, page:'employee', filter: hit(probationDue) });

  /* 3. 逾期未转正 — 正式员工（同口径：预定转正日优先） */
  const overdue = active.filter(d => {
    if (d.empType !== '试用期') return false;
    const p = probEndPlanOf(d);
    return p && p < now;
  });
  push({ type:'critical', icon:'error', title:'逾期未转正',
    desc:`${overdue.length} 名员工试用届满日已过但状态仍为试用期，请核实流程状态`,
    count: overdue.length, page:'employee', filter: hit(overdue) });

  /* 4. 合同 / 协议到期（30/60/90 天分级）— 全员 */
  const in90 = new Date(now.getTime() + 90 * 86400000);
  const expiringTypes = ['固定期限劳动合同','实习协议','外包服务协议','劳务合同'];
  const expiring = active.filter(d => expiringTypes.includes(d.contractType) && (() => { const c = toDate(d.contractEnd); return c && c >= now && c <= in90; })());
  const e30 = expiring.filter(d => daysBetween(now, toDate(d.contractEnd)) <= 30).length;
  const e60 = expiring.filter(d => { const n = daysBetween(now, toDate(d.contractEnd)); return n > 30 && n <= 60; }).length;
  const e90 = expiring.filter(d => { const n = daysBetween(now, toDate(d.contractEnd)); return n > 60 && n <= 90; }).length;
  push({ type: e30 > 0 ? 'critical' : 'warning', icon:'description', title:'合同/协议到期预警（90 天内）',
    desc:`共 ${expiring.length} 份到期：30 天内 ${e30} · 31-60 天 ${e60} · 61-90 天 ${e90}（含固定期限合同、实习协议、外包协议、劳务合同）`,
    count: expiring.length, page:'employee', filter: hit(expiring) });

  /* 5. 连续 3 次 B 及以下（动态最新 3 期）— 口径 = 顶栏「人群」下拉
     2026-10-14 拍板：绩效三条不再写死正式员工；d.hasPerf 已经是天然闸门，
     没有绩效记录的实习/外协本来就进不来，所以放开是安全的 */
  const av = availablePeriods();
  if (av.length >= 3) {
    const last3 = av.slice(-3).map(p => p[0]);
    const conB = active.filter(d => {
      if (!d.hasPerf) return false;
      const scores = last3.map(k => gradeScore(d.perf[k]));
      return scores.every(s => s != null && s <= GRADE_NUM['B']);
    });
    push({ type:'critical', icon:'trending_down', title:'连续 3 次 B 级及以下绩效',
      desc:`${conB.length} 名员工在最近 3 期（${av.slice(-3).map(p=>p[1]).join('→')}）均为 B 及以下，建议制定改进计划`,
      count: conB.length, page:'employee', filter: hit(conB) });
  }

  /* 6. 绩效连续下降（动态最新 4 期）— 口径 = 顶栏「人群」下拉 */
  if (av.length >= 4) {
    const last4 = av.slice(-4).map(p => p[0]);
    const declining = active.filter(d => {
      if (!d.hasPerf) return false;
      const scores = last4.map(k => gradeScore(d.perf[k]));
      if (scores.some(s => s == null)) return false;
      return scores.every((s, i) => i === 0 || s < scores[i-1]);
    });
    push({ type:'warning', icon:'arrow_downward', title:'绩效连续下降',
      desc:`${declining.length} 名员工绩效在 ${av.slice(-4).map(p=>p[1]).join('→')} 持续下降，需关注辅导`,
      count: declining.length, page:'employee', filter: hit(declining) });
  }

  /* 7. 高绩效 + 长司龄 + 低职级 — 口径 = 顶栏「人群」下拉 */
  const highRisk = active.filter(d => {
    if (!d.hasPerf) return false;
    if (!['SA','S','A'].includes(cleanGrade(latestGrade(d.perf)))) return false;
    if (calcTenure(d.joinDate) <= 5) return false;
    const m = (d.level || '').match(/^T(\d+)$/i);
    return m ? +m[1] < 3 : false;
  });
  push({ type:'warning', icon:'star', title:'高绩效人才流失风险',
    desc:`${highRisk.length} 名高绩效员工（S/A）司龄超 5 年但职级在 T3 以下，需关注晋升发展`,
    count: highRisk.length, page:'employee', filter: hit(highRisk) });

  /* 第 8 条「外协/劳务长期在岗」已删（2026-10-14 拍板）：恒真型常驻提醒，
     数字长期不变，挂在条上只是噪音。外协在岗结构请看人员概览/外包管理页 */

  return alerts;
}


let alertsExpanded = false;   // 折叠态：默认只展开前 3 条（2026-10-14 拍板）
const ALERT_COLLAPSE_N = 3;
function alertsToggleExpand() { alertsExpanded = !alertsExpanded; renderAlerts(); }

function renderAlerts() {
  const container = document.getElementById('alertBar');
  if (!container) return;
  hydrateAlertDismissed();
  const alerts = generateAlerts();
  /* 提醒条只在总览页显示（用户拍板）：#alertBar 就放在 #page-overview 里，
     靠 .page.hidden 自动隐藏，这里不用再认页面 id */
  if (!alerts.length) { container.innerHTML = ''; container.style.display = 'none'; return; }
  /* 严重度排序：红(critical) → 黄(warning) → 蓝(info)，最重要的永远在最上面 */
  alerts.sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9));
  container.style.display = 'flex';
  /* 徽标动态跟顶栏人群（全部条目同口径，共用一个标签，不必每条各挂一份）。
     文案走 core.js 的 scopeNote/scopeLabelOf，别在这里另写一套人群→标签映射 */
  const scope = scopeOfFilter();
  const head =
    `<div class="alert-head"><span class="alert-head-title"><span class="mi">notifications</span>提醒 ${alerts.length} 项</span>` +
    `<button class="alert-goto" onclick="clearAllAlerts()" aria-label="本份数据内不再提示（换数据后提醒会恢复）">一键清空</button></div>`;
  const items = alerts.map((a, i) => {
    const collapsed = !alertsExpanded && i >= ALERT_COLLAPSE_N;
    return `
    <div class="alert-item alert-${a.type}${collapsed ? ' alert-extra' : ''}">
      <span class="alert-icon"><span class="mi">${a.icon}</span></span>
      <div class="alert-body">
        <div class="alert-title">${esc(a.title)}<span class="alert-count">${a.count} 人</span>${scopeNote(scope, '', scopeLabelOf())}</div>
        <div class="alert-desc">${esc(a.desc)}</div>
      </div>
      <div class="alert-actions">
        <button class="alert-goto mi-btn" onclick="gotoAlertFilter('${a.page}','${esc(a.title).replace(/'/g, '&#39;')}')">查看</button>
        <button class="alert-close" aria-label="本次会话不再提示" onclick="dismissAlert(this,'${esc(a.title).replace(/'/g, '&#39;')}')"><span class="mi">close</span></button>
      </div>
    </div>`;
  }).join('');
  const hiddenN = alerts.length - ALERT_COLLAPSE_N;
  const toggle = hiddenN > 0
    ? `<button class="alert-toggle" onclick="alertsToggleExpand()" aria-expanded="${alertsExpanded}">` +
      `<span class="mi">${alertsExpanded ? 'expand_less' : 'expand_more'}</span>${alertsExpanded ? '收起' : '还有 ' + hiddenN + ' 条提醒'}</button>`
    : '';
  container.innerHTML = head + items + toggle;
}

function gotoAlertFilter(page, title) {
  const alert = generateAlerts().find(a => a.title === title);
  if (alert && alert.filter) {
    resetEmpOrder();   // 跳转=新的一局，明细表进默认顺序
    activeAlertFilter = alert.filter; activeAlertTitle = title;
  }
  switchPage(page);
}
function dismissAlert(btn, title) {
  if (title) dismissedAlertTitles.add(title);
  persistAlertDismissed();
  const item = btn.closest('.alert-item');
  item.style.opacity = '0'; item.style.transform = 'translateX(30px)';
  setTimeout(() => {
    item.remove();
    const c = document.getElementById('alertBar');
    if (c && !c.querySelectorAll('.alert-item').length) c.style.display = 'none';
  }, 250);
}
/* 一键清空：当前所有提醒按标题记入已关闭（随数据版本持久化到 localStorage） */
function clearAllAlerts() {
  hydrateAlertDismissed();
  generateAlerts().forEach(a => dismissedAlertTitles.add(a.title));
  persistAlertDismissed();
  const c = document.getElementById('alertBar');
  if (c) {
    c.style.transition = 'opacity .18s'; c.style.opacity = '0';
    setTimeout(() => { c.style.display = 'none'; c.style.opacity = ''; c.innerHTML = ''; }, 180);
  }
}
