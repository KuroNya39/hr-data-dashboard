/* ═══════════════════════════════════════════════════════════════════════════
   hr-table.js — Employee Detail Table, Perf Table, Column Filters, CSV Export
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── DEBOUNCE ── */
let searchTimer = null;
function debounceSearch(fn, ms) {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(fn, ms);
}

/* ── PERFORMANCE TABLE ── */
function renderPerfTable() {
  const filtered = getFiltered();
  const active = filtered.filter(d=>d.status==='在职');
  const perfActive = active.filter(d=>d.hasPerf);
  document.getElementById('tableTitle').textContent = '⭐ 绩效明细';

  const q = (document.getElementById('searchInput').value||'').toLowerCase().trim();
  let rows = perfActive;
  if(q) rows = perfActive.filter(d=>(d.id||'').toLowerCase().includes(q)||(d.name||'').toLowerCase().includes(q)||(d.dept||'').toLowerCase().includes(q));

  const headers = ['工号','姓名','中心','部门','职等','终评绩效','半年前','变动','工时投入','梯队类型'];
  const fields = [(d)=>d.id,(d)=>d.name,(d)=>d.center,(d)=>d.dept,(d)=>d.level,
    (d)=>gradeTag(d.perfFinalGrade),(d)=>d.perfGrade2025Y||'—',(d)=>d.perfGradeChange||'—',
    (d)=>d.perfInputCoeff?d.perfInputCoeff.toFixed(2):'—',(d)=>d.perfTierType||'—'];

  document.getElementById('tableCount').textContent = `共 ${rows.length} 条绩效记录 (${perfActive.length} 人有绩效数据)`;
  let html = '<table><thead><tr>'+headers.map(h=>`<th>${h}</th>`).join('')+'</tr></thead><tbody>';
  rows.forEach(d=>{html+='<tr>'+fields.map(f=>`<td>${f(d)}</td>`).join('')+'</tr>';});
  html+='</tbody></table>';
  document.getElementById('tableWrap').innerHTML = html;
}

/* ── TABLE COLUMN FILTER (bottom table) — FIXED: uses getFiltered() ── */
function rebuildTableFilter() {
  const colSel = document.getElementById('tableFilterCol');
  colSel.onchange = function() {
    const valSel = document.getElementById('tableFilterVal');
    const col = this.value;
    if(col === 'all') { valSel.style.display = 'none'; renderTable(); return; }
    const keyMap = { center:'center', dept: d=>d.deptEn||d.dept, level:'level', status:'status' };
    const getKey = typeof keyMap[col] === 'function' ? keyMap[col] : d=>d[keyMap[col]];
    // FIX: use getFiltered() not rawData — interconnected slicer logic
    const filtered = getFiltered();
    const vals = [...new Set(filtered.map(getKey).filter(Boolean))].sort();
    valSel.style.display = 'inline-block';
    valSel.innerHTML = '<option value="all">全部</option>' + vals.map(v => `<option value="${v}">${v}</option>`).join('');
    valSel.value = 'all';
    renderTable();
  };
  document.getElementById('tableFilterVal').onchange = function() { renderTable(); };
}

