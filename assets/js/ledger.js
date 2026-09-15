/* ═══════════════════════════════════════════════════════════════
   v8 ledger.js — HR 工作台账解析（SWC最新人才现状-*.xlsx）
   9 个 sheet → 6 个业务板块
   该工作簿含声明假范围（如「招聘未达成需求」声明 1048536 行 × 16374 列），
      所有读取一律走 sheetRowsSafe() 先裁剪 !ref，否则 SheetJS 会 OOM。
   ═══════════════════════════════════════════════════════════════ */

/* 找到表头所在行（按关键字命中） */
function findHeaderRow(rows, keywords, scanMax) {
  const cap = Math.min(rows.length, scanMax || 12);
  for (let i = 0; i < cap; i++) {
    const r = rows[i];
    if (!r) continue;
    const joined = r.map(c => (c == null ? '' : String(c))).join('|');
    if (keywords.every(k => joined.includes(k))) return i;
  }
  return -1;
}
/* 台账单元格取数：空 → ''，数字保留 */
function lv(v) {
  if (v === undefined || v === null) return '';
  return String(v).trim();
}
function lnum(v) {
  if (v === '' || v === null || v === undefined) return 0;
  const n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}
function ldate(v) { return v === '' ? '' : parseExcelDate(v); }
/* 取行的列值 */
function cellAt(row, idx) { return (idx >= 0 && row && row[idx] !== undefined) ? row[idx] : ''; }

/* ── 主入口 ── */
function parseLedgerWorkbook(wb) {
  const out = {
    summary: null, bcPeople: [], campus27: [], outsource: { active: [], left: [], notes: [] },
    onboard: [], recruitOpen: [], reserveCandidates: [], highPotential: [], deptTier: [],
    sheets: wb.SheetNames.slice(),
  };
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    if (!ws) continue;
    let rows;
    try { rows = sheetRowsSafe(ws, 2000); } catch (e) { console.warn('台账 sheet 读取失败:', sn, e); continue; }
    if (!rows || !rows.length) continue;
    const key = sn.replace(/\s/g, '');
    try {
      if (key.includes('组织架构')) out.summary = parseLedgerSummary(rows, out.summary);
      else if (key.includes('B-C') || key.includes('BC人员') || key.includes('人员情况')) out.bcPeople = parseBC(rows);
      else if (key.includes('校招需求')) out.campus27 = parseCampus27(rows);
      else if (key.includes('外包名单') || key.includes('外包评价')) out.outsource = parseOutsource(rows);
      else if (key.includes('入职名单')) out.onboard = parseOnboard(rows);
      else if (key.includes('招聘未达成') || key.includes('未达成需求')) out.recruitOpen = parseRecruitOpen(rows);
      else if (key.includes('储备干部')) out.reserveCandidates = parseReserve(rows);
      else if (key.includes('高潜')) out.highPotential = parseHighPotential(rows);
      else if (key.includes('部门梯队')) out.deptTier = parseDeptTier(rows);
    } catch (e) { console.warn('台账 sheet 解析失败:', sn, e); }
  }
  return out;
}

