/* ═══════════════════════════════════════════════════════════════════════════
   hr-data.js — File Upload, Parsing, Filters, Page Switching, RefreshAll
   ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   AUTO-LOAD — 通过 HTTP 服务器自动加载同文件夹的 Excel 文件
   ═══════════════════════════════════════════════════════════════════════════ */
(function autoLoadFromServer() {
  // 仅在通过本地 HTTP 服务器访问时自动加载
  if (window.location.protocol !== 'http:' &&
      window.location.protocol !== 'https:') return;
  const host = window.location.hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') return;

  fetch('/api/list-excel').then(r => {
    if (!r.ok) throw new Error('API 不可用');
    return r.json();
  }).then(async filenames => {
    if (!filenames || !filenames.length) {
      console.log('未在文件夹中找到 Excel 文件');
      return;
    }
    const xlsxFiles = [];
    for (const name of filenames) {
      const low = name.toLowerCase();
      if (low.endsWith('.xlsx') || low.endsWith('.xls')) {
        xlsxFiles.push(name);
      }
    }
    if (!xlsxFiles.length) return;

    let pending = xlsxFiles.length;
    let foundEmpData = false;
    let perfCount = 0;

    for (const fileName of xlsxFiles) {
      try {
        const resp = await fetch('/' + encodeURIComponent(fileName));
        if (!resp.ok) continue;
        const buf = await resp.arrayBuffer();
        const wb = XLSX.read(new Uint8Array(buf), {type:'array', cellDates:false});
        let isEmpData = false;

        // 尝试识别为员工数据
        for (const name of wb.SheetNames) {
          const ws = wb.Sheets[name];
          const json = XLSX.utils.sheet_to_json(ws, {raw:true, defval:''});
          if (json && json.length >= 3) {
            const rows = json.map(parseRow).filter(d => d.id && d.name);
            if (rows.length > 0) {
              isEmpData = true;
              if (!foundEmpData) {
                rawData = rows;
                foundEmpData = true;
              } else {
                const existingIds = new Set(rawData.map(d => d.id));
                for (const r of rows) {
                  if (!existingIds.has(r.id)) { rawData.push(r); existingIds.add(r.id); }
                }
              }
              break;
            }
          }
        }

        // Try as performance data
        if (!isEmpData || fileName.toLowerCase().includes('绩效') || fileName.toLowerCase().includes('perf')) {
          const nc = parsePerfWorkbook(wb);
          if (nc > 0) { perfCount += nc; perfFileLoaded = true; }
        }
      } catch (err) {
        console.error('读取失败:', fileName, err.message);
      }
      pending--;
      if (pending === 0) {
        if (foundEmpData) {
          if (perfCount > 0) {
            perfFileCount += perfCount;
            document.getElementById('perfDot').className = 'btn-dot loaded';
            document.getElementById('perfBadge').style.display = 'inline';
            document.getElementById('uploadPerfStatus').classList.add('show');
            document.getElementById('uploadPerfStatus').textContent = `已加载 ${perfCount} 条绩效记录`;
            document.getElementById('perfCount').textContent = `绩效数据 ${perfCount} 条`;
            attachPerfData();
          }
          onDataLoaded();
          console.log('✅ 自动加载完成:', rawData.length, '条员工数据,', perfCount, '条绩效数据');
        } else {
          console.log('未能从文件夹中找到有效数据，请检查 Excel 文件格式。');
        }
      }
    }
  }).catch(err => {
    console.log('服务器自动加载不可用，使用手动模式。');
    console.debug(err);
  });
})();

