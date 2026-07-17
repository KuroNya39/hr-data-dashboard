/* ═══════════════════════════════════════════════════════════════════════════
   hr-alerts.js — Alert/Warning System
   6 rules: interview reminder, probation conversion, consecutive B grades,
   declining performance, high-performer retention risk, long-term outsource
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── DISMISSED ALERTS (session-scoped — survives renderAlerts but not page refresh) ── */
const dismissedAlertTitles = new Set();
let activeAlertFilter = null;
let activeAlertTitle = null;

function clearAlertFilter() {
  activeAlertFilter = null;
  activeAlertTitle = null;
  if(!document.getElementById('page-employee').classList.contains('hidden')) renderEmployeeTable();
}

function generateAlerts() {
  const alerts = [];
  const now = new Date();
  const active = rawData.filter(d => d.status === '在职');

  // Helper: check if this alert type was dismissed
  function notDismissed(title) { return !dismissedAlertTitles.has(title); }

  /* ── Rule 1: 入职3月访谈提醒 ── */
  const interviewCandidates = active.filter(d => {
    if(!d.joinDate) return false;
    const jd = new Date(d.joinDate);
    if(isNaN(jd.getTime())) return false;
    const daysSinceJoin = (now - jd) / (86400000);
    return daysSinceJoin >= 80 && daysSinceJoin <= 105;
  });
  if(interviewCandidates.length > 0 && notDismissed('入职3月访谈提醒')) {
    alerts.push({
      type: 'info',
      icon: '📞',
      title: '入职3月访谈提醒',
      desc: `${interviewCandidates.length} 名员工入职将近3个月，建议安排员工/导师访谈`,
      count: interviewCandidates.length,
      page: 'employee',
      filter: (d) => interviewCandidates.includes(d),
    });
  }

  /* ── Rule 2: 试用期转正提醒 ── */
  const probationDue = active.filter(d => {
    if(d.empType !== '试用期' || !d.joinDate) return false;
    const jd = new Date(d.joinDate);
    if(isNaN(jd.getTime())) return false;
    const monthsSince = (now - jd) / (30 * 86400000);
    return monthsSince >= 4.5 && monthsSince <= 5.8;
  });
  if(probationDue.length > 0 && notDismissed('试用期转正提醒')) {
    alerts.push({
      type: 'warning',
      icon: '⚠️',
      title: '试用期转正提醒',
      desc: `${probationDue.length} 名试用期员工即将满6个月，请及时发起转正流程`,
      count: probationDue.length,
      page: 'employment',
      filter: (d) => probationDue.includes(d),
    });
  }

  /* ── Rule 3: 连续3次B级绩效预警 ── */
  const consecutiveB = active.filter(d => {
    if(!d.hasPerf) return false;
    const g2024M = (d.perfGrade2024M||'').replace(/[^A-Za-z+\-]/g,'');
    const g2024Y = (d.perfGrade2024Y||'').replace(/[^A-Za-z+\-]/g,'');
    const g2025M = (d.perfGrade2025M||'').replace(/[^A-Za-z+\-]/g,'');
    if(!g2024M || !g2024Y || !g2025M) return false;
    const allB = [g2024M, g2024Y, g2025M].every(g => {
      const n = GRADE_NUM[g];
      return n !== undefined && n <= GRADE_NUM['B'];
    });
    return allB;
  });
  if(consecutiveB.length > 0 && notDismissed('连续3次B级及以下绩效')) {
    alerts.push({
      type: 'critical',
      icon: '🚨',
      title: '连续3次B级及以下绩效',
      desc: `${consecutiveB.length} 名员工连续3次绩效评定为B或以下，建议重点关注并制定改进计划`,
      count: consecutiveB.length,
      page: 'performance',
      filter: (d) => consecutiveB.includes(d),
    });
  }

  /* ── Rule 4: 绩效连续下降 ── */
  const decliningPerf = active.filter(d => {
    if(!d.hasPerf) return false;
    const keys = ['perfGrade2024M', 'perfGrade2024Y', 'perfGrade2025M', 'perfGrade2025Y'];
    const vals = keys.map(k => {
      const g = (d[k]||'').replace(/[^A-Za-z+\-]/g,'');
      return GRADE_NUM[g] !== undefined ? GRADE_NUM[g] : null;
    });
    // Need at least 3 values to detect declining trend
    for(let i = 0; i < vals.length - 1; i++) {
      if(vals[i] === null || vals[i+1] === null) return false;
      if(vals[i+1] >= vals[i]) return false; // not declining at this step
    }
    return vals.every(v => v !== null);
  });
  if(decliningPerf.length > 0 && notDismissed('绩效连续下降')) {
    alerts.push({
      type: 'warning',
      icon: '📉',
      title: '绩效连续下降',
      desc: `${decliningPerf.length} 名员工绩效呈持续下降趋势（2024中→2024终→2025中→2025终），需关注辅导`,
      count: decliningPerf.length,
      page: 'performance',
      filter: (d) => decliningPerf.includes(d),
    });
  }

  /* ── Rule 5: 高绩效流失风险 ── */
  const highPerfRisk = active.filter(d => {
    if(!d.hasPerf || !d.joinDate) return false;
    const g = (d.perfFinalGrade||'').replace(/[^A-Za-z+\-]/g,'');
    if(g !== 'SA' && g !== 'S' && g !== 'A') return false;
    const tenure = calcTenure(d.joinDate);
    if(tenure <= 5) return false;
    // Check level - T3 or below is risk (high perf but low level)
    const levelNum = parseInt((d.level||'').replace(/[^0-9]/g,''));
    const levelPrefix = (d.level||'')[0];
    if(levelPrefix === 'T' && levelNum >= 3) return false;
    if(levelPrefix === 'M' || levelPrefix === 'P') return false; // M/P are management/professional, not entry-level
    return true;
  });
  if(highPerfRisk.length > 0 && notDismissed('高绩效人才流失风险')) {
    alerts.push({
      type: 'warning',
      icon: '⭐',
      title: '高绩效人才流失风险',
      desc: `${highPerfRisk.length} 名高绩效员工(SA/A)司龄超5年但职级偏低(T3以下)，需关注晋升与发展`,
      count: highPerfRisk.length,
      page: 'talent',
      filter: (d) => highPerfRisk.includes(d),
    });
  }

  /* ── Rule 6: 外包长期在岗 ── */
  const longTermOutsource = active.filter(d => {
    if(d.empType !== '外包人员' || !d.joinDate) return false;
    const jd = new Date(d.joinDate);
    if(isNaN(jd.getTime())) return false;
    const yearsSince = (now - jd) / (365.25 * 86400000);
    return yearsSince > 2;
  });
  if(longTermOutsource.length > 0 && notDismissed('外包人员长期在岗')) {
    alerts.push({
      type: 'info',
      icon: '🔄',
      title: '外包人员长期在岗',
      desc: `${longTermOutsource.length} 名外包人员入职超过2年，建议评估是否转为正式编制`,
      count: longTermOutsource.length,
      page: 'employment',
      filter: (d) => longTermOutsource.includes(d),
    });
  }

  return alerts;
}