/* ── DATA TABLE (bottom of pages) ── */
function renderTable(data) {
  if(!document.getElementById('page-performance').classList.contains('hidden')) { renderPerfTable(); return; }
  if(!document.getElementById('page-employee').classList.contains('hidden')) return; // employee page has its own table
  document.getElementById('tableTitle').textContent = '📋 员工明细';

  const filtered = data || getFiltered();
  const q = (document.getElementById('searchInput').value||'').toLowerCase().trim();
  const colFilter = document.getElementById('tableFilterCol').value;
  const colVal = document.getElementById('tableFilterVal').value;

  let rows = filtered;
  if(q) rows = rows.filter(d=>(d.id||'').toLowerCase().includes(q)||(d.name||'').toLowerCase().includes(q)||(d.dept||'').toLowerCase().includes(q)||(d.level||'').toLowerCase().includes(q)||(d.center||'').toLowerCase().includes(q));
  if(colFilter !== 'all' && colVal !== 'all') {
    const keyMap = { center:'center', dept:d=>d.deptEn||d.dept, level:'level', status:'status' };
    const getKey = typeof keyMap[colFilter] === 'function' ? keyMap[colFilter] : d=>d[keyMap[colFilter]];
    rows = rows.filter(d => getKey(d) === colVal);
  }

  const headers = ['员工编号','姓名','中心','部门','职级','子等级','状态','用工类型','学历','性别','入职日期','离职日期','绩效'];
  const keys = ['id','name','center','dept','level','subLevel','status','empType','edu','gender','joinDate','leaveDate'];
  document.getElementById('tableCount').textContent = `共 ${rows.length} 条记录`;
  let html = '<table><thead><tr>'+headers.map(h=>`<th>${h}</th>`).join('')+'</tr></thead><tbody>';
  rows.forEach(d => {
    const statusTag = d.status==='在职'?'<span class="tag tag-active">在职</span>':'<span class="tag tag-inactive">离职</span>';
    const typeClass = {'已转正':'tag-permanent','试用期':'tag-probation','签约实习生':'tag-intern-paid','非签约实习生':'tag-intern-unpaid','外包人员':'tag-outsource'}[d.empType]||'';
    const typeTag = d.empType ? `<span class="tag ${typeClass}">${d.empType}</span>` : '';
    const perfTag = d.hasPerf ? gradeTag(d.perfFinalGrade) : '<span style="color:var(--ink-muted);font-size:.64rem">—</span>';
    html += '<tr>'+keys.map(k=>{
      if(k==='status') return `<td>${statusTag}</td>`; if(k==='empType') return `<td>${typeTag}</td>`; return `<td>${d[k]||''}</td>`;
    }).join('')+`<td>${perfTag}</td></tr>`;
  });
  html += '</tbody></table>';
  document.getElementById('tableWrap').innerHTML = html;
}

/* ── EMPLOYEE TABLE (dedicated page) ── */

// Define all available columns for the employee detail page
const EMPLOYEE_TABLE_COLS = [
  { key:'rowNum', label:'序号' },
  { key:'id', label:'工号' },
  { key:'name', label:'姓名' },
  { key:'gender', label:'性别' },
  { key:'center', label:'中心' },
  { key:'dept', label:'部门' },
  { key:'deptEn', label:'部门简称' },
  { key:'position', label:'职位' },
  { key:'prevEmployer', label:'原工作单位' },
  { key:'level', label:'职级' },
  { key:'subLevel', label:'子等级' },
  { key:'talentPipeline', label:'梯队' },
  { key:'status', label:'状态' },
  { key:'empType', label:'用工类型' },
  { key:'orgType', label:'组织类型' },
  { key:'contractType', label:'合同类型' },
  { key:'workLocation', label:'工作地点' },
  { key:'edu', label:'学历' },
  { key:'school', label:'毕业学校' },
  { key:'major', label:'主修专业' },
  { key:'gradDate', label:'毕业时间' },
  { key:'hometown', label:'籍贯' },
  { key:'maritalStatus', label:'婚姻状况' },
  { key:'birthDate', label:'出生日期' },
  { key:'joinDate', label:'入职日期' },
  { key:'leaveDate', label:'离职日期' },
  { key:'tenure', label:'司龄' },
  { key:'equity', label:'股权激励' },
  { key:'source', label:'招聘来源' },
  { key:'email', label:'公司邮箱' },
];

// Deduplicate by key
const EMP_COLS = [];
const seenKeys = new Set();
EMPLOYEE_TABLE_COLS.forEach(c => {
  if(!seenKeys.has(c.key)) { seenKeys.add(c.key); EMP_COLS.push(c); }
});

/* ── Excel-style column header filter state ── */
let columnFilters = {};     // { colKey: Set(selectedValues) }
let empSortState = { field: null, asc: true };
let filterPopupCol = null;  // currently open popup column
let empPageSize = 100;        // rows per page
let empPage = 1;               // current page

