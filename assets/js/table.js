/* ═══════════════════════════════════════════════════════════════
   v8 table.js — 员工明细表 · 列筛选弹窗 · 排序 · 分页 · CSV 导出
   v8 新增：人群列（正式/实习/外协），与看板口径一致
   ═══════════════════════════════════════════════════════════════ */

let searchTimer = null;
function debounceSearch(fn, ms) { if (searchTimer) clearTimeout(searchTimer); searchTimer = setTimeout(fn, ms); }

const EMP_COLS = [
  { key:'rowNum', label:'序号' }, { key:'id', label:'工号' }, { key:'name', label:'姓名' },
  { key:'gender', label:'性别' }, { key:'status', label:'状态' }, { key:'group', label:'人群' }, { key:'empType', label:'用工类型' },
  { key:'center', label:'中心' }, { key:'dept', label:'部门' }, { key:'deptEn', label:'部门简称' },
  { key:'position', label:'职位' }, { key:'jobFamily', label:'职类' },
  { key:'level', label:'职级' }, { key:'subLevel', label:'子等级' },
  { key:'mgmtLevel', label:'管理通道职等' }, { key:'talentPipeline', label:'梯队' },
  { key:'workLocation', label:'工作地点' }, { key:'orgType', label:'组织类型' },
  { key:'contractType', label:'合同类型' }, { key:'contractStart', label:'合同开始' }, { key:'contractEnd', label:'合同结束' },
  { key:'joinDate', label:'入职日期' }, { key:'confirmDate', label:'转正日期' },
  { key:'leaveDate', label:'离职日期' }, { key:'tenure', label:'司龄' },
  { key:'edu', label:'学历' }, { key:'school', label:'毕业学校' }, { key:'major', label:'主修专业' }, { key:'gradDate', label:'毕业时间' },
  { key:'industryYears', label:'行业年限' }, { key:'firstWorkDate', label:'首次工作' },
  { key:'hometown', label:'籍贯' }, { key:'maritalStatus', label:'婚姻状况' }, { key:'birthDate', label:'出生日期' },
  { key:'equity', label:'股权激励' }, { key:'source', label:'招聘来源' }, { key:'mentor', label:'导师' },
  { key:'email', label:'公司邮箱' }, { key:'payGroup', label:'工资组' },
  { key:'perfFinal', label:'最新绩效' }, { key:'perfRank', label:'推荐排名' }, { key:'perfCoeff', label:'投入系数' },
  { key:'duty', label:'工作内容' },   // 来自 Excel「工作分工」sheet，按工号 join；没填内容的整列为空
];

let columnFilters = {};
let empSortState = { field:null, asc:true };
let filterPopupCol = null;
let empPageSize = 100, empPage = 1, empTotalPages = 1;

/* 每列「值」的唯一定义处：列筛选、筛选弹窗、排序、CSV 全部走它。
   否则同一个格子会出现「表格里有值、弹窗里却是全选 0」——
   tenure / perfFinal / perfRank / perfCoeff 这几列不是员工对象上的直接字段，
   是从 joinDate / perf 里算出来的，各写一份必然对不齐。
   返回的字符串就是用户在单元格里看到的那个词（不含标签色） */
function empColValue(d, k) {
  switch (k) {
    case 'rowNum': return '';
    case 'group': return GROUP_SHORT[staffGroupOf(d)] || '';
    case 'tenure': { const t = calcTenure(d.joinDate); return t > 0 ? t.toFixed(1) + '年' : ''; }
    case 'perfFinal': return d.hasPerf ? (latestGrade(d.perf) || '') : '';
    case 'perfRank': return (d.perf && d.perf.rank) || '';
    case 'perfCoeff': return (d.perf && d.perf.inputCoeff) ? d.perf.inputCoeff.toFixed(2) : '';
    case 'duty': return (typeof dsData !== 'undefined' && dsData.dutyMap && dsData.dutyMap[d.id]) || '';
    default: { const v = d[k]; return v == null || v === '' ? '' : String(v); }
  }
}

/* 搜索框命中的字段（渲染、弹窗、导出共用同一套，别在三处各写一份列表） */
const EMP_SEARCH_FIELDS = ['id','name','dept','level','center','position','school','major','workLocation'];
function empMatchesSearch(d, q) {
  return EMP_SEARCH_FIELDS.some(f => d[f] && String(d[f]).toLowerCase().includes(q));
}

function getFilteredEmployees() {
  const filtered = getFiltered();
  if (typeof activeAlertFilter === 'function') return filtered.filter(d => activeAlertFilter(d));
  return filtered;
}

