/* ═══════════════════════════════════════════════════════════════
   v8 alerts.js — 8 条预警规则（动态绩效周期 · 遵循筛选器 · 标注人群口径）
   ═══════════════════════════════════════════════════════════════ */

const dismissedAlertTitles = new Set();
let activeAlertFilter = null;
let activeAlertTitle = null;

function clearAlertFilter() {
  activeAlertFilter = null; activeAlertTitle = null;
  if (!document.getElementById('page-employee').classList.contains('hidden')) renderEmployeeTable();
}

function generateAlerts() {
  const alerts = [];
  const now = new Date(); now.setHours(0,0,0,0);
  const base = getFiltered();
  const active = base.filter(d => d.status === '在职');
  const formal = active.filter(d => staffGroupOf(d) === 'formal');
  const nd = title => !dismissedAlertTitles.has(title);
  const push = a => { if (a.count > 0 && nd(a.title)) alerts.push(a); };

  /* 1. 新员工访谈（80–105 天）— 全员（含实习生） */
  const interview = active.filter(d => {
    const j = toDate(d.joinDate); if (!j) return false;
    const days = (now - j) / 86400000;
    return days >= 80 && days <= 105;
  });
  push({ type:'info', icon:'support_agent', title:'新员工入职访谈提醒（80–105天）', scope:'all',
    desc:`${interview.length} 名员工入职约 3 个月，建议安排新员工/导师访谈`,
    count: interview.length, page:'employee', filter: d => interview.includes(d) });

  /* 2. 转正到期提醒（试用届满前 30 天）— 正式员工 */
  const in30 = new Date(now.getTime() + 30 * 86400000);
  const probationDue = formal.filter(d => {
    if (d.empType !== '试用期') return false;
    let p = toDate(d.probationEnd);
    if (!p) { const j = toDate(d.joinDate); if (!j) return false; p = new Date(j.getTime() + 183 * 86400000); }
    return p >= now && p <= in30;
  });
  push({ type:'warning', icon:'schedule', title:'试用期届满提醒（30 天内）', scope:'formal',
    desc:`${probationDue.length} 名试用期员工即将届满，请及时启动转正评估`,
    count: probationDue.length, page:'employee', filter: d => probationDue.includes(d) });

  /* 3. 逾期未转正 — 正式员工 */
  const overdue = formal.filter(d => {
    if (d.empType !== '试用期') return false;
    let p = toDate(d.probationEnd);
    if (!p) { const j = toDate(d.joinDate); if (!j) return false; p = new Date(j.getTime() + 183 * 86400000); }
    return p < now;
  });
  push({ type:'critical', icon:'error', title:'逾期未转正', scope:'formal',
    desc:`${overdue.length} 名员工试用届满日已过但状态仍为试用期，请核实流程状态`,
    count: overdue.length, page:'employee', filter: d => overdue.includes(d) });

  /* 4. 合同 / 协议到期（30/60/90 天分级）— 全员 */
  const in90 = new Date(now.getTime() + 90 * 86400000);
  const expiringTypes = ['固定期限劳动合同','实习协议','外包服务协议','劳务合同'];
  const expiring = active.filter(d => expiringTypes.includes(d.contractType) && (() => { const c = toDate(d.contractEnd); return c && c >= now && c <= in90; })());
  const e30 = expiring.filter(d => daysBetween(now, toDate(d.contractEnd)) <= 30).length;
  const e60 = expiring.filter(d => { const n = daysBetween(now, toDate(d.contractEnd)); return n > 30 && n <= 60; }).length;
  const e90 = expiring.filter(d => { const n = daysBetween(now, toDate(d.contractEnd)); return n > 60 && n <= 90; }).length;
  push({ type: e30 > 0 ? 'critical' : 'warning', icon:'description', title:'合同/协议到期预警（90 天内）', scope:'all',
    desc:`共 ${expiring.length} 份到期：30 天内 ${e30} · 31-60 天 ${e60} · 61-90 天 ${e90}（含固定期限合同、实习协议、外包协议、劳务合同）`,
    count: expiring.length, page:'employee', filter: d => expiring.includes(d) });

  /* 5. 连续 3 次 B 及以下（动态最新 3 期）— 正式员工 */
  const av = availablePeriods();
  if (av.length >= 3) {
    const last3 = av.slice(-3).map(p => p[0]);
    const conB = formal.filter(d => {
      if (!d.hasPerf) return false;
      const scores = last3.map(k => gradeScore(d.perf[k]));
      return scores.every(s => s != null && s <= GRADE_NUM['B']);
    });
    push({ type:'critical', icon:'trending_down', title:'连续 3 次 B 级及以下绩效', scope:'formal',
      desc:`${conB.length} 名员工在最近 3 期（${av.slice(-3).map(p=>p[1]).join('→')}）均为 B 及以下，建议制定改进计划`,
      count: conB.length, page:'employee', filter: d => conB.includes(d) });
  }

  /* 6. 绩效连续下降（动态最新 4 期）— 正式员工 */
  if (av.length >= 4) {
    const last4 = av.slice(-4).map(p => p[0]);
    const declining = formal.filter(d => {
      if (!d.hasPerf) return false;
      const scores = last4.map(k => gradeScore(d.perf[k]));
      if (scores.some(s => s == null)) return false;
      return scores.every((s, i) => i === 0 || s < scores[i-1]);
    });
    push({ type:'warning', icon:'arrow_downward', title:'绩效连续下降', scope:'formal',
      desc:`${declining.length} 名员工绩效在 ${av.slice(-4).map(p=>p[1]).join('→')} 持续下降，需关注辅导`,
      count: declining.length, page:'employee', filter: d => declining.includes(d) });
  }

  /* 7. 高绩效 + 长司龄 + 低职级 — 正式员工 */
  const highRisk = formal.filter(d => {
    if (!d.hasPerf) return false;
    if (!['SA','S','A'].includes(cleanGrade(latestGrade(d.perf)))) return false;
    if (calcTenure(d.joinDate) <= 5) return false;
    const m = (d.level || '').match(/^T(\d+)$/i);
    return m ? +m[1] < 3 : false;
  });
  push({ type:'warning', icon:'star', title:'高绩效人才流失风险', scope:'formal',
    desc:`${highRisk.length} 名高绩效员工（SA/S/A）司龄超 5 年但职级在 T3 以下，需关注晋升发展`,
    count: highRisk.length, page:'employee', filter: d => highRisk.includes(d) });

  /* 8. 外包 / 劳务长期在岗（>2 年）— 外协口径 */
  const longOut = active.filter(d => {
    if (staffGroupOf(d) !== 'outsource') return false;
    const j = toDate(d.joinDate);
    return j && (now - j) / YEAR_MS > 2;
  });
  push({ type:'info', icon:'autorenew', title:'外协/劳务人员长期在岗', scope:'all',
    desc:`${longOut.length} 名外协/劳务人员入职超 2 年，建议评估转正编制或轮换安排`,
    count: longOut.length, page:'employee', filter: d => longOut.includes(d) });

  return alerts;
}