/* ── UPLOAD — 员工数据文件 ── */
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');
const folderPicker = document.getElementById('folderPicker');
uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault(); uploadZone.classList.remove('dragover');
  if(e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', e => { if(e.target.files[0]) handleFile(e.target.files[0]); });
folderPicker.addEventListener('change', e => {
  if(e.target.files && e.target.files.length) handleFolderFiles(e.target.files);
});

/* ── FOLDER LOAD — auto-scan all Excel files in a folder ── */
function handleFolderFiles(files) {
  const xlsxFiles = [];
  for(const f of files) {
    const name = f.name.toLowerCase();
    if(name.endsWith('.xlsx') || name.endsWith('.xls')) xlsxFiles.push(f);
  }
  if(!xlsxFiles.length) { alert('文件夹中未找到 Excel 文件'); return; }

  let pending = xlsxFiles.length;
  let foundEmpData = false;
  let perfCount = 0;

  for(const file of xlsxFiles) {
    const reader = new FileReader();
    reader._file = file;
    reader.onload = function(ev) {
      try {
        const buf = new Uint8Array(ev.target.result);
        const wb = XLSX.read(buf, {type:'array', cellDates:false});
        let isEmpData = false;

        // 优先尝试识别为员工数据
        for(const name of wb.SheetNames) {
          const ws = wb.Sheets[name];
          const json = XLSX.utils.sheet_to_json(ws, {raw:true, defval:''});
          if(json && json.length >= 3) {
            const rows = json.map(parseRow).filter(d => d.id && d.name);
            if(rows.length > 0) {
              isEmpData = true;
              if(!foundEmpData) {
                rawData = rows;
                foundEmpData = true;
              } else {
                // 合并多份员工数据（按工号去重）
                const existingIds = new Set(rawData.map(d => d.id));
                for(const r of rows) {
                  if(!existingIds.has(r.id)) { rawData.push(r); existingIds.add(r.id); }
                }
              }
              break;
            }
          }
        }

        // 若非员工数据（或文件名含绩效标识），尝试作为绩效数据
        if(!isEmpData || file.name.toLowerCase().includes('绩效') || file.name.toLowerCase().includes('perf')) {
          const nc = parsePerfWorkbook(wb);
          if(nc > 0) { perfCount += nc; perfFileLoaded = true; }
        }
      } catch(err) { console.error('读取失败:', file.name, err.message); }
      pending--;
      if(pending === 0) {
        if(foundEmpData) {
          if(perfCount > 0) {
            perfFileCount += perfCount;
            document.getElementById('perfDot').className = 'btn-dot loaded';
            document.getElementById('perfBadge').style.display = 'inline';
            document.getElementById('uploadPerfStatus').classList.add('show');
            document.getElementById('uploadPerfStatus').textContent = `已加载 ${perfCount} 条绩效记录`;
            document.getElementById('perfCount').textContent = `绩效数据 ${perfCount} 条`;
            attachPerfData();
          }
          onDataLoaded();
        } else {
          alert('未能从文件夹中找到有效数据，请检查 Excel 文件格式。');
        }
      }
    };
    reader.readAsArrayBuffer(file);
  }
}

function handleFile(file) {
  if(!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, {type:'array', cellDates:false});
      for(const name of wb.SheetNames) {
        const ws = wb.Sheets[name];
        const json = XLSX.utils.sheet_to_json(ws, {raw:true, defval:''});
        if(json && json.length >= 3) {
          rawData = json.map(parseRow).filter(d => d.id && d.name);
          if(rawData.length > 0) break;
        }
      }
      if(rawData.length === 0) { alert('未能找到有效数据，请检查 Excel 文件格式。'); return; }
      onDataLoaded();
    } catch(err) { alert('读取文件出错：'+err.message); }
  };
  reader.readAsArrayBuffer(file);
}

