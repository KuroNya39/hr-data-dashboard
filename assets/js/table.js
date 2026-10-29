/* ═══════════════════════════════════════════════════════════════
   v8 table.js — 员工明细表 · 列筛选弹窗 · 排序 · 分页 · CSV 导出
   v8 新增：人群列（正式/实习/外协），与看板口径一致
   ═══════════════════════════════════════════════════════════════ */

let searchTimer = null;
function debounceSearch(fn, ms) { if (searchTimer) clearTimeout(searchTimer); searchTimer = setTimeout(fn, ms); }

const EMP_COLS = [
  /* ① 身份 */
  { key:'rowNum', label:'序号' }, { key:'id', label:'工号' }, { key:'name', label:'姓名' },
  /* ② 在职状态（筛选后的第一眼确认） */
  { key:'status', label:'状态' }, { key:'group', label:'人群' }, { key:'empType', label:'用工类型' },
  /* ③ 组织归属 */
  { key:'center', label:'中心' }, { key:'dept', label:'部门' }, { key:'deptEn', label:'部门简称' },
  { key:'position', label:'职位' }, { key:'jobFamily', label:'职类' }, { key:'manager', label:'上级主管' },
  { key:'workLocation', label:'工作地点' }, { key:'orgType', label:'组织类型' },
  /* ④ 职级与人才 */
  { key:'level', label:'职级' }, { key:'subLevel', label:'子等级' },
  { key:'mgmtLevel', label:'管理通道职等' }, { key:'talentPipeline', label:'梯队' },
  /* ⑤ 绩效（近 3 期动态列由 getEmpCols() 插在推荐排名前） */
  { key:'perfRank', label:'推荐排名' }, { key:'perfCoeff', label:'投入系数' },
  /* ⑥ 时间线 */
  { key:'joinDate', label:'入职日期' }, { key:'confirmDate', label:'预定转正日' },
  { key:'probationEnd', label:'试用届满日期' }, { key:'currentRoleDate', label:'现职开始日期' }, { key:'tenure', label:'司龄' },
  { key:'leaveDate', label:'离职日期' },
  { key:'contractType', label:'合同类型' }, { key:'contractStart', label:'合同开始' }, { key:'contractEnd', label:'合同结束' },
  /* ⑦ 背景与来源 */
  { key:'edu', label:'学历' }, { key:'school', label:'毕业学校' }, { key:'major', label:'主修专业' }, { key:'gradDate', label:'毕业时间' },
  { key:'industryYears', label:'行业年限' }, { key:'firstWorkDate', label:'首次工作' },
  { key:'source', label:'招聘来源' }, { key:'mentor', label:'导师' }, { key:'referrer', label:'推荐人' },
  { key:'interviewGrade', label:'面试评价' }, { key:'equity', label:'股权激励' },
  /* ⑧ 个人信息（低频敏感，后移） */
  { key:'gender', label:'性别' }, { key:'birthDate', label:'出生日期' },
  { key:'hometown', label:'籍贯' }, { key:'maritalStatus', label:'婚姻状况' },
  /* ⑨ 系统信息 */
  { key:'email', label:'公司邮箱' }, { key:'payGroup', label:'工资组' },
  { key:'duty', label:'工作内容' },   // 来自 Excel「工作分工」sheet，按工号 join；没填内容的整列为空
];

/* ── 近 3 期绩效列（动态，替换原「最新绩效」单列，2026-10-14 用户要求）──
   表头写具体时间（26H1/25H2/25H1 样式）。26H1 只算一期（grade26H1），
   且**只认终评**——初评在解析阶段就被丢掉了（2026-10-21 用户明确要求）。
   期清单直接用 core.js 的 recentPeriods()（同一套 PERIOD_ORDER + 缓存，
   梯队高潜表共用），不在本文件重扫一遍 perfData。数据包里实际有哪几期就展示哪几期，
   最多 3 期，最新在最左（时间倒序）。
   原则上由 getEmpCols() 插到「推荐排名」列之前。 */