function getFilteredEmployees() {
  // 不硬过滤离职，让状态筛选器控制
  const filtered = getFiltered();
  if(typeof activeAlertFilter === 'function') return filtered.filter(d => activeAlertFilter(d));
  return filtered;
}

function renderEmployeeTable(sortByField) {
  const q = (document.getElementById('empSearch').value||'').toLowerCase().trim();
  let rows = getFilteredEmployees();

  for(const [colKey, selectedSet] of Object.entries(columnFilters)) {
    if(selectedSet && selectedSet.size > 0) {
      rows = rows.filter(d => {
        const v = d[colKey];
        return v != null && v !== '' && selectedSet.has(String(v));
      });
    }
  }

  if(q) rows = rows.filter(d => {
    const searchFields = [d.id, d.name, d.dept, d.level, d.center, d.position, d.school, d.major];
    return searchFields.some(f => f && f.toLowerCase().includes(q));
  });

  if(sortByField) {
    if(empSortState.field === sortByField) {
      empSortState.asc = !empSortState.asc;
    } else {
      empSortState.field = sortByField;
      empSortState.asc = true;
    }
  }

  if(empSortState.field) {
    const sf = empSortState.field;
    const asc = empSortState.asc;
    if(sf === 'rowNum') { /* 序号不排序 */ }
    else rows.sort((a, b) => {
      let va = a[sf], vb = b[sf];
      if(va == null) va = ''; if(vb == null) vb = '';
      if(sf === 'tenure') { va = calcTenure(a.joinDate); vb = calcTenure(b.joinDate); }
      if(typeof va === 'number' && typeof vb === 'number') return asc ? va - vb : vb - va;
      va = String(va).toLowerCase(); vb = String(vb).toLowerCase();
      return asc ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }

  // Alert banner
  const showAlertBanner = activeAlertTitle && typeof activeAlertFilter === 'function' ?
    '<div style="display:flex;align-items:center;gap:10px;padding:7px 12px;background:color-mix(in srgb,var(--s1) 8%,var(--surface));border-radius:var(--radius-sm);border-left:3px solid var(--s1);font-size:.72rem;width:100%">' +
      '<span style="font-weight:600;color:var(--ink);white-space:nowrap">🔍 预警筛选：「' + activeAlertTitle + '」</span>' +
      '<span style="color:var(--ink-secondary);flex-shrink:0">— 共 ' + rows.length + ' 人符合条件</span>' +
      '<button onclick="clearAlertFilter();renderEmployeeTable()" style="margin-left:auto;font-size:.66rem;padding:2px 8px;border-radius:4px;border:1px solid var(--baseline);background:var(--surface);color:var(--ink-secondary);cursor:pointer;white-space:nowrap;flex-shrink:0">✕ 清除筛选</button>' +
    '</div>' : '';
  const bannerContainer = document.getElementById('empAlertBanner');
  if(bannerContainer) bannerContainer.innerHTML = showAlertBanner;

  const activeCount = rows.filter(d => d.status === '在职').length;
  const leaverCount = rows.filter(d => d.status === '离职').length;

  // ── Pagination ──
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / empPageSize));
  if (empPage > totalPages) empPage = totalPages;
  if (empPage < 1) empPage = 1;
  const start = (empPage - 1) * empPageSize;
  const pageRows = rows.slice(start, start + empPageSize);

  document.getElementById('empTableCount').textContent = '共 ' + total + ' 条记录 · 在职 ' + activeCount + ' 人 · 离职 ' + leaverCount + ' 人 · 第' + empPage + '/' + totalPages + '页';

  const activeFilterCount = Object.keys(columnFilters).length;
  const hintEl = document.getElementById('empFilterHint');
  if(hintEl) hintEl.textContent = activeFilterCount > 0 ? activeFilterCount + ' 列已筛选' : '';

  const headers = EMP_COLS.map(c => c.label);
  const keys = EMP_COLS.map(c => c.key);

  function sortArrow(key) {
    if(empSortState.field !== key) return '';
    return empSortState.asc ? ' ▲' : ' ▼';
  }

  function filterIcon(key) {
    if(columnFilters[key] && columnFilters[key].size > 0) return ' 🗸';
    return '';
  }

  let html = '<table><thead><tr>'+headers.map((h, i) => {
    const k = keys[i];
    return '<th onclick="toggleFilterPopup(\'' + k + '\',\'' + h + '\',this)" style="cursor:pointer;user-select:none">' + h + sortArrow(k) + filterIcon(k) + '</th>';
  }).join('')+'</tr></thead><tbody>';

  pageRows.forEach((d, i) => {
    html += '<tr>' + keys.map(k => {
      if(k === 'rowNum') {
        return '<td>' + (start + i + 1) + '</td>';
      }
      if(k === 'status') {
        return '<td>' + (d.status==='在职' ? '<span class="tag tag-active">在职</span>' : '<span class="tag tag-inactive">离职</span>') + '</td>';
      }
      if(k === 'empType') {
        const cls = {'已转正':'tag-permanent','试用期':'tag-probation','签约实习生':'tag-intern-paid','非签约实习生':'tag-intern-unpaid','外包人员':'tag-outsource'}[d.empType]||'';
        return d.empType ? '<td><span class="tag ' + cls + '">' + d.empType + '</span></td>' : '<td>—</td>';
      }
      if(k === 'tenure') {
        const t = calcTenure(d.joinDate);
        return '<td>' + (t > 0 ? t.toFixed(1)+'年' : '—') + '</td>';
      }
      if(k === 'deptEn') {
        return '<td>' + (d.deptEn || '—') + '</td>';
      }
      if(k === 'perfFinalGrade') {
        return d.hasPerf ? '<td>' + gradeTag(d.perfFinalGrade) + '</td>' : '<td>—</td>';
      }
      return '<td>' + (d[k] != null && d[k] !== '' ? d[k] : '—') + '</td>';
    }).join('') + '</tr>';
  });
  html += '</tbody></table>';

  // Page controls
  html += '<div style="display:flex;align-items:center;gap:6px;justify-content:center;padding:8px 0;font-size:.72rem">';
  html += '<button onclick="empGoToPage(1)" style="padding:2px 8px;border:1px solid var(--baseline);border-radius:4px;background:var(--surface);color:var(--ink);cursor:pointer">«</button>';
  html += '<button onclick="empGoToPage(empPage-1)" style="padding:2px 8px;border:1px solid var(--baseline);border-radius:4px;background:var(--surface);color:var(--ink);cursor:pointer">‹</button>';
  html += '<select onchange="empGoToPage(parseInt(this.value))" style="font:inherit;font-size:.72rem;padding:2px 4px;border:1px solid var(--baseline);border-radius:4px;background:var(--surface);color:var(--ink);cursor:pointer">';
  for (let i = 1; i <= totalPages; i++) {
    html += '<option value="' + i + '"' + (i === empPage ? ' selected' : '') + '>第' + i + '页</option>';
  }
  html += '</select>';
  html += '<button onclick="empGoToPage(empPage+1)" style="padding:2px 8px;border:1px solid var(--baseline);border-radius:4px;background:var(--surface);color:var(--ink);cursor:pointer">›</button>';
  html += '<button onclick="empGoToPage(totalPages)" style="padding:2px 8px;border:1px solid var(--baseline);border-radius:4px;background:var(--surface);color:var(--ink);cursor:pointer">»</button>';
  html += '<span style="color:var(--ink-muted);margin-left:4px">每页</span>';
  html += '<select onchange="empPageSize=parseInt(this.value);empPage=1;renderEmployeeTable()" style="font:inherit;font-size:.72rem;padding:2px 4px;border:1px solid var(--baseline);border-radius:4px;background:var(--surface);color:var(--ink);cursor:pointer">';
  [50, 100, 200, 500].forEach(function(s) { html += '<option value="' + s + '"' + (s === empPageSize ? ' selected' : '') + '>' + s + '</option>'; });
  html += '</select><span style="color:var(--ink-muted)">条</span>';
  html += '</div>';

  document.getElementById('empTableWrap').innerHTML = html;
}