function parseRow(row) {
  const r = {};
  for(const [ch, val] of Object.entries(row)) {
    const key = FIELD_MAP[ch] || ch;
    r[key] = val;
  }
  // 合并重复列组的数据（导出的多组重复列，SheetJS 加 _1~_5 后缀）
  if(!r.prevEmployer) {
    for(let i=1;i<=5;i++) { const v = r['原工作单位#_'+i]; if(v) { r.prevEmployer=v; break; } }
  }
  if(!r.school) {
    for(let i=1;i<=4;i++) { const v = r['毕业学校#_'+i]; if(v) { r.school=v; break; } }
  }
  if(!r.major) {
    for(let i=1;i<=4;i++) { const v = r['主修专业#_'+i]; if(v) { r.major=v; break; } }
  }
  if(!r.gradDate) {
    for(let i=1;i<=4;i++) { const v = r['毕业时间#_'+i]; if(v) { r.gradDate=v; break; } }
  }
  if(r.status === 'N' || r.status === '在职') r.status = '在职';
  else if(r.status === 'T' || r.status === '离职' || r.status === '已离职') r.status = '离职';
  else if(r.status === '试用') r.status = '在职';
  if(!r.status) r.status = '在职';
  r.joinDate = parseExcelDate(r.joinDate);
  r.leaveDate = parseExcelDate(r.leaveDate);
  r.birthDate = parseExcelDate(r.birthDate);
  r.gradDate = parseExcelDate(r.gradDate);
  if(r.birthDate) { const d = new Date(r.birthDate); if(!isNaN(d.getTime())) r.birthYear = d.getFullYear(); }
  if(r.level === '/'||r.level === '') r.level = null;
  if(r.subLevel === '/'||r.subLevel === '') r.subLevel = null;
  if(r.series === '/'||r.series === '') r.series = null;
  r.center = r.center || (r.centerName&&r.centerName.includes('系统软件')?'SWC':
    r.centerName&&r.centerName.includes('市场产品')?'MPC':'');
  return r;
}