function perfPeriodCols() {
  return recentPeriods(3).map(([pk, label]) => ({ key: 'pp:' + pk, label }));
}
/* 实际列清单 = 静态列 + 动态绩效期列 */
function getEmpCols() {
  const cols = EMP_COLS.slice();
  const pc = perfPeriodCols();
  const i = cols.findIndex(c => c.key === 'perfRank');
  cols.splice(i < 0 ? cols.length : i, 0, ...pc);
  return cols;
}

let columnFilters = {};
/* 排序=逐列稳定排序（2026-10-14 定版，用户拍板）：点升/降=在当前顺序上做一次稳定排序
   （Excel 逐列排序效果）——新列同值的行保持原相对位置，无限叠加。
   empOrderSeq=整表顺序覆盖层（工号→序号）；empSortState 仅用于表头箭头（最近一次排序的列）。
   重置（A 规则）：顶栏/列筛选、搜索、预警跳转、数据重载=新的一局回默认序；
   翻页/改每页条数/导出不重置。无清除按钮——重置只走这些路径。 */
let empSortState = { field: null, asc: true };
let empOrderSeq = new Map();
function resetEmpOrder() {
  if (!empOrderSeq.size && !empSortState.field) return;
  empOrderSeq = new Map(); empSortState = { field: null, asc: true };
}
let filterPopupCol = null;
let empPageSize = 100, empPage = 1, empTotalPages = 1;

/* 每列「值」的唯一定义处：列筛选、筛选弹窗、排序、CSV 全部走它。
   否则同一个格子会出现「表格里有值、弹窗里却是全选 0」——
   tenure / perfRank / perfCoeff 这几列不是员工对象上的直接字段，
   是从 joinDate / perf 里算出来的，各写一份必然对不齐。
   返回的字符串就是用户在单元格里看到的那个词（不含标签色） */
function empColValue(d, k) {
  if (k.startsWith('pp:')) {                     // 近 3 期绩效列：pp:grade2025Y 等
    const v = d.perf && d.perf[k.slice(3)];
    return v ? cleanGrade(v) : '';
  }
  switch (k) {
    case 'rowNum': return '';
    case 'group': return GROUP_SHORT[staffGroupOf(d)] || '';
    case 'tenure': { const t = empTenure(d); return t > 0 ? t.toFixed(1) + '年' : ''; }
    case 'perfRank': return (d.perf && d.perf.rank) || '';
    case 'perfCoeff': return (d.perf && d.perf.inputCoeff) ? d.perf.inputCoeff.toFixed(2) : '';
    case 'duty': return (typeof dsData !== 'undefined' && dsData.dutyMap && dsData.dutyMap[d.id]) || '';
    default: { const v = d[k]; return v == null || v === '' ? '' : String(v); }
  }
}

/* 搜索框命中的字段（渲染、弹窗、导出共用同一套，别在三处各写一份列表） */
const EMP_SEARCH_FIELDS = ['id','name','dept','level','center','position','manager','school','major','workLocation'];
function empMatchesSearch(d, q) {
  return EMP_SEARCH_FIELDS.some(f => d[f] && String(d[f]).toLowerCase().includes(q));
}

function getFilteredEmployees() {
  const filtered = getFiltered();
  if (typeof activeAlertFilter === 'function') return filtered.filter(d => activeAlertFilter(d));
  return filtered;
}

/* 统一取数管道：全局筛选 → 预警 → 列筛选 → 搜索 → 排序（渲染与导出共用，保证所见即所得） */
/* 单列排序键：数字列给数值，其余给字符串（多级比较器逐级调用） */
function empSortVal(d, sf) {
  if (sf === 'tenure') return empTenure(d);
  if (sf === 'industryYears') return d.industryYears ?? -1;
  if (sf.startsWith('pp:')) { const pk = sf.slice(3); return (d.perf && gradeScore(d.perf[pk])) ?? -1; }
  if (sf === 'perfCoeff') return (d.perf && d.perf.inputCoeff) || -1;
  return empColValue(d, sf);
}
function getEmployeeRows() {
  let rows = getFilteredEmployees();
  /* 注意判空的是「这一列有没有被筛过」，不是「选了几项」：
     用户在弹窗里取消勾选「全选」= 一个都不选，那就是一行都不该剩，
     以前 set.size > 0 才算筛过，会把空选择当成没筛选、把整张表又放出来 */
  for (const [colKey, set] of Object.entries(columnFilters)) {
    if (!set) continue;
    rows = rows.filter(d => set.has(empColValue(d, colKey)));
  }
  const q = (document.getElementById('empSearch').value || '').toLowerCase().trim();
  if (q) rows = rows.filter(d => empMatchesSearch(d, q));
  /* 排序=顺序覆盖层：叠序存在时按序号排（筛选/搜索只做子集，不动顺序）；
     没有覆盖层=默认序（rawData 原序）。覆盖层由 sortEmployeeTable 生成 */
  if (empOrderSeq.size) rows = rows.slice().sort((a, b) => empOrderSeq.get(a.id) - empOrderSeq.get(b.id));
  return rows;
}