function empGoToPage(p) {
  empPage = p;
  renderEmployeeTable();
}

/* ── Excel-style filter popup ── */
function toggleFilterPopup(colKey, colLabel, thEl) {
  const popup = document.getElementById('filterPopup');
  if(!popup) return;

  // Close if clicking the same column
  if(filterPopupCol === colKey && popup.style.display === 'block') {
    closeFilterPopup(); return;
  }

  const { entries, total } = getColumnValuesWithCount(colKey);
  const selectedSet = columnFilters[colKey] || new Set(entries.map(e => e.value));
  const allChecked = entries.length > 0 && selectedSet.size === entries.length;

  let valHtml = entries.map(e => {
    const sv = String(e.value).replace(/"/g,'&quot;');
    const checked = selectedSet.has(String(e.value)) ? 'checked' : '';
    return `<label style="display:flex;align-items:center;gap:4px;padding:2px 8px;cursor:pointer;white-space:nowrap;font-size:.7rem">
      <input type="checkbox" value="${sv}" ${checked} onchange="onFilterValChange('${colKey}')">
      <span style="flex:1">${e.value}</span>
      <span style="color:var(--ink-muted);font-size:.64rem;flex-shrink:0">${e.count}</span>
    </label>`;
  }).join('');

  popup.innerHTML = `
    <div style="padding:6px 8px;border-bottom:1px solid var(--baseline);font-weight:600;font-size:.74rem;display:flex;justify-content:space-between;align-items:center">
      <span>${colLabel}</span>
      <span onclick="closeFilterPopup()" style="cursor:pointer;opacity:.5;font-size:.8rem">✕</span>
    </div>
    <div style="padding:4px 0;border-bottom:1px solid var(--baseline)">
      <button onclick="sortEmployeeTable('${colKey}','asc')" style="display:block;width:100%;text-align:left;padding:3px 8px;border:none;background:none;cursor:pointer;font:inherit;font-size:.7rem;color:var(--ink)">▲ 升序</button>
      <button onclick="sortEmployeeTable('${colKey}','desc')" style="display:block;width:100%;text-align:left;padding:3px 8px;border:none;background:none;cursor:pointer;font:inherit;font-size:.7rem;color:var(--ink)">▼ 降序</button>
    </div>
    <div style="padding:4px 0;max-height:240px;overflow-y:auto">
      <label style="display:flex;align-items:center;gap:4px;padding:2px 8px;cursor:pointer;border-bottom:1px solid var(--gridline);font-size:.7rem">
        <input type="checkbox" class="cb-select-all" ${allChecked ? 'checked' : ''} onchange="toggleAllFilterVals('${colKey}',this)">
        <span style="flex:1;font-weight:500">全选</span>
        <span style="color:var(--ink-muted);font-size:.64rem;flex-shrink:0">${total}</span>
      </label>
      ${valHtml}
    </div>
    <div style="padding:4px 8px;border-top:1px solid var(--baseline);display:flex;gap:6px;justify-content:flex-end">
      <button onclick="clearColumnFilter('${colKey}')" style="font-size:.66rem;padding:2px 6px;border:1px solid var(--baseline);border-radius:3px;background:var(--surface);color:var(--ink-secondary);cursor:pointer">清除</button>
      <button onclick="closeFilterPopup()" style="font-size:.66rem;padding:2px 10px;border:none;border-radius:3px;background:var(--s1);color:#fff;cursor:pointer">确定</button>
    </div>`;

  popup.style.display = 'block';
  const rect = thEl.getBoundingClientRect();
  popup.style.left = Math.min(rect.left, window.innerWidth - 320) + 'px';
  popup.style.top = (rect.bottom + 2) + 'px';
  popup.style.maxHeight = '360px';
  filterPopupCol = colKey;
}

function getColumnValues(colKey) {
  if(colKey === 'rowNum') return [];
  const rows = getFilteredEmployees();
  return [...new Set(rows.map(d => d[colKey]).filter(v => v != null && v !== ''))].sort();
}

function getColumnValuesWithCount(colKey) {
  if(colKey === 'rowNum') return { entries:[], total:0 };
  // Apply all column filters EXCEPT the current one (so opening a popup shows
  // counts reflecting the effect of other column filters, but not self-filter)
  let rows = getFilteredEmployees();
  for(const [ck, selectedSet] of Object.entries(columnFilters)) {
    if(ck === colKey) continue;
    if(selectedSet && selectedSet.size > 0) {
      rows = rows.filter(d => {
        const v = d[ck];
        return v != null && v !== '' && selectedSet.has(String(v));
      });
    }
  }
  const countMap = {};
  let total = 0;
  rows.forEach(d => {
    const v = d[colKey];
    if(v != null && v !== '') {
      countMap[v] = (countMap[v] || 0) + 1;
      total++;
    }
  });
  const entries = Object.keys(countMap).sort().map(v => ({value: v, count: countMap[v]}));
  return { entries, total };
}

function closeFilterPopup() {
  const popup = document.getElementById('filterPopup');
  if(popup) popup.style.display = 'none';
  filterPopupCol = null;
}

function onFilterValChange(colKey) {
  const popup = document.getElementById('filterPopup');
  if(!popup) return;
  const checks = popup.querySelectorAll('input[type="checkbox"]:not(.cb-select-all)');
  const selected = new Set();
  checks.forEach(c => { if(c.checked) selected.add(c.value); });
  columnFilters[colKey] = selected;
  renderEmployeeTable();
}

function toggleAllFilterVals(colKey, cb) {
  const popup = document.getElementById('filterPopup');
  if(!popup) return;
  const checks = popup.querySelectorAll('input[type="checkbox"]:not(.cb-select-all)');
  if(cb.checked) {
    // 全选 → 全部勾上
    checks.forEach(c => c.checked = true);
  } else {
    // 取消全选 → 全部取消（标准的全选/全不选行为）
    checks.forEach(c => c.checked = false);
  }
  onFilterValChange(colKey);
}

function sortEmployeeTable(colKey, dir) {
  empSortState.field = colKey;
  empSortState.asc = (dir === 'asc');
  closeFilterPopup();
  renderEmployeeTable();
}

function clearColumnFilter(colKey) {
  delete columnFilters[colKey];
  closeFilterPopup();
  renderEmployeeTable();
}

function clearAllColumnFilters() {
  columnFilters = {};
  closeFilterPopup();
  renderEmployeeTable();
}

/* ── CSV EXPORT ── */
function exportEmployeeTable() {
  const filtered = getFiltered();
  const q = (document.getElementById('empSearch').value||'').toLowerCase().trim();
  let rows = filtered;
  if(typeof activeAlertFilter === 'function') {
    rows = rows.filter(d => activeAlertFilter(d));
  }
  if(q) rows = rows.filter(d => {
    const searchFields = [d.id, d.name, d.dept, d.level, d.center, d.position, d.school, d.major];
    return searchFields.some(f => f && f.toLowerCase().includes(q));
  });

  const keys = EMP_COLS.map(c => c.key);
  const labels = EMP_COLS.map(c => c.label);

  // Build CSV content
  const BOM = '﻿';
  let csv = BOM + labels.join(',') + '\n';
  rows.forEach((d, idx) => {
    const row = keys.map(k => {
      let val = d[k];
      if(k === 'rowNum') { val = idx + 1; }
      else if(k === 'tenure') { val = calcTenure(d.joinDate).toFixed(1) + '年'; }
      else if(val == null || val === '') val = '';
      // Escape CSV: wrap in quotes if contains comma or quote
      const s = String(val);
      if(s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }).join(',');
    csv += row + '\n';
  });

  const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `员工明细_${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

/* ── Click outside to close filter popup ── */
document.addEventListener('click', function(e) {
  const popup = document.getElementById('filterPopup');
  if(!popup || popup.style.display !== 'block') return;
  // Don't close if clicking inside the popup
  if(popup.contains(e.target)) return;
  // Don't close if clicking a table header (the popup will reopen on that column)
  if(e.target.closest('th') && e.target.closest('th').closest('table')) return;
  closeFilterPopup();
});
