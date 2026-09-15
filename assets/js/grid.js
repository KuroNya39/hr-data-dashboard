/* ═══════════════════════════════════════════════════════════════
   grid.js — 通用表格增强 v2
   ① 点表头出下拉筛选（Excel 风格）——所有表格自动挂载
   ② 冻结到任意行/列（右键行/列头 →「冻结到此行/列」；悬浮工具条下拉可调）
   ③ 多选行列一键隐藏（工具条进入选行/选列模式，点选后「隐藏所选」；
      也可右键单条隐藏；「恢复隐藏」一键全显）
   ④ 员工明细表：表头补漏斗图标（点击仍走自己的筛选弹窗）、
      同样支持冻结与隐藏（它自带筛选体系，跳过的只是 grid 的筛选部分）

   实现思路（DOM 级，不动任何渲染函数）：
   - MutationObserver 盯着 body，页面每次重渲染出的 <table> 自动挂
   - 筛选/冻结/隐藏状态按「页面|表」存 Map，重渲染后自动恢复
   - 冻结用 position:sticky：行冻结从表头往下累加 top，列冻结从左往右
     累加 left（量 offsetWidth，仅在页面可见时准确——pageVisible 守卫
     保证各表只在所在页可见时才渲染，天然成立）
   - 状态栏 #gridBar 悬浮在表格上时出现；右键菜单 #gridMenu

   ⚠ 与 table.js 的互动：共用 #filterPopup，document 级「点外面关闭」
   由 table.js 的监听器负责；本文件的表头点击必须 stopPropagation。
   ═══════════════════════════════════════════════════════════════ */