/* ── ① SWC中心组织架构（汇总说明 + 职等分布）── */
function parseLedgerSummary(rows, prev) {
  const s = prev || { headcount:null, probation:null, intern:null, internPaid:null, outsource:null,
    demand:null, done:null, pending:null, pendingOutsource:null, levelDist:[], notes:[] };
  const text = [];
  rows.forEach(r => {
    if (!r) return;
    // 只取每行最靠左的一长串说明文字，避免把右侧「职等/人数」小表拼进汇总
    for (let c = 0; c < Math.min(r.length, 6); c++) {
      const s = lv(r[c]).replace(/\s+/g, ' ');
      if (s.length >= 8 && /[\u4e00-\u9fa5]/.test(s)) { text.push(s); break; }
    }
  });
  const all = text.join(' ');
  const grab = (re) => { const m = all.match(re); return m ? parseInt(m[1], 10) : null; };
  const v1 = grab(/在职总人数[：:]\s*(\d+)/); if (v1 != null) s.headcount = v1;
  const v2 = grab(/含\s*(\d+)\s*位试用期/); if (v2 != null) s.probation = v2;
  const v3 = grab(/实习生\s*(\d+)\s*人/); if (v3 != null) s.intern = v3;
  const v4 = grab(/含\s*(\d+)\s*位签约实习生/); if (v4 != null) s.internPaid = v4;
  const v5 = grab(/技术外协\s*(\d+)\s*人/); if (v5 != null) s.outsource = v5;
  const v6 = grab(/需求共计\s*(\d+)/); if (v6 != null) s.demand = v6;
  const v7 = grab(/已达成\s*(\d+)/); if (v7 != null) s.done = v7;
  const v8 = grab(/待招聘\s*(\d+)\s*人/); if (v8 != null) s.pending = v8;
  const v9 = grab(/（\s*(\d+)\s*个外包需求\s*）/); if (v9 != null) s.pendingOutsource = v9;
  s.notes = text.filter(t => /总人数|其余人员|招聘情况|各职等|提报|转入|合计/.test(t)).slice(0, 8);

  // 职等分布：找「职等 / 人数」表头行及其下一行
  for (let i = 0; i < rows.length - 1; i++) {
    const r = rows[i], nx = rows[i+1];
    if (!r || !nx) continue;
    if (lv(cellAt(r, 0)) === '职等' && lv(cellAt(nx, 0)) === '人数') {
      const dist = [];
      for (let c = 1; c < r.length; c++) {
        const lab = lv(cellAt(r, c)), cnt = lnum(cellAt(nx, c));
        if (lab && cnt > 0) dist.push({ level: lab, count: cnt });
      }
      if (dist.length) s.levelDist = dist;
      break;
    }
  }
  return s;
}

/* ── ② B-C 人员情况（末位改进跟踪）── */
function parseBC(rows) {
  const hi = findHeaderRow(rows, ['工号', '姓名'], 6);
  if (hi < 0) return [];
  const H = rows[hi].map(c => lv(c));
  const i = {
    id: findCol(H, '工号'), name: findCol(H, '姓名'), dept: findCol(H, '部门'),
    level: findCol(H, '职等'), sub: findCol(H, '子职等'),
    h2023H2: findCol(H, '2023H2'), h2024H1: findCol(H, '2024H1'),
    h2024H2: findCol(H, '2024H2'), h2025H1: findCol(H, '2025H1'),
    h2025H2: findCol(H, '2025H2'), h2026H1: findCol(H, '2026H1'),
    plan: findCol(H, '后续计划'), conclusion: findCol(H, '把关结论'),
    replaceDir: findCol(H, '置换需求'), progress: findCol(H, '当前进展'),
  };
  const out = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !lv(cellAt(row, i.name))) continue;
    out.push({
      id: lv(cellAt(row, i.id)), name: lv(cellAt(row, i.name)), dept: lv(cellAt(row, i.dept)),
      level: lv(cellAt(row, i.level)), sub: lv(cellAt(row, i.sub)),
      grades: [lv(cellAt(row, i.h2023H2)), lv(cellAt(row, i.h2024H1)), lv(cellAt(row, i.h2024H2)),
               lv(cellAt(row, i.h2025H1)), lv(cellAt(row, i.h2025H2)), lv(cellAt(row, i.h2026H1))],
      plan: lv(cellAt(row, i.plan)), conclusion: lv(cellAt(row, i.conclusion)),
      replaceDir: lv(cellAt(row, i.replaceDir)), progress: lv(cellAt(row, i.progress)),
    });
  }
  return out;
}

/* ── ③ 27届校招需求 ── */
function parseCampus27(rows) {
  const hi = findHeaderRow(rows, ['部门', '岗位名称'], 5);
  if (hi < 0) return [];
  const H = rows[hi].map(c => lv(c));
  const i = {
    dept: findCol(H, '部门'), position: findCol(H, '岗位名称'), jobType: findCol(H, '职类'),
    direction: findCol(H, '岗位方向'), detail: findCol(H, '具体方向'), count: findCol(H, '校招人数'),
    edu: findCol(H, '学历要求'), reason: findCol(H, '配置原因'), location: findCol(H, '地域'),
    owner: findCol(H, '岗位负责人'), note: findCol(H, '备注'),
  };
  const out = [];
  for (let r = hi + 2; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const n = lnum(cellAt(row, i.count));
    // 跳过「合计」行（部门与岗位均为空，只有汇总数字）
    if (!n || !lv(cellAt(row, i.dept))) continue;
    out.push({
      dept: lv(cellAt(row, i.dept)), position: lv(cellAt(row, i.position)), jobType: lv(cellAt(row, i.jobType)),
      direction: lv(cellAt(row, i.direction)), detail: lv(cellAt(row, i.detail)), count: n,
      edu: lv(cellAt(row, i.edu)), reason: lv(cellAt(row, i.reason)), location: lv(cellAt(row, i.location)),
      owner: lv(cellAt(row, i.owner)), note: lv(cellAt(row, i.note)),
    });
  }
  return out;
}