function renderEmployeeTable() {
  const rows = getEmployeeRows();

  // 预警筛选横幅
  const banner = document.getElementById('empAlertBanner');
  if (banner) banner.innerHTML = activeAlertTitle && typeof activeAlertFilter === 'function'
    ? `<div class="emp-banner">` +
      `<b>预警筛选：「${esc(activeAlertTitle)}」</b><span class="emp-banner-n">共 ${rows.length} 人</span>` +
      `<button class="link-btn" onclick="clearAlertFilter()"><span class="mi">close</span> 清除预警筛选</button></div>` : '';

  const total = rows.length;
  empTotalPages = Math.max(1, Math.ceil(total / empPageSize));
  if (empPage > empTotalPages) empPage = empTotalPages;
  if (empPage < 1) empPage = 1;
  const start = (empPage - 1) * empPageSize;
  const pageRows = rows.slice(start, start + empPageSize);
  const activeCount = rows.filter(d => d.status === '在职').length;

  document.getElementById('empTableCount').textContent =
    `${total} 人 · 在职 ${activeCount} · 离职 ${total - activeCount} · 第 ${empPage}/${empTotalPages} 页`;
  const hint = document.getElementById('empFilterHint');
  const fc = Object.keys(columnFilters).filter(k => columnFilters[k]).length;
  hint.textContent = fc ? `${fc} 列已筛选` : '';
  hint.classList.toggle('active', !!fc);

  const cols = getEmpCols();
  const keys = cols.map(c => c.key), labels = cols.map(c => c.label);
  let html = '<table><thead><tr>' + labels.map((h, i) => {
    const k = keys[i];
    /* 序号列不可筛（toggleFilterPopup 会直接 return）：不能给它指针光标、
       不能给它 tabindex、也不能给它漏斗图标 —— 三样都是「点了有用」的假承诺（G3/G11）。 */
    if (k === 'rowNum') return `<th data-nofilter>${esc(h)}</th>`;
    const arrow = empSortState.field === k ? `<span class="mi">${empSortState.asc ? 'arrow_upward' : 'arrow_downward'}</span>` : '';
    const icon = columnFilters[k] ? '<span class="mi">check</span>' : '';
    /* 可聚焦就必须可激活：只给 tabindex 不给 keydown，等于键盘能 Tab 到、按下去没反应（焦点陷阱）。
       读屏名走 aria-label，不用原生 title（title 会弹系统气泡、且不算可访问名）。 */
    const fpJs = `toggleFilterPopup('${k}','${esc(h)}',this,event)`;
    return `<th class="th-sort" tabindex="0" aria-label="筛选「${esc(h)}」" onclick="${fpJs}"` +
      ` onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${fpJs}}">${esc(h)}${arrow}${icon}</th>`;
  }).join('') + '</tr></thead><tbody>';

  pageRows.forEach((d, i) => {
    html += `<tr data-eid="${esc(d.id)}">` + keys.map(k => {
      if (k === 'rowNum') return `<td>${start + i + 1}</td>`;
      if (k === 'status') return `<td>${statusTag(d)}</td>`;
      if (k === 'group') {
        const g = staffGroupOf(d);
        const cls = { formal:'tag-permanent', intern:'tag-intern-paid', outsource:'tag-outsource' }[g] || '';
        return `<td><span class="tag ${cls}">${esc(GROUP_SHORT[g] || '—')}</span></td>`;
      }
      if (k === 'empType') {
        const cls = { '已转正':'tag-permanent','试用期':'tag-probation','签约实习生':'tag-intern-paid','非签约实习生':'tag-intern-unpaid','外包人员':'tag-outsource','劳务人员':'tag-labor' }[d.empType] || '';
        return d.empType ? `<td><span class="tag ${cls}">${esc(d.empType)}</span></td>` : '<td>—</td>';
      }
      if (k === 'tenure') { const t = empTenure(d); return `<td>${t > 0 ? t.toFixed(1) + '年' : '—'}</td>`; }
      if (k.startsWith('pp:')) { const v = d.perf && d.perf[k.slice(3)]; return `<td>${v ? gradeTag(v) : '—'}</td>`; }
      if (k === 'perfRank') return `<td>${esc(d.perf && d.perf.rank) || '—'}</td>`;
      if (k === 'perfCoeff') return `<td>${d.perf && d.perf.inputCoeff ? d.perf.inputCoeff.toFixed(2) : '—'}</td>`;
      if (k === 'duty') {
        const v = (typeof dsData !== 'undefined' && dsData.dutyMap && dsData.dutyMap[d.id]) || '';
        /* 长文本截断显示，悬停看全文（2026-10-14 拍板：保留列但别把表撑开）。
           这里的 title 装的是**被截掉的全文**、不是提示语，属于「不给原生 title」的有意例外；
           同时补 aria-label，让读屏也拿得到全文（视觉用户仍只能靠悬停，见待落地清单 E）。 */
        return `<td class="duty-cell"${v ? ` title="${esc(v)}" aria-label="${esc(v)}"` : ''}>${v ? esc(v) : '—'}</td>`;
      }
      const v = d[k];
      return `<td>${v != null && v !== '' ? esc(v) : '—'}</td>`;
    }).join('') + '</tr>';
  });
  html += '</tbody></table>';

  // 分页控件（totalPages 用全局 empTotalPages，修复 v6 局部变量 bug）
  // 2026-10-14 用户拍板：分页条固定居中、不左右移动 → 注入到滚动容器**外**的
  // #empPgBar（横向滚动表格时它不再跟着滚走）。
  // ⚠️ 该容器由 看板.html 静态提供（#empTableWrap 的兄弟节点），必须一直在；
  //    删掉它分页条就没地方落，页面不会报错、只是翻页控件凭空消失。
  /* #empPgBar 本身就是 .pg-bar（看板.html 静态带类），别再套一层同名 div ——
     那样 padding 会叠成两倍，且 DOM 里多一层无意义嵌套 */
  const pgHtml =
    `<button class="tb-btn" onclick="empGoToPage(1)" aria-label="第一页"><span class="mi">first_page</span></button><button class="tb-btn" onclick="empGoToPage(empPage-1)" aria-label="上一页"><span class="mi">chevron_left</span></button>` +
    `<select class="pg-select" aria-label="跳到第几页" onchange="empGoToPage(parseInt(this.value))">` +
    Array.from({length: empTotalPages}, (_, i) => `<option value="${i+1}"${i+1===empPage?' selected':''}>第 ${i+1} 页</option>`).join('') + '</select>' +
    `<button class="tb-btn" onclick="empGoToPage(empPage+1)" aria-label="下一页"><span class="mi">chevron_right</span></button><button class="tb-btn" onclick="empGoToPage(empTotalPages)" aria-label="最后一页"><span class="mi">last_page</span></button>` +
    `<span class="dim">每页</span><select class="pg-select" aria-label="每页显示条数" onchange="empPageSize=parseInt(this.value);empPage=1;renderEmployeeTable()">` +
    [50,100,200,500].map(s => `<option value="${s}"${s===empPageSize?' selected':''}>${s}</option>`).join('') + '</select><span class="dim">条</span>';

  document.getElementById('empTableWrap').innerHTML = html;
  document.getElementById('empPgBar').innerHTML = pgHtml;
  /* 分页条里的两个下拉是原生 <select>，上面刚用 innerHTML 重铺过 ——
     重铺会连带把上一轮自绘的按钮一起丢掉，所以每次渲染后都要再接管一次。
     enhanceSelects() 幂等：已接管的（sel.__selx 已在）直接跳过。 */
  enhanceSelects(document.getElementById('empPgBar'));
}
function empGoToPage(p) {
  empPage = Math.min(Math.max(1, p), empTotalPages);
  renderEmployeeTable();
}