(function () {
  if (window.__gridEnhance) return;
  window.__gridEnhance = true;

  const colFilters  = new Map();  // 列筛选  key(page|table|ci) -> Set(选中值)
  const freezeState = new Map();  // 冻结    key(page|table)     -> { fr, fc }
  const hiddenRows  = new Map();  // 隐藏行  key(page|table)     -> Set(行序号)
  const hiddenCols  = new Map();  // 隐藏列  key(page|table)     -> Set(列序号)
  let gridCur = null;             // 筛选弹窗上下文 { table, ci, key }
  let scanQueued = false;

  /* 多选模式：{ table, kind:'row'|'col', rows:Set(tr), cols:Set(ci) } */
  let selMode = null;
  /* 悬浮工具条当前绑定的表 */
  let barTable = null, barHideTimer = null;

  /* ── 稳定 key ── */
  function pageId(table) {
    const page = table.closest('.page');
    return page ? page.id : 'nopage';
  }
  function tableId(table) {
    if (table.id) return table.id;
    const page = table.closest('.page');
    const siblings = page ? page.querySelectorAll('table') : [];
    return 't' + [...siblings].indexOf(table);
  }
  const tk = table => pageId(table) + '|' + tableId(table);
  function stateKey(table, ci) { return tk(table) + '|' + ci; }

  /* 行在该列的值；colspan 占位行（如「暂无数据」）返回 null = 不参与本列筛选 */
  function cellText(row, ci) {
    const td = row.cells[ci];
    if (!td) return null;
    const v = td.textContent.trim();
    return v === '' ? '(空白)' : v;
  }

  /* ═══════════ 挂载 ═══════════ */
  function initGrid(table) {
    if (table.closest('.filter-popup')) return;
    if (table.hasAttribute('data-grid-off')) return;
    const thead = table.querySelector('thead');
    if (!thead || !thead.rows.length) return;
    const isEmp = !!table.closest('.emp-table-wrap');

    if (thead.dataset.gridReady) {
      /* 重复扫描：结构没变就跳过全量重刷（mutation 频繁时不抖） */
      const sig = tableSig(table);
      if (thead.dataset.gridSig !== sig) { thead.dataset.gridSig = sig; applyAll(table); }
      return;
    }
    thead.dataset.gridReady = '1';
    thead.dataset.gridSig = tableSig(table);

    [...thead.rows[0].cells].forEach((th, ci) => {
      if (th.dataset.gridTh) return;
      th.dataset.gridTh = '1';
      const label = th.textContent.trim();
      if (!label) return;                       // 空表头列不给筛
      th.classList.add('grid-th');
      const funnel = document.createElement('span');
      funnel.className = 'mi grid-funnel';
      funnel.style.pointerEvents = 'none';      // 别拦住 th 自己的点击
      funnel.textContent = 'filter_list';
      th.appendChild(funnel);

      if (isEmp) {
        /* 员工明细：点击仍走 table.js 自己的 toggleFilterPopup（th 上有内联 onclick） */
        th.title = '点击筛选「' + label + '」· 右键冻结 / 隐藏';
      } else {
        th.title = '点击筛选「' + label + '」· 右键冻结 / 隐藏';
        th.addEventListener('click', e => {
          e.stopPropagation();
          if (selMode && selMode.table === table && selMode.kind === 'col') { toggleColSel(table, ci); return; }
          gridOpenPopup(table, ci, th, label);
        });
      }
      th.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation();
        openHeadMenu(table, ci, th, label);
      });
    });

    const tbody = table.querySelector('tbody');
    if (tbody && !tbody.dataset.gridRows) {
      tbody.dataset.gridRows = '1';
      tbody.addEventListener('click', e => {
        const tr = e.target.closest('tr');
        if (!tr) return;
        if (selMode && selMode.table === table && selMode.kind === 'row') {
          e.stopPropagation(); toggleRowSel(table, tr); return;
        }
        if (e.ctrlKey || e.metaKey) {           // 任何时刻 Ctrl+点行 = 临时多选
          e.preventDefault(); toggleRowSel(table, tr);
        }
      });
      tbody.addEventListener('contextmenu', e => {
        const tr = e.target.closest('tr');
        if (!tr) return;
        e.preventDefault(); e.stopPropagation();
        openRowMenu(table, tr);
      });
    }
    applyAll(table);
  }

  /* ═══════════ 应用：隐藏列 → 隐藏行 → 冻结（顺序影响测量）═══════════ */
  function applyAll(table) {
    applyHiddenCols(table);
    applyGridFilter(table);       // 行筛选与隐藏行合并处理
    applyFreeze(table);
    refreshFunnel(table);
  }

  function applyHiddenCols(table) {
    const hide = hiddenCols.get(tk(table));
    const all = [...(table.tHead ? table.tHead.rows : []), ...(table.tBodies[0] ? table.tBodies[0].rows : [])];
    const nCols = table.tHead ? table.tHead.rows[0].cells.length : 0;
    all.forEach(tr => {
      for (let ci = 0; ci < tr.cells.length && ci < nCols; ci++) {
        tr.cells[ci].style.display = (hide && hide.has(ci)) ? 'none' : '';
      }
    });
  }

  function applyGridFilter(table) {
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    const byCol = new Map();
    [...table.querySelectorAll('thead th')].forEach((th, ci) => {
      if (!th.dataset.gridTh) return;
      const set = colFilters.get(stateKey(table, ci));
      if (set && set.size) byCol.set(ci, set);
    });
    const hide = hiddenRows.get(tk(table));
    [...tbody.rows].forEach((row, ri) => {
      let show = !(hide && hide.has(ri));
      if (show && byCol.size) {
        for (const [ci, set] of byCol) {
          const v = cellText(row, ci);
          if (v === null) continue;
          if (!set.has(v)) { show = false; break; }
        }
      }
      row.style.display = show ? '' : 'none';
    });
  }

  function refreshFunnel(table) {
    [...table.querySelectorAll('thead th')].forEach((th, ci) => {
      if (!th.dataset.gridTh) return;
      const set = colFilters.get(stateKey(table, ci));
      th.classList.toggle('grid-filtered', !!(set && set.size));
    });
  }

  /* ── 冻结：fr = 冻结到第几行（tbody 序号），fc = 冻结到第几列 ── */

  /* 冻结基准 top：表格有自己的滚动容器（overflow≠visible 祖先）→ 从容器顶算；
     否则是页面级滚动 → 必须避开 sticky 顶栏（否则冻结内容滚到顶会被 .topbar 盖住） */
  function baseTopOf(table) {
    let el = table.parentElement;
    while (el && el !== document.documentElement) {
      if (getComputedStyle(el).overflowY !== 'visible') return 0;
      el = el.parentElement;
    }
    const tb = document.querySelector('.topbar');
    return tb ? (tb.getBoundingClientRect().height || tb.offsetHeight) : 0;
  }
  /* 行高用浮点 rect（offsetHeight 取整会在多行累加时产生 1px 级错位） */
  function rowH(tr) {
    let h = 0;
    [...tr.cells].forEach(c => {
      if (c.style.display === 'none') return;
      h = Math.max(h, c.getBoundingClientRect().height || c.offsetHeight);
    });
    return h;
  }
  /* 结构签名：判断表内容是否真的变了，避免每次 mutation 都全量重刷 */
  function tableSig(table) {
    const tb = table.tBodies[0];
    const rs = tb ? tb.rows : [];
    const a = rs.length ? rs[0].textContent.slice(0, 60) : '';
    const b = rs.length > 1 ? rs[rs.length - 1].textContent.slice(0, 60) : '';
    const nc = table.tHead ? table.tHead.rows[0].cells.length : 0;
    return rs.length + '|' + a + '|' + b + '|' + nc;
  }

  function applyFreeze(table) {
    const st = freezeState.get(tk(table)) || { fr: 0, fc: 0 };
    const headRows = table.tHead ? [...table.tHead.rows] : [];
    const tbody = table.tBodies[0];
    const bodyRows = tbody ? [...tbody.rows] : [];

    /* 清旧（含上次冻结留下的分类样式） */
    [...headRows, ...bodyRows].forEach(tr => [...tr.cells].forEach(c => {
      c.classList.remove('grid-frozen-cell', 'grid-frozen-row', 'grid-frozen-col', 'grid-frozen-corner');
      c.style.position = ''; c.style.top = ''; c.style.left = ''; c.style.zIndex = '';
    }));
    if (!st.fr && !st.fc) return;

    const base = baseTopOf(table);

    /* ① 列冻结：从左往右累加可见宽度 */
    let lefts = [];
    if (st.fc > 0) {
      const probe = headRows[0] || bodyRows.find(r => r.style.display !== 'none') || bodyRows[0];
      if (probe) {
        lefts = [0];
        let acc = 0, frozen = 0;
        for (let ci = 0; ci < probe.cells.length && frozen < st.fc; ci++) {
          const c = probe.cells[ci];
          if (c.style.display === 'none') continue;
          frozen++;
          lefts.push(acc + c.offsetWidth);
          acc += c.offsetWidth;
        }
        lefts.pop();
      }
    }
    if (st.fc > 0) {
      const markCol = (row, zBase) => {
        let frozen = 0;
        for (let ci = 0; ci < row.cells.length && frozen < st.fc; ci++) {
          const c = row.cells[ci];
          if (c.style.display === 'none') continue;
          c.style.position = 'sticky';
          c.style.left = (lefts[frozen] || 0) + 'px';
          c.style.zIndex = zBase;
          c.classList.add('grid-frozen-cell', 'grid-frozen-col');
          frozen++;
        }
      };
      headRows.forEach(tr => markCol(tr, 4));
      bodyRows.forEach(tr => { if (tr.style.display !== 'none') markCol(tr, 2); });
    }

    /* ② 行冻结：表头从基准 top 起浮点累加；冻结行接在表头之后 */
    let top = base;
    headRows.forEach(tr => {
      [...tr.cells].forEach(c => {
        if (c.style.display === 'none') return;
        c.style.position = 'sticky';
        c.style.top = top + 'px';
        c.style.zIndex = st.fc ? 5 : 3;
        c.classList.add('grid-frozen-cell', 'grid-frozen-row');
        if (st.fc) c.classList.add('grid-frozen-corner');
      });
      top += rowH(tr);
    });
    let frozenRows = 0;
    for (const tr of bodyRows) {
      if (frozenRows >= st.fr) break;
      if (tr.style.display === 'none') continue;   // 被隐藏的行跳过（名额语义以可见行为准）
      [...tr.cells].forEach(c => {
        if (c.style.display === 'none') return;
        c.style.position = 'sticky';
        c.style.top = top + 'px';
        if (!st.fc) c.style.zIndex = 2;
        c.classList.add('grid-frozen-cell', 'grid-frozen-row');
      });
      top += rowH(tr);
      frozenRows++;
    }
  }

  /* ═══════════ 筛选弹窗（在 v1 基础上加「冻结到此列 / 隐藏本列」）═══════════ */
  function gridOpenPopup(table, ci, th, label) {
    const popup = document.getElementById('filterPopup');
    if (!popup) return;
    const key = stateKey(table, ci);
    if (gridCur && gridCur.key === key && popup.style.display === 'block') { gridClosePopup(); return; }

    const tbody = table.querySelector('tbody');
    const others = new Map();
    [...table.querySelectorAll('thead th')].forEach((_, i) => {
      if (i === ci) return;
      const set = colFilters.get(stateKey(table, i));
      if (set && set.size) others.set(i, set);
    });
    const countMap = new Map();
    let total = 0;
    [...tbody.rows].forEach(row => {
      for (const [oci, oset] of others) {
        const v = cellText(row, oci);
        if (v !== null && !oset.has(v)) return;
      }
      total++;
      const v = cellText(row, ci);
      if (v === null) return;
      countMap.set(v, (countMap.get(v) || 0) + 1);
    });
    const entries = [...countMap.keys()].sort((a, b) => a.localeCompare(b, 'zh'))
      .map(v => ({ value: v, count: countMap.get(v) }));
    const selected = colFilters.get(key) || new Set(entries.map(e => e.value));
    const allChecked = entries.length > 0 && selected.size === entries.length;

    gridCur = { table, ci, key };
    popup.innerHTML =
      `<div style="padding:6px 10px;border-bottom:1px solid var(--border);font-weight:600;font-size:12.5px;display:flex;justify-content:space-between;align-items:center"><span>${esc(label)}</span><span onclick="gridClosePopup()" style="cursor:pointer;opacity:.5"><span class="mi">close</span></span></div>` +
      `<div style="max-height:260px;overflow-y:auto">` +
      `<label style="display:flex;align-items:center;gap:6px;padding:4px 10px;border-bottom:1px solid var(--gridline);font-size:12px;cursor:pointer"><input type="checkbox" class="cb-all"${allChecked ? ' checked' : ''} onchange="gridToggleAll(this)"><b>全选</b><span style="margin-left:auto;color:var(--ink-3);font-size:11px">${total}</span></label>` +
      entries.map(e =>
        `<label style="display:flex;align-items:center;gap:6px;padding:3px 10px;cursor:pointer;font-size:12px;white-space:nowrap"><input type="checkbox" value="${esc(e.value)}"${selected.has(e.value) ? ' checked' : ''} onchange="gridOnValChange()"><span style="flex:1;overflow:hidden;text-overflow:ellipsis">${esc(e.value)}</span><span style="color:var(--ink-3);font-size:11px">${e.count}</span></label>`
      ).join('') + '</div>' +
      `<div style="padding:6px 10px;border-top:1px solid var(--border);display:flex;gap:6px;justify-content:space-between;align-items:center">` +
      `<span><button class="tb-btn" onclick="gridFreezeCol()" title="冻结表头到此列（含以左全部冻结）">冻结到此列</button> <button class="tb-btn" onclick="gridHideCol()">隐藏本列</button></span>` +
      `<span><button class="tb-btn" onclick="gridClearColumn()">清除</button> <button class="tb-btn primary" onclick="gridClosePopup()">确定</button></span></div>`;

    popup.style.display = 'block';
    const rect = th.getBoundingClientRect();
    popup.style.left = Math.max(6, Math.min(rect.left, window.innerWidth - 340)) + 'px';
    popup.style.top = Math.min(rect.bottom + 2, window.innerHeight - 240) + 'px';
  }

  function collectChecked() {
    const selected = new Set();
    document.querySelectorAll('#filterPopup input[type="checkbox"]:not(.cb-all)')
      .forEach(c => { if (c.checked) selected.add(c.value); });
    return selected;
  }
  window.gridOnValChange = function () {
    if (!gridCur) return;
    const sel = collectChecked();
    if (sel.size) colFilters.set(gridCur.key, sel);
    else colFilters.delete(gridCur.key);
    applyGridFilter(gridCur.table);
    refreshFunnel(gridCur.table);
  };
  window.gridToggleAll = function (cb) {
    document.querySelectorAll('#filterPopup input[type="checkbox"]:not(.cb-all)')
      .forEach(c => { c.checked = cb.checked; });
    gridOnValChange();
  };
  window.gridClearColumn = function () {
    if (gridCur) { colFilters.delete(gridCur.key); applyGridFilter(gridCur.table); }
    gridClosePopup();
  };
  window.gridClosePopup = function () {
    const p = document.getElementById('filterPopup');
    if (p) p.style.display = 'none';
    gridCur = null;
  };
  window.gridFreezeCol = function () {
    if (!gridCur) return;
    setFreeze(gridCur.table, null, gridCur.ci + 1);
    gridClosePopup();
  };
  window.gridHideCol = function () {
    if (!gridCur) return;
    const k = tk(gridCur.table);
    const set = hiddenCols.get(k) || new Set();
    set.add(gridCur.ci);
    hiddenCols.set(k, set);
    gridClosePopup();
    applyAll(gridCur.table);
  };

  /* ═══════════ 冻结 ═══════════ */
  function setFreeze(table, fr, fc) {
    const k = tk(table);
    const st = freezeState.get(k) || { fr: 0, fc: 0 };
    if (fr !== null && fr !== undefined) st.fr = fr;
    if (fc !== null && fc !== undefined) st.fc = fc;
    if (st.fr <= 0 && st.fc <= 0) freezeState.delete(k);
    else freezeState.set(k, st);
    applyAll(table);
    if (barTable === table) showBar();
  }

  /* ═══════════ 隐藏行/列 + 多选 ═══════════ */
  function toggleRowSel(table, tr) {
    ensureSel(table, 'row');
    if (selMode.rows.has(tr)) { selMode.rows.delete(tr); tr.classList.remove('grid-sel-row'); }
    else { selMode.rows.add(tr); tr.classList.add('grid-sel-row'); }
    showBar();
  }
  function toggleColSel(table, ci) {
    ensureSel(table, 'col');
    const th = table.tHead.rows[0].cells[ci];
    if (selMode.cols.has(ci)) {
      selMode.cols.delete(ci); th.classList.remove('grid-sel-col');
      allRowsOf(table).forEach(r => r.cells[ci] && r.cells[ci].classList.remove('grid-sel-col'));
    } else {
      selMode.cols.add(ci); th.classList.add('grid-sel-col');
      allRowsOf(table).forEach(r => r.cells[ci] && r.cells[ci].classList.add('grid-sel-col'));
    }
    showBar();
  }
  function allRowsOf(table) {
    return [...(table.tBodies[0] ? table.tBodies[0].rows : [])];
  }
  function ensureSel(table, kind) {
    if (!selMode || selMode.table !== table || selMode.kind !== kind) {
      clearSelVisual();
      selMode = { table, kind, rows: new Set(), cols: new Set() };
    }
    return selMode;
  }
  function clearSelVisual() {
    if (!selMode) return;
    selMode.table.querySelectorAll('.grid-sel-row').forEach(el => el.classList.remove('grid-sel-row'));
    selMode.table.querySelectorAll('.grid-sel-col').forEach(el => el.classList.remove('grid-sel-col'));
    selMode = null;
  }
  function exitSelMode() { clearSelVisual(); if (barTable) showBar(); }

  function hideSelected() {
    if (!selMode) return;
    const table = selMode.table, kind = selMode.kind;
    const k = tk(table);
    if (kind === 'row' && selMode.rows.size) {
      const set = hiddenRows.get(k) || new Set();
      const idx = allRowsOf(table);
      selMode.rows.forEach(tr => { const i = idx.indexOf(tr); if (i >= 0) set.add(i); });
      hiddenRows.set(k, set);
    } else if (kind === 'col' && selMode.cols.size) {
      const set = hiddenCols.get(k) || new Set();
      selMode.cols.forEach(ci => set.add(ci));
      hiddenCols.set(k, set);
    }
    clearSelVisual();
    applyAll(table);
    showBar();
  }
  window.gridRestoreHidden = function () {
    if (!barTable) return;
    hiddenRows.delete(tk(barTable));
    hiddenCols.delete(tk(barTable));
    applyAll(barTable);
    showBar();
  };
  window.gridBarFreeze = function (kind, v) {
    if (!barTable) return;
    setFreeze(barTable, kind === 'row' ? v : null, kind === 'col' ? v : null);
  };
  window.gridBarMode = function (kind) {
    if (!barTable) return;
    if (selMode && selMode.table === barTable && selMode.kind === kind) exitSelMode();
    else { ensureSel(barTable, kind); showBar(); }
  };
  window.gridBarHideSel = function () { hideSelected(); };
  window.gridBarExit = function () { exitSelMode(); };

  /* ═══════════ 右键菜单 ═══════════ */
  function openMenu(items, x, y) {
    const menu = ensureMenuEl();
    menu.innerHTML = items.map((it, i) =>
      it === '-' ? '<div class="grid-menu-sep"></div>'
        : `<div class="grid-menu-item${it.disabled ? ' disabled' : ''}" data-i="${i}">${it.label}</div>`).join('');
    menu.style.display = 'block';
    menu.style.left = Math.min(x, window.innerWidth - 210) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - items.length * 30 - 16) + 'px';
    menu.onclick = e => {
      const el = e.target.closest('.grid-menu-item');
      if (!el || el.classList.contains('disabled')) return;
      const it = items[+el.dataset.i];
      menu.style.display = 'none';
      it.fn && it.fn();
    };
  }
  let menuEl = null;
  function ensureMenuEl() {
    if (menuEl) return menuEl;
    menuEl = document.createElement('div');
    menuEl.id = 'gridMenu';
    document.body.appendChild(menuEl);
    document.addEventListener('click', () => { if (menuEl) menuEl.style.display = 'none'; });
    document.addEventListener('scroll', () => { if (menuEl) menuEl.style.display = 'none'; }, true);
    return menuEl;
  }

  function openRowMenu(table, tr) {
    barTable = table;
    const st = freezeState.get(tk(table)) || { fr: 0, fc: 0 };
    const idx = allRowsOf(table);
    const ri = idx.indexOf(tr);
    const hid = hiddenRows.get(tk(table));
    const sel = selMode && selMode.table === table ? selMode.rows.size : 0;
    openMenu([
      { label: `❄ 冻结到此行（表头 + 前 ${Math.min(ri + 1, idx.length)} 行数据）`, fn: () => setFreeze(table, ri + 1, null) },
      { label: '取消行冻结', disabled: !st.fr, fn: () => setFreeze(table, 0, null) },
      '-',
      { label: '隐藏此行', fn: () => {
          const set = hiddenRows.get(tk(table)) || new Set();
          set.add(ri); hiddenRows.set(tk(table), set); applyAll(table); showBar();
        } },
      { label: `隐藏所选行（${sel}）`, disabled: !sel, fn: () => hideSelected() },
      { label: '进入多选行模式（点行勾选）', fn: () => { ensureSel(table, 'row'); showBar(); } },
      { label: '显示全部隐藏行', disabled: !hid || !hid.size, fn: () => { hiddenRows.delete(tk(table)); applyAll(table); showBar(); } },
    ], tr.getBoundingClientRect().left + 40, tr.getBoundingClientRect().bottom + 2);
  }
  function openHeadMenu(table, ci, th, label) {
    barTable = table;
    const st = freezeState.get(tk(table)) || { fr: 0, fc: 0 };
    const hid = hiddenCols.get(tk(table));
    const sel = selMode && selMode.table === table ? selMode.cols.size : 0;
    openMenu([
      { label: `❄ 冻结到此列（${esc(label)} 及以左）`, fn: () => setFreeze(table, null, ci + 1) },
      { label: '取消列冻结', disabled: !st.fc, fn: () => setFreeze(table, null, 0) },
      '-',
      { label: `隐藏「${esc(label)}」列`, fn: () => {
          const set = hiddenCols.get(tk(table)) || new Set();
          set.add(ci); hiddenCols.set(tk(table), set); applyAll(table); showBar();
        } },
      { label: `隐藏所选列（${sel}）`, disabled: !sel, fn: () => hideSelected() },
      { label: '进入多选列模式（点表头勾选）', fn: () => { ensureSel(table, 'col'); showBar(); } },
      { label: '显示全部隐藏列', disabled: !hid || !hid.size, fn: () => { hiddenCols.delete(tk(table)); applyAll(table); showBar(); } },
    ], th.getBoundingClientRect().left + 30, th.getBoundingClientRect().bottom + 2);
  }

  /* ═══════════ 悬浮工具条 #gridBar ═══════════ */
  let barEl = null;
  function ensureBarEl() {
    if (barEl) return barEl;
    barEl = document.createElement('div');
    barEl.id = 'gridBar';
    barEl.addEventListener('mouseenter', () => { clearTimeout(barHideTimer); });
    barEl.addEventListener('mouseleave', () => { barEl.style.display = 'none'; });
    document.body.appendChild(barEl);
    return barEl;
  }
  function showBar() {
    if (!barTable || !document.body.contains(barTable)) { hideBar(); return; }
    const bar = ensureBarEl();
    const k = tk(barTable);
    const st = freezeState.get(k) || { fr: 0, fc: 0 };
    const nR = (hiddenRows.get(k) || new Set()).size;
    const nC = (hiddenCols.get(k) || new Set()).size;
    const nBody = allRowsOf(barTable).length;
    const nHead = barTable.tHead ? barTable.tHead.rows[0].cells.length : 0;
    const mode = selMode && selMode.table === barTable ? selMode.kind : null;
    const selN = selMode && selMode.table === barTable ? (selMode.kind === 'row' ? selMode.rows.size : selMode.cols.size) : 0;

    bar.innerHTML =
      `<span class="gb-label">冻结到</span>` +
      `<select class="gb-sel" onchange="gridBarFreeze('row',+this.value)">` +
        Array.from({ length: Math.min(8, nBody) + 1 }, (_, i) => `<option value="${i}"${st.fr === i ? ' selected' : ''}>${i ? i + ' 行' : '无'}</option>`).join('') +
      `</select>` +
      `<select class="gb-sel" onchange="gridBarFreeze('col',+this.value)">` +
        Array.from({ length: Math.min(5, nHead) + 1 }, (_, i) => `<option value="${i}"${st.fc === i ? ' selected' : ''}>${i ? i + ' 列' : '无'}</option>`).join('') +
      `</select>` +
      `<span class="gb-sep"></span>` +
      `<button class="gb-btn${mode === 'row' ? ' on' : ''}" onclick="gridBarMode('row')" title="进入后点行勾选">✂ 选行</button>` +
      `<button class="gb-btn${mode === 'col' ? ' on' : ''}" onclick="gridBarMode('col')" title="进入后点表头勾选">✂ 选列</button>` +
      `<button class="gb-btn primary" onclick="gridBarHideSel()"${selN ? '' : ' disabled'}>隐藏所选(${selN})</button>` +
      `<button class="gb-btn" onclick="gridRestoreHidden()"${(nR + nC) ? '' : ' disabled'} title="显示全部被隐藏的行/列">↺ 恢复</button>` +
      (mode ? `<button class="gb-btn" onclick="gridBarExit()">完成</button>` : '') +
      (nR || nC ? `<span class="gb-note">已隐藏 ${nR}行/${nC}列</span>` : '');

    const rect = barTable.getBoundingClientRect();
    bar.style.display = 'flex';
    bar.style.left = Math.max(10, Math.min(rect.left, window.innerWidth - bar.offsetWidth - 10)) + 'px';
    bar.style.top = Math.max(10, rect.top - 40) + 'px';
  }
  function hideBar() {
    if (barEl) barEl.style.display = 'none';
    barTable = null;
  }
  document.addEventListener('mouseover', e => {
    const t = e.target && e.target.closest && e.target.closest('table');
    if (!t || t.closest('.filter-popup') || t.hasAttribute('data-grid-off')) return;
    if (t === barTable) { clearTimeout(barHideTimer); return; }
    if (selMode && selMode.table !== t) return;   // 多选进行中别切换绑定
    barTable = t;
    showBar();
  });
  document.addEventListener('mouseout', e => {
    if (!barEl || barEl.style.display !== 'flex') return;
    const t = e.target && e.target.closest && e.target.closest('table');
    if (t && t === barTable && !barEl.contains(e.relatedTarget)) {
      clearTimeout(barHideTimer);
      barHideTimer = setTimeout(() => {
        if (barEl && !barEl.matches(':hover')) { barEl.style.display = 'none'; }
      }, 1500);
    }
  });

  /* Esc：退出多选 / 关菜单 / 关弹窗 */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (selMode) exitSelMode();
    if (menuEl) menuEl.style.display = 'none';
    gridClosePopup();
  });

  /* 字体加载完成后行高/列宽会变：重算所有冻结偏移 */
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueScan);

  /* 窗口尺寸变化：重算冻结偏移（防抖） */
  let rz = null;
  window.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      freezeState.forEach((_, k) => {
        const page = document.getElementById(k.split('|')[0]);
        if (page) page.querySelectorAll('table').forEach(t => { if (tk(t) === k) applyFreeze(t); });
      });
    }, 150);
  });

  /* ═══════════ 自动挂载 ═══════════ */
  function scan() { document.querySelectorAll('table').forEach(initGrid); }
  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    setTimeout(() => { scanQueued = false; scan(); }, 80);
  }
  new MutationObserver(queueScan).observe(document.body, { childList: true, subtree: true });
  scan();
})();