function renderAlerts() {
  const container = document.getElementById('alertBar');
  if(!container) return;
  const alerts = generateAlerts();

  // Update sidebar badge
  const badge = document.getElementById('alertBadge');
  if(badge) {
    const totalCritical = alerts.filter(a => a.type === 'critical').length;
    if(totalCritical > 0) {
      badge.textContent = totalCritical;
      badge.style.display = 'inline';
    } else {
      badge.style.display = 'none';
    }
  }

  if(alerts.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  let html = '';
  alerts.forEach((a, i) => {
    const severityClass = a.type === 'critical' ? 'alert-critical' : (a.type === 'warning' ? 'alert-warning' : 'alert-info');
    const filterTitle = encodeURIComponent(a.title);
    html += `
      <div class="alert-item ${severityClass}" data-alert-idx="${i}" data-alert-title="${filterTitle}">
        <span class="alert-icon">${a.icon}</span>
        <div class="alert-body">
          <div class="alert-title">${a.title} <span class="alert-count">${a.count} 人</span></div>
          <div class="alert-desc">${a.desc}</div>
        </div>
        <div class="alert-actions">
          <button class="alert-goto" onclick="gotoAlertFilter('${a.page}','${filterTitle}')">查看</button>
          <button class="alert-close" onclick="dismissAlert(this,'${filterTitle}')">✕</button>
        </div>
      </div>`;
  });
  container.innerHTML = html;
}

function gotoAlertFilter(page, title) {
  const decoded = decodeURIComponent(title);
  // Find the alert and apply its filter
  const alerts = generateAlerts();
  const alert = alerts.find(a => a.title === decoded);
  if(alert && alert.filter) {
    activeAlertFilter = alert.filter;
    activeAlertTitle = decoded;
  }
  switchPage(page);
}

function dismissAlert(btn, title) {
  if(title) dismissedAlertTitles.add(decodeURIComponent(title));
  const item = btn.closest('.alert-item');
  item.style.opacity = '0';
  item.style.transform = 'translateX(30px)';
  setTimeout(() => {
    item.remove();
    // If no more alerts, hide the bar
    const container = document.getElementById('alertBar');
    if(container && container.querySelectorAll('.alert-item').length === 0) {
      container.style.display = 'none';
    }
  }, 250);
}