/* ── Excel 风格列筛选弹窗 ── */
let fpLastTh = null;
function toggleFilterPopup(colKey, colLabel, thEl, ev) {
  const popup = document.getElementById('filterPopup');
  if (!popup) return;
  ev.stopPropagation();
  if (filterPopupCol === colKey && popup.style.display === 'block') { closeFilterPopup(); return; }
  if (colKey === 'rowNum') return;
  fpLastTh = thEl || null;

  /* 候选值 = 其他列筛选 + 搜索框命中之后剩下的行。
     以前这里只做了列筛选、没管搜索框，于是会出现「表格里只剩几行、弹窗上却写着全选多少人」的矛盾。
     本列自己的筛选不复用（要让你能改） */
  let rows = getFilteredEmployees();
  const q = (document.getElementById('empSearch').value || '').toLowerCase().trim();
  if (q) rows = rows.filter(d => empMatchesSearch(d, q));
  for (const [ck, set] of Object.entries(columnFilters)) {
    if (ck === colKey || !set) continue;
    rows = rows.filter(d => set.has(empColValue(d, ck)));
  }
  const countMap = {}; let total = 0;
  rows.forEach(d => { const v = empColValue(d, colKey); if (v !== '') { countMap[v] = (countMap[v]||0)+1; total++; } });
  const entries = Object.keys(countMap).sort().map(v => ({ value:String(v), count: countMap[v] }));
  const selected = columnFilters[colKey] || new Set(entries.map(e => e.value));
  const allChecked = entries.length > 0 && selected.size === entries.length;

  /* 值列表渲染走 core.js 共享实现：日期列自动分组 年→月→日，每行 hover「仅筛此项」 */
  window.__fpOnChange = () => onFilterValChange(colKey);
  window.__fpApplyOnly = set => { resetEmpOrder(); columnFilters[colKey] = set; renderEmployeeTable(); };
  /* 排序=当前顺序上叠加：升/降即稳定排序，无清除入口（重置走筛选/搜索=新的一局） */
  popup.innerHTML =
    fpHeaderHtml(colLabel, 'closeFilterPopup()') +
    fpSortHtml(`sortEmployeeTable('${colKey}','asc')`, `sortEmployeeTable('${colKey}','desc')`) +
    `<div class="fp-body">` +
    `<label class="fp-row fp-all"><input type="checkbox" class="cb-all"${allChecked?' checked':''} onchange="toggleAllFilterVals('${colKey}',this)"><b>全选</b><span class="fp-count">${total}</span></label>` +
    fpRenderList(entries, selected, `onFilterValChange('${colKey}')`) + '</div>' +
    `<div class="fp-foot">` +
    `<button class="tb-btn" onclick="clearColumnFilter('${colKey}')">清除本列筛选</button><button class="tb-btn primary" onclick="closeFilterPopup()">应用筛选</button></div>`;

  popup.style.display = 'block';
  const rect = thEl.getBoundingClientRect();
  fpPlacePopup(popup, rect, 320, 300);
  /* 读屏可达 + 焦点进弹窗 */
  fpOpenDialog(popup, colLabel);
  filterPopupCol = colKey;
}
function closeFilterPopup() {
  const p = document.getElementById('filterPopup');
  if (p && p.style.display === 'block') {
    p.style.display = 'none';
    fpFocus(fpLastTh);   // 焦点归还触发列头
  }
  fpLastTh = null; filterPopupCol = null;
}
/* Esc 关弹窗并把焦点还给触发的列头。
   必须在这里处理：grid.js 也监听 Escape，但它走自己的 gridClosePopup，
   只认 grid 自己开的那个弹窗——员工明细的弹窗它管不着，
   此前一按 Esc 弹窗虽关、焦点却掉到 body，键盘用户就此「失踪」。
   table.js 在 grid.js 之前加载，所以这里的监听器先跑：先还焦点，后者再跑时
   弹窗已关（display 不是 block），不做事，不会打架。 */
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const p = document.getElementById('filterPopup');
  if (filterPopupCol && p && p.style.display === 'block') closeFilterPopup();
});
function onFilterValChange(colKey) {
  const popup = document.getElementById('filterPopup');
  const selected = new Set();
  /* 只认叶子（data-val）：分组节点 .cb-node 不带值，勾选状态由 fpSyncNodes 呈现 */
  popup.querySelectorAll('input[type="checkbox"][data-val]').forEach(c => { if (c.checked) selected.add(c.dataset.val); });
  resetEmpOrder();
  columnFilters[colKey] = selected;
  renderEmployeeTable();
}
function toggleAllFilterVals(colKey, cb) {
  document.querySelectorAll('#filterPopup input[type="checkbox"][data-val]').forEach(c => c.checked = cb.checked);
  onFilterValChange(colKey);
  fpSyncNodes();
}
/* dir='asc'/'desc'：在当前整表顺序上做一次稳定排序，重写覆盖层（可无限叠加） */
function sortEmployeeTable(colKey, dir) {
  if (colKey === 'rowNum') return;
  const all = rawData.slice();
  if (empOrderSeq.size) all.sort((a, b) => empOrderSeq.get(a.id) - empOrderSeq.get(b.id));
  /* Array.sort 自 ES2019 起稳定：all 已是上一次的顺序，同值行自然保持原位 */
  all.sort((a, b) => {
    const va = empSortVal(a, colKey), vb = empSortVal(b, colKey);
    let c;
    if (typeof va === 'number' && typeof vb === 'number') c = va - vb;
    else c = String(va ?? '').toLowerCase().localeCompare(String(vb ?? '').toLowerCase());
    return dir === 'asc' ? c : -c;
  });
  empOrderSeq = new Map(all.map((d, i) => [d.id, i]));
  empSortState = { field: colKey, asc: dir === 'asc' };
  closeFilterPopup(); renderEmployeeTable();
}
function clearColumnFilter(colKey) { resetEmpOrder(); delete columnFilters[colKey]; closeFilterPopup(); renderEmployeeTable(); }
function clearAllColumnFilters() { resetEmpOrder(); columnFilters = {}; closeFilterPopup(); renderEmployeeTable(); }
/* 搜索框入口（看板.html oninput）：搜索=新的一局，先重置叠序再防抖渲染 */
function empSearchInput() { resetEmpOrder(); debounceSearch(renderEmployeeTable, 200); }
/* 点外部关闭：以「按下」位置为准（mousedown 与 click 同在弹窗外才关）——
   修复「在弹窗内按下、拖到外面松开会误关」的边缘情况 */
let fpPressOutside = false;
document.addEventListener('mousedown', e => {
  const popup = document.getElementById('filterPopup');
  fpPressOutside = !!(popup && popup.style.display === 'block' && !popup.contains(e.target));
}, true);
document.addEventListener('click', e => {
  const popup = document.getElementById('filterPopup');
  if (!popup || popup.style.display !== 'block') return;
  if (popup.contains(e.target)) return;
  if (!fpPressOutside) return;   // 按下发生在弹窗内：不算外部点击
  const th = e.target.closest && e.target.closest('th');
  if (th && th.closest('table') && th.closest('#empTableWrap')) return;
  closeFilterPopup();
});

/* ── CSV 导出（与表格所见一致：应用列筛选 + 搜索 + 排序；敏感字段按需求保留） ── */
function exportEmployeeTable() {
  const rows = getEmployeeRows();
  const cols = getEmpCols();
  const keys = cols.map(c => c.key), labels = cols.map(c => c.label);
  const csv = csvText(labels, rows.map((d, idx) => keys.map(k => k === 'rowNum' ? idx + 1 : empColValue(d, k))));
  downloadCsv('员工明细', csv);
  showToast(`已导出 ${rows.length} 条（与当前表格一致）`);
}