/* 侧边栏「预警」那个数字角标。抽出来是因为关掉一条预警后也得同步刷新，
   以前只有 renderAlerts() 里更新，关掉一条角标还挂着旧数字，直到下次刷新才对 */
function updateAlertBadge(alerts) {
  const badge = document.getElementById('navBadge');
  if (!badge) return;
  const n = (alerts || []).filter(a => a.type === 'critical' || a.type === 'warning').length;
  badge.style.display = n ? 'inline-flex' : 'none';
  badge.textContent = n;
}

function renderAlerts() {
  const container = document.getElementById('alertBar');
  if (!container) return;
  const alerts = generateAlerts();
  updateAlertBadge(alerts);
  if (!alerts.length) { container.innerHTML = ''; container.style.display = 'none'; return; }
  container.style.display = 'flex';
  container.innerHTML = alerts.map(a => {
    const m = SCOPE_META[a.scope] || SCOPE_META.all;
    return `
    <div class="alert-item alert-${a.type}">
      <span class="alert-icon"><span class="mi">${a.icon}</span></span>
      <div class="alert-body">
        <div class="alert-title">${esc(a.title)}<span class="alert-count">${a.count} 人</span><span class="scope-note ${m.cls}" title="${esc(m.title)}">${m.label}</span></div>
        <div class="alert-desc">${esc(a.desc)}</div>
      </div>
      <div class="alert-actions">
        <button class="alert-goto mi-btn" onclick="gotoAlertFilter('${a.page}','${esc(a.title).replace(/'/g, '&#39;')}')">查看</button>
        <button class="alert-close" title="本次会话不再提示" onclick="dismissAlert(this,'${esc(a.title).replace(/'/g, '&#39;')}')"><span class="mi">close</span></button>
      </div>
    </div>`;
  }).join('');
}

function gotoAlertFilter(page, title) {
  const alert = generateAlerts().find(a => a.title === title);
  if (alert && alert.filter) { activeAlertFilter = alert.filter; activeAlertTitle = title; }
  switchPage(page);
}
function dismissAlert(btn, title) {
  if (title) dismissedAlertTitles.add(title);
  const item = btn.closest('.alert-item');
  item.style.opacity = '0'; item.style.transform = 'translateX(30px)';
  setTimeout(() => {
    item.remove();
    const c = document.getElementById('alertBar');
    if (c && !c.querySelectorAll('.alert-item').length) c.style.display = 'none';
    // dismissedAlertTitles 会改变 generateAlerts() 的结果，所以角标要跟着重算
    updateAlertBadge(generateAlerts());
  }, 250);
}