/* ── ④ 外包名单（在岗 / 离岗）── */
function parseOutsource(rows) {
  const res = { active: [], left: [], notes: [] };
  let mode = 'active';
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const c0 = lv(cellAt(row, 0));
    if (c0 === '离岗名单') { mode = 'left'; continue; }
    if (c0 === '员工姓名') continue;
    if (!c0) continue;
    if (/当前在岗|整体表现|不达预期将置换|已离岗/.test(c0)) { res.notes.push(c0); continue; }
    const item = { name: c0, dept: lv(cellAt(row, 1)), joinDate: ldate(cellAt(row, 2)), status: lv(cellAt(row, 3)) };
    (mode === 'active' ? res.active : res.left).push(item);
  }
  return res;
}

/* ── ⑤ 本年度入职名单 ── */
function parseOnboard(rows) {
  const hi = findHeaderRow(rows, ['员工姓名', '入职日期'], 6);
  if (hi < 0) return [];
  const H = rows[hi].map(c => lv(c));
  const i = {
    name: findCol(H, '员工姓名'), dept: findCol(H, '二级部门'), level: findCol(H, '职等'),
    sub: findCol(H, '子等级'), position: findCol(H, '职位'), joinDate: findCol(H, '入职日期'),
    status: findCol(H, '状态'),
  };
  const out = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !lv(cellAt(row, i.name))) continue;
    out.push({
      name: lv(cellAt(row, i.name)), dept: lv(cellAt(row, i.dept)), level: lv(cellAt(row, i.level)),
      sub: lv(cellAt(row, i.sub)), position: lv(cellAt(row, i.position)),
      joinDate: ldate(cellAt(row, i.joinDate)), status: lv(cellAt(row, i.status)),
    });
  }
  return out;
}

/* ── ⑥ 招聘未达成需求 ── */
function parseRecruitOpen(rows) {
  const hi = findHeaderRow(rows, ['部门', '岗位名称'], 8);
  if (hi < 0) return [];
  const H = rows[hi].map(c => lv(c));
  const i = {
    center: findCol(H, '中心'), dept: findCol(H, '部门'), position: findCol(H, '岗位名称'),
    direction: findCol(H, '技术方向'), count: findCol(H, '需求人数'), reason: findCol(H, '原因说明'),
    project: findCol(H, '影响项目'), channel: findCol(H, '招聘渠道'),
  };
  const out = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const n = lnum(cellAt(row, i.count));
    // 跳过「合计」行（部门为空，只有汇总人数）
    if (!n || !lv(cellAt(row, i.dept))) continue;
    out.push({
      center: lv(cellAt(row, i.center)), dept: lv(cellAt(row, i.dept)), position: lv(cellAt(row, i.position)),
      direction: lv(cellAt(row, i.direction)), count: n, reason: lv(cellAt(row, i.reason)),
      project: lv(cellAt(row, i.project)), channel: lv(cellAt(row, i.channel)),
    });
  }
  return out;
}

/* ── ⑦ 储备干部名单 ──
   2026-09-12：用户的「储备干部名单」sheet 没有「职等」列了，改用「梯队」列定位表头。 */