/* ── UPLOAD — Performance files (multi-file, multi-sheet) ── */
function uploadPerfData() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.xlsx,.xls';
  input.multiple = true;
  input.onchange = function(e) {
    if(!e.target.files.length) return;
    let pending = e.target.files.length, hasNewData = false;
    for(const file of e.target.files) {
      const reader = new FileReader();
      reader.onload = function(ev) {
        try {
          const data = new Uint8Array(ev.target.result);
          const wb = XLSX.read(data, {type:'array', cellDates:false});
          const newCount = parsePerfWorkbook(wb);
          if(newCount > 0) {
            perfFileCount += newCount;
            perfFileLoaded = true;
            hasNewData = true;
          }
        } catch(err) { alert('读取绩效文件出错：'+err.message); }
        pending--;
        if(pending === 0 && hasNewData) {
          document.getElementById('perfDot').className = 'btn-dot loaded';
          document.getElementById('perfBadge').style.display = 'inline';
          document.getElementById('uploadPerfStatus').classList.add('show');
          document.getElementById('uploadPerfStatus').textContent = `已加载 ${perfFileCount} 条绩效记录`;
          document.getElementById('perfCount').textContent = `绩效数据 ${perfFileCount} 条`;
          attachPerfData();
          if(rawData.length) { refreshAll(); if(!document.getElementById('page-performance').classList.contains('hidden')) renderPerfTable(); }
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };
  input.click();
}

function parsePerfWorkbook(wb) {
  let count = 0;
  for(const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
    if(!rows || rows.length < 4) continue;

    let headerRow = -1;
    for(let i = 0; i < rows.length; i++) {
      if(rows[i] && rows[i].includes && rows[i].includes('工号')) { headerRow = i; break; }
    }
    if(headerRow < 0) continue;

    const H = rows[headerRow];
    const cleanH = H.map(h => (h||'').toString().replace(/\s+/g,' ').trim());
    const idx = (name) => { for(let j=0;j<cleanH.length;j++) { if(cleanH[j]===name) return j; } return -1; };
    const idxIncludes = (substr) => { for(let j=0;j<cleanH.length;j++) { if(cleanH[j].includes(substr)) return j; } return -1; };

    const iEmpId = idx('工号'); const iName = idx('姓名'); const iCenter = idx('中心');
    const iLevel = idx('职等'); const iSub = idx('子职等'); const iTier = idx('梯队类型');
    const iG2024M = idx('2024年中'); const iG2024Y = idx('2024年终');
    const iG2025M = idx('2025年中'); const iG2025Y = idx('2025年终');
    const iInit = idx('2026H1初评绩效等级')>=0 ? idx('2026H1初评绩效等级') : idxIncludes('初评');
    const iFinal = idx('2026H1 终评绩效等级')>=0 ? idx('2026H1 终评绩效等级') : idxIncludes('终评');
    const iChange = idx('近半年绩效变动')>=0 ? idx('近半年绩效变动') : idxIncludes('绩效变动');
    const iCoeff = idx('工时投入系数')>=0 ? idx('工时投入系数') : idxIncludes('投入系数');
    const iBracket = idx('投入系数分档')>=0 ? idx('投入系数分档') : idxIncludes('投入分档');
    const iOrgScore = idx('组织建设评分')>=0 ? idx('组织建设评分') : idxIncludes('组织建设评分');
    const iOrgBracket = idx('组织建设分档')>=0 ? idx('组织建设分档') : idxIncludes('组织分档');

    if(iEmpId < 0) continue;

    for(let r = headerRow+1; r < rows.length; r++) {
      const row = rows[r];
      if(!row || !row[iEmpId] || typeof row[iEmpId] !== 'string') continue;
      const empId = row[iEmpId].trim();
      if(!empId || empId === '合计' || empId === '工号') continue;

      const existing = perfData[empId] || {};
      const record = {
        ...existing,
        name: iName>=0 ? (row[iName]||existing.name) : existing.name,
        center: iCenter>=0 ? (row[iCenter]||existing.center) : existing.center,
        level: iLevel>=0 ? (row[iLevel]||existing.level) : existing.level,
        subLevel: iSub>=0 ? (row[iSub]||existing.subLevel) : existing.subLevel,
        tierType: iTier>=0 ? (row[iTier]||existing.tierType) : existing.tierType,
        grade2024M: iG2024M>=0 ? (row[iG2024M]||existing.grade2024M) : existing.grade2024M,
        grade2024Y: iG2024Y>=0 ? (row[iG2024Y]||existing.grade2024Y) : existing.grade2024Y,
        grade2025M: iG2025M>=0 ? (row[iG2025M]||existing.grade2025M) : existing.grade2025M,
        grade2025Y: iG2025Y>=0 ? (row[iG2025Y]||existing.grade2025Y) : existing.grade2025Y,
        initGrade: iInit>=0 ? (row[iInit]||existing.initGrade) : existing.initGrade,
        finalGrade: iFinal>=0 ? (row[iFinal]||existing.finalGrade) : existing.finalGrade,
        gradeChange: iChange>=0 ? (row[iChange]||existing.gradeChange) : existing.gradeChange,
        inputCoeff: iCoeff>=0 ? (parseFloat(row[iCoeff])||existing.inputCoeff||0) : (existing.inputCoeff||0),
        inputBracket: iBracket>=0 ? (row[iBracket]||existing.inputBracket) : existing.inputBracket,
        orgScore: iOrgScore>=0 ? (parseFloat(row[iOrgScore])||existing.orgScore||0) : (existing.orgScore||0),
        orgBracket: iOrgBracket>=0 ? (row[iOrgBracket]||existing.orgBracket) : existing.orgBracket,
      };
      ['grade2024M','grade2024Y','grade2025M','grade2025Y','initGrade','finalGrade'].forEach(k => {
        if(record[k]) record[k] = record[k].toString().trim();
      });
      perfData[empId] = record;
      count++;
    }
  }
  return count;
}

function attachPerfData() {
  for(const emp of rawData) {
    if(perfData[emp.id]) {
      const p = perfData[emp.id];
      emp.perfGrade2024M = p.grade2024M; emp.perfGrade2024Y = p.grade2024Y;
      emp.perfGrade2025M = p.grade2025M; emp.perfGrade2025Y = p.grade2025Y;
      emp.perfInitGrade = p.initGrade; emp.perfFinalGrade = p.finalGrade;
      emp.perfGradeChange = p.gradeChange; emp.perfInputCoeff = p.inputCoeff;
      emp.perfInputBracket = p.inputBracket; emp.perfTierType = p.tierType;
      emp.perfOrgScore = p.orgScore; emp.perfOrgBracket = p.orgBracket;
      emp.hasPerf = true;
    } else { emp.hasPerf = false; }
  }
}

/* ── DATA LOADED ── */
function onDataLoaded() {
  document.getElementById('uploadSection').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  document.getElementById('lastUpdated').textContent = `${rawData.length} 条记录 · ${new Date().toLocaleString('zh-CN')}`;

  // Populate center filter dynamically
  const centers = [...new Set(rawData.map(d=>d.center).filter(Boolean))].sort();
  const centerSel = document.getElementById('filterCenter');
  centerSel.innerHTML = '<option value="all">全部</option>' + centers.map(c => `<option value="${c}">${c}</option>`).join('');

  buildDeptPairs();

  const leavers = rawData.filter(d => d.status==='离职').length;
  document.getElementById('leaverBadge').textContent = leavers;

  if(perfFileLoaded) attachPerfData();
  refreshAll();
  // Rebuild table column filter options
  rebuildTableFilter();
  // Generate alerts
  if(typeof renderAlerts === 'function') renderAlerts();
}

/* ── INTERCONNECTED FILTERS — Excel slicer style ── */
function getFilterValues(excludeKey) {
  return {
    center: excludeKey==='center' ? 'all' : document.getElementById('filterCenter').value,
    dept: excludeKey==='dept' ? 'all' : document.getElementById('filterDept').value,
    type: excludeKey==='type' ? 'all' : document.getElementById('filterType').value,
    status: excludeKey==='status' ? 'all' : document.getElementById('filterStatus').value,
    fromDate: excludeKey==='date' ? '' : document.getElementById('filterDateFrom').value,
    toDate: excludeKey==='date' ? '' : document.getElementById('filterDateTo').value,
  };
}

function getFiltered(excludeKey) {
  const f = getFilterValues(excludeKey);
  return rawData.filter(d => {
    if(f.center!=='all' && d.center!==f.center) return false;
    if(f.dept!=='all' && (d.deptEn||d.dept)!==f.dept) return false;
    if(f.type!=='all' && d.empType!==f.type) return false;
    if(f.status!=='all' && d.status!==f.status) return false;
    if(f.fromDate && (!d.joinDate || d.joinDate < f.fromDate)) return false;
    if(f.toDate && (!d.joinDate || d.joinDate > f.toDate)) return false;
    return true;
  });
}

function onFilterChange(changedKey) {
  refreshFilterOptions(changedKey);
  refreshAll();
  if(typeof renderAlerts === 'function') renderAlerts();
}

function refreshFilterOptions(changedKey) {
  // Dept
  const deptData = getFiltered('dept');
  const availDepts = [...new Set(deptData.map(d => d.deptEn||d.dept).filter(Boolean))].sort();
  const deptSel = document.getElementById('filterDept');
  const curDept = deptSel.value;
  deptSel.innerHTML = '<option value="all">全部</option>' +
    availDepts.map(d => `<option value="${d}">${getDeptLabel(d)}</option>`).join('');
  if(curDept !== 'all' && availDepts.includes(curDept)) deptSel.value = curDept;
  else deptSel.value = 'all';

  // Center
  const centerData = getFiltered('center');
  const availCenters = [...new Set(centerData.map(d=>d.center).filter(Boolean))].sort();
  const centerSel = document.getElementById('filterCenter');
  const curCenter = centerSel.value;
  centerSel.innerHTML = '<option value="all">全部</option>' + availCenters.map(c => `<option value="${c}">${c}</option>`).join('');
  if(curCenter !== 'all' && availCenters.includes(curCenter)) centerSel.value = curCenter;
  else centerSel.value = 'all';

  // Type
  const typeData = getFiltered('type');
  const availTypes = [...new Set(typeData.map(d=>d.empType).filter(Boolean))].sort();
  const typeSel = document.getElementById('filterType');
  const curType = typeSel.value;
  typeSel.innerHTML = '<option value="all">全部</option>' + availTypes.map(t => `<option value="${t}">${t}</option>`).join('');
  if(curType !== 'all' && availTypes.includes(curType)) typeSel.value = curType;
  else typeSel.value = 'all';

  // Status
  const statusData = getFiltered('status');
  const availStatus = [...new Set(statusData.map(d=>d.status).filter(Boolean))].sort();
  const statusSel = document.getElementById('filterStatus');
  const curStatus = statusSel.value;
  statusSel.innerHTML = '<option value="all">全部</option>' + availStatus.map(s => `<option value="${s}">${s}</option>`).join('');
  if(curStatus !== 'all' && availStatus.includes(curStatus)) statusSel.value = curStatus;
  else statusSel.value = 'all';
}

function resetFilters() {
  document.getElementById('filterCenter').value = 'all';
  document.getElementById('filterDept').innerHTML = '<option value="all">全部</option>';
  document.getElementById('filterType').value = 'all';
  document.getElementById('filterStatus').value = 'all';
  document.getElementById('filterDateFrom').value = '';
  document.getElementById('filterDateTo').value = '';
  const centers = [...new Set(rawData.map(d=>d.center).filter(Boolean))].sort();
  document.getElementById('filterCenter').innerHTML = '<option value="all">全部</option>' +
    centers.map(c => `<option value="${c}">${c}</option>`).join('');
  const deptAll = [...new Set(rawData.filter(d=>d.deptEn||d.dept).map(d=>d.deptEn||d.dept))].sort();
  document.getElementById('filterDept').innerHTML = '<option value="all">全部</option>' +
    deptAll.map(d => `<option value="${d}">${getDeptLabel(d)}</option>`).join('');
  refreshAll();
  updateFilterStat();
  if(typeof renderAlerts === 'function') renderAlerts();
}

function updateFilterStat() {
  const filtered = getFiltered();
  const active = filtered.filter(d => d.status === '在职');
  document.getElementById('filterStat').textContent =
    `${filtered.length} 人 · 在职 ${active.length} 人 · 总计 ${rawData.length} 人`;
}

/* ── PAGE SWITCHING ── */
function switchPage(name) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page===name));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('hidden', p.id !== `page-${name}`));
  const titles = {
    overview:'总览',structure:'组织架构',demographics:'人员结构',
    turnover:'人员流动',performance:'绩效评估',employment:'用工类型',
    talent:'人才发展',health:'职级健康度',employee:'员工明细'
  };
  const subtitles = {
    overview:'核心人力指标一览',structure:'部门与职级结构',demographics:'年龄·学历·性别构成',
    turnover:'入离职与流动分析',performance:'绩效评估与分析',employment:'用工类型与编制分析',
    talent:'晋升通道与梯队建设',health:'职级结构与通道健康',employee:'完整员工信息明细'
  };
  document.getElementById('pageTitle').textContent = titles[name]||name;
  document.getElementById('pageBreadcrumb').textContent = subtitles[name]||'';

  // Hide shared rawSection on employee detail page (has its own full table)
  const rawSection = document.getElementById('rawSection');
  if(name === 'employee') { rawSection.style.display = 'none'; }
  else { rawSection.style.display = ''; }

  if(rawData.length) refreshAll();
  setTimeout(() => { Object.values(chartInstances).forEach(c => { if(c&&c.resize) c.resize(); }); }, 80);
  if(name === 'performance') renderPerfTable();
  if(name === 'employee' && rawData.length) { renderEmployeeTable(); }
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('mobileOverlay').classList.toggle('open');
}

/* ── REFRESH ALL ── */
function refreshAll() {
  const filtered = getFiltered();
  const active = filtered.filter(d => d.status === '在职');
  const allActive = rawData.filter(d => d.status === '在职');
  const allLeavers = rawData.filter(d => d.status === '离职');
  const tc = getThemeColors();
  updateChartDefaults(tc);
  updateFilterStat();

  renderKpiCards(active, allActive, allLeavers);
  renderTable(filtered);
  renderOverview(active, allActive, allLeavers, tc);
  renderStructure(active, tc);
  renderDemographics(active, tc);
  renderTurnover(allLeavers, allActive, tc);
  renderPerformance(active, tc);
  renderEmployment(active, tc);
  renderTalent(active, tc);
  renderHealth(active, tc);
  // Refresh employee page table when filters change
  if(!document.getElementById('page-employee').classList.contains('hidden')) renderEmployeeTable();
  renderAlerts();
}

/* ── THEME WATCHER ── */
new MutationObserver(()=>{if(rawData.length)refreshAll();}).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(rawData.length)refreshAll();});