/* 统一取数管道：全局筛选 → 预警 → 列筛选 → 搜索 → 排序（渲染与导出共用，保证所见即所得） */
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
  if (empSortState.field) {
    const sf = empSortState.field, asc = empSortState.asc;
    if (sf !== 'rowNum') rows = rows.slice().sort((a, b) => {
      let va, vb;
      if (sf === 'tenure') { va = calcTenure(a.joinDate); vb = calcTenure(b.joinDate); }
      else if (sf === 'industryYears') { va = a.industryYears ?? -1; vb = b.industryYears ?? -1; }
      else if (sf === 'perfFinal') { va = (a.hasPerf ? gradeScore(latestGrade(a.perf)) : null) ?? -1; vb = (b.hasPerf ? gradeScore(latestGrade(b.perf)) : null) ?? -1; }
      else if (sf === 'perfCoeff') { va = (a.perf && a.perf.inputCoeff) || -1; vb = (b.perf && b.perf.inputCoeff) || -1; }
      else { va = empColValue(a, sf); vb = empColValue(b, sf); }
      if (typeof va === 'number' && typeof vb === 'number') return asc ? va - vb : vb - va;
      va = String(va ?? '').toLowerCase(); vb = String(vb ?? '').toLowerCase();
      return asc ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }
  return rows;
}

function renderEmployeeTable(sortByField) {
  if (sortByField) {
    if (empSortState.field === sortByField) empSortState.asc = !empSortState.asc;
    else { empSortState.field = sortByField; empSortState.asc = true; }
  }
  const rows = getEmployeeRows();

  // 预警筛选横幅
  const banner = document.getElementById('empAlertBanner');
  if (banner) banner.innerHTML = activeAlertTitle && typeof activeAlertFilter === 'function'
    ? `<div class="emp-banner">` +
      `<b>预警筛选：「${esc(activeAlertTitle)}」</b><span class="emp-banner-n">共 ${rows.length} 人</span>` +
      `<button class="link-btn" onclick="clearAlertFilter()"><span class="mi">close</span> 清除</button></div>` : '';

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

  const keys = EMP_COLS.map(c => c.key), labels = EMP_COLS.map(c => c.label);
  let html = '<table><thead><tr>' + labels.map((h, i) => {
    const k = keys[i];
    /* 序号列不可筛（toggleFilterPopup 会直接 return）：不能给它指针光标、
       不能给它 tabindex、也不能给它漏斗图标 —— 三样都是「点了有用」的假承诺（G3/G11）。 */
    if (k === 'rowNum') return `<th data-nofilter>${esc(h)}</th>`;
    const arrow = empSortState.field === k ? `<span class="mi">${empSortState.asc ? 'arrow_upward' : 'arrow_downward'}</span>` : '';
    const icon = columnFilters[k] ? '<span class="mi">check</span>' : '';
    return `<th class="th-sort" tabindex="0" onclick="toggleFilterPopup('${k}','${esc(h)}',this)">${esc(h)}${arrow}${icon}</th>`;
  }).join('') + '</tr></thead><tbody>';

  pageRows.forEach((d, i) => {
    html += '<tr>' + keys.map(k => {
      if (k === 'rowNum') return `<td>${start + i + 1}</td>`;
      if (k === 'status') return d.status === '在职' ? '<td><span class="tag tag-active">在职</span></td>' : '<td><span class="tag tag-inactive">离职</span></td>';
      if (k === 'group') {
        const g = staffGroupOf(d);
        const cls = { formal:'tag-permanent', intern:'tag-intern-paid', outsource:'tag-outsource' }[g] || '';
        return `<td><span class="tag ${cls}">${esc(GROUP_SHORT[g] || '—')}</span></td>`;
      }
      if (k === 'empType') {
        const cls = { '已转正':'tag-permanent','试用期':'tag-probation','签约实习生':'tag-intern-paid','非签约实习生':'tag-intern-unpaid','外包人员':'tag-outsource','劳务人员':'tag-labor' }[d.empType] || '';
        return d.empType ? `<td><span class="tag ${cls}">${esc(d.empType)}</span></td>` : '<td>—</td>';
      }
      if (k === 'tenure') { const t = calcTenure(d.joinDate); return `<td>${t > 0 ? t.toFixed(1) + '年' : '—'}</td>`; }
      if (k === 'perfFinal') return d.hasPerf ? `<td>${gradeTag(latestGrade(d.perf))}</td>` : '<td>—</td>';
      if (k === 'perfRank') return `<td>${esc(d.perf && d.perf.rank) || '—'}</td>`;
      if (k === 'perfCoeff') return `<td>${d.perf && d.perf.inputCoeff ? d.perf.inputCoeff.toFixed(2) : '—'}</td>`;
      if (k === 'duty') {
        const v = (typeof dsData !== 'undefined' && dsData.dutyMap && dsData.dutyMap[d.id]) || '';
        return `<td class="wrap">${v ? esc(v) : '—'}</td>`;
      }
      const v = d[k];
      return `<td>${v != null && v !== '' ? esc(v) : '—'}</td>`;
    }).join('') + '</tr>';
  });
  html += '</tbody></table>';

  // 分页控件（totalPages 用全局 empTotalPages，修复 v6 局部变量 bug）
  html += '<div class="pg-bar">';
  html += `<button class="tb-btn" onclick="empGoToPage(1)" aria-label="第一页"><span class="mi">first_page</span></button><button class="tb-btn" onclick="empGoToPage(empPage-1)" aria-label="上一页"><span class="mi">chevron_left</span></button>`;
  html += `<select class="pg-select" aria-label="跳到第几页" onchange="empGoToPage(parseInt(this.value))">` +
    Array.from({length: empTotalPages}, (_, i) => `<option value="${i+1}"${i+1===empPage?' selected':''}>第 ${i+1} 页</option>`).join('') + '</select>';
  html += `<button class="tb-btn" onclick="empGoToPage(empPage+1)" aria-label="下一页"><span class="mi">chevron_right</span></button><button class="tb-btn" onclick="empGoToPage(empTotalPages)" aria-label="最后一页"><span class="mi">last_page</span></button>`;
  html += `<span class="dim">每页</span><select class="pg-select" aria-label="每页显示条数" onchange="empPageSize=parseInt(this.value);empPage=1;renderEmployeeTable()">` +
    [50,100,200,500].map(s => `<option value="${s}"${s===empPageSize?' selected':''}>${s}</option>`).join('') + '</select><span class="dim">条</span></div>';

  document.getElementById('empTableWrap').innerHTML = html;
}
function empGoToPage(p) {
  empPage = Math.min(Math.max(1, p), empTotalPages);
  renderEmployeeTable();
}

/* ── Excel 风格列筛选弹窗 ── */
let fpLastTh = null;
function toggleFilterPopup(colKey, colLabel, thEl) {
  const popup = document.getElementById('filterPopup');
  if (!popup) return;
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
  window.__fpApplyOnly = set => { columnFilters[colKey] = set; renderEmployeeTable(); };
  popup.innerHTML =
    fpHeaderHtml(colLabel, 'closeFilterPopup()') +
    `<div class="fp-sort"><button class="fp-sort-btn" onclick="sortEmployeeTable('${colKey}','asc')"><span class="mi">arrow_upward</span> 升序</button>` +
    `<button class="fp-sort-btn" onclick="sortEmployeeTable('${colKey}','desc')"><span class="mi">arrow_downward</span> 降序</button></div>` +
    `<div class="fp-body">` +
    `<label class="fp-row fp-all"><input type="checkbox" class="cb-all"${allChecked?' checked':''} onchange="toggleAllFilterVals('${colKey}',this)"><b>全选</b><span class="fp-count">${total}</span></label>` +
    fpRenderList(entries, selected, `onFilterValChange('${colKey}')`) + '</div>' +
    `<div class="fp-foot">` +
    `<button class="tb-btn" onclick="clearColumnFilter('${colKey}')">清除</button><button class="tb-btn primary" onclick="closeFilterPopup()">确定</button></div>`;

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
function onFilterValChange(colKey) {
  const popup = document.getElementById('filterPopup');
  const selected = new Set();
  /* 只认叶子（data-val）：分组节点 .cb-node 不带值，勾选状态由 fpSyncNodes 呈现 */
  popup.querySelectorAll('input[type="checkbox"][data-val]').forEach(c => { if (c.checked) selected.add(c.dataset.val); });
  columnFilters[colKey] = selected;
  renderEmployeeTable();
}
function toggleAllFilterVals(colKey, cb) {
  document.querySelectorAll('#filterPopup input[type="checkbox"][data-val]').forEach(c => c.checked = cb.checked);
  onFilterValChange(colKey);
  fpSyncNodes();
}
function sortEmployeeTable(colKey, dir) { empSortState.field = colKey; empSortState.asc = dir === 'asc'; closeFilterPopup(); renderEmployeeTable(); }
function clearColumnFilter(colKey) { delete columnFilters[colKey]; closeFilterPopup(); renderEmployeeTable(); }
function clearAllColumnFilters() { columnFilters = {}; closeFilterPopup(); renderEmployeeTable(); }
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
  const keys = EMP_COLS.map(c => c.key), labels = EMP_COLS.map(c => c.label);
  const csv = csvText(labels, rows.map((d, idx) => keys.map(k => k === 'rowNum' ? idx + 1 : empColValue(d, k))));
  downloadCsv('员工明细', csv);
  showToast(`已导出 ${rows.length} 条（与当前表格一致）`);
}