function parseReserve(rows) {
  const hi = findHeaderRow(rows, ['姓名', '梯队'], 5) >= 0
    ? findHeaderRow(rows, ['姓名', '梯队'], 5)
    : findHeaderRow(rows, ['姓名', '职等'], 5);
  if (hi < 0) return [];
  const H = rows[hi].map(c => lv(c));
  const i = {
    targetRole: findCol(H, '拟任用岗位'), name: findCol(H, '姓名'), position: findCol(H, '岗位名称'),
    level: findCol(H, '职等'), sub: findCol(H, '子职等'), tier: findCol(H, '梯队'),
    school: findCol(H, '毕业院校'), edu: findCol(H, '学历'), gradDate: findCol(H, '毕业时间'),
    firstWork: findCol(H, '首次工作日期'), workYears: findCol(H, '工龄'), birthDate: findCol(H, '出生日期'),
    age: findCol(H, '年龄'), joinDate: findCol(H, '入职日期'), tenure: findCol(H, '司龄'),
    g2025Y: findCol(H, '2025年终'), g2025M: findCol(H, '2025年中'),
    g2024Y: findCol(H, '2024年终'), g2024M: findCol(H, '2024年中'),
    g2023Y: findCol(H, '2023年终'), g2023M: findCol(H, '2023年中'),
    trend: findCol(H, '近6次绩效'),
  };
  const out = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !lv(cellAt(row, i.name))) continue;
    out.push({
      targetRole: lv(cellAt(row, i.targetRole)), name: lv(cellAt(row, i.name)), position: lv(cellAt(row, i.position)),
      level: lv(cellAt(row, i.level)), sub: lv(cellAt(row, i.sub)), tier: lv(cellAt(row, i.tier)),
      school: lv(cellAt(row, i.school)), edu: lv(cellAt(row, i.edu)), gradDate: ldate(cellAt(row, i.gradDate)),
      firstWork: ldate(cellAt(row, i.firstWork)), workYears: lnum(cellAt(row, i.workYears)),
      birthDate: ldate(cellAt(row, i.birthDate)), age: lnum(cellAt(row, i.age)),
      joinDate: ldate(cellAt(row, i.joinDate)), tenure: lnum(cellAt(row, i.tenure)),
      grades: [lv(cellAt(row, i.g2023M)), lv(cellAt(row, i.g2023Y)), lv(cellAt(row, i.g2024M)), lv(cellAt(row, i.g2024Y)),
               lv(cellAt(row, i.g2025M)), lv(cellAt(row, i.g2025Y))],
      trend: lv(cellAt(row, i.trend)),
    });
  }
  return out;
}

/* ── ⑧ 高潜名单 ── */
function parseHighPotential(rows) {
  const hi = findHeaderRow(rows, ['员工姓名', '职位'], 6);
  if (hi < 0) return [];
  const H = rows[hi].map(c => lv(c));
  const i = {
    seq: findCol(H, '序号'), center: findCol(H, '一级中心'), dept: findCol(H, '二级部门'),
    name: findCol(H, '员工姓名'), position: findCol(H, '职位'), manager: findCol(H, '上级主管'),
    joinDate: findCol(H, '入职日期'), level: findCol(H, '职等'), sub: findCol(H, '子等级'),
    g25H2: findCol(H, '25H2'), g25H1: findCol(H, '25H1'),
  };
  // 晋升年限在上一行分组表头（R1 该列为空）
  let promoIdx = findCol(H, '最快');
  if (promoIdx < 0) {
    const above = rows[hi-1] || [];
    promoIdx = above.findIndex(c => lv(c).includes('最快'));
  }
  const out = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !lv(cellAt(row, i.name))) continue;
    out.push({
      seq: lnum(cellAt(row, i.seq)), center: lv(cellAt(row, i.center)), dept: lv(cellAt(row, i.dept)),
      name: lv(cellAt(row, i.name)), position: lv(cellAt(row, i.position)), manager: lv(cellAt(row, i.manager)),
      joinDate: ldate(cellAt(row, i.joinDate)), level: lv(cellAt(row, i.level)), sub: lv(cellAt(row, i.sub)),
      g25H2: lv(cellAt(row, i.g25H2)), g25H1: lv(cellAt(row, i.g25H1)),
      promo: promoIdx >= 0 ? lv(cellAt(row, promoIdx)) : '',
    });
  }
  return out;
}

/* ── ⑨ 部门梯队（GTD 分组矩阵，原样保留）── */
function parseDeptTier(rows) {
  const out = [];
  rows.forEach(r => {
    if (!r) return;
    const line = r.map(c => lv(c));
    if (line.some(c => c)) out.push(line);
  });
  return out;
}
