/* ═══════════════════════════════════════════════════════════════
   grid.js — 通用表格增强 v4（2026-10-21 二次调整）
   ① 多选：右键行/表头 →「多选隐藏…」进入多选模式
      - 行模式：左端临时挂出勾选框列，点勾选框或点行整行切换选中
      - 列模式：点表头切换选中列（此时不弹筛选弹窗）
      - 工具栏出现「隐藏所选（N）」「退出多选」
      ⚠️ 2026-10-21 用户否掉了两种做法，别再改回去：
         ①「每张表最左常驻勾选框列」——用户觉得不好看；
         ②「按住拖动框选一片行」——按住拖拽实际是在选中文字，根本选不中表格。
         所以勾选框列**只在行多选模式里出现**，平时完全不存在；
         选行**只靠点击**（点一下切换一行），不做任何拖拽选区。
         文字选中是浏览器原生行为，表格不该去劫持它。
   ② 统一工具栏：搜索 + 隐藏所选 + 恢复隐藏 + 导出 CSV + 分页
   ③ 点表头出下拉筛选（Excel 风格）——所有表格自动挂载
   ④ 冻结到任意行/列（右键行/列头 →「冻结到此行/列」）
   ⑤ 右键单条隐藏 / 恢复隐藏

   实现思路（DOM 级，不动任何渲染函数）：
   - MutationObserver 盯着 body，页面每次重渲染出的 <table> 自动挂
   - 状态按「页面|表」存 Map，重渲染后自动恢复
   - 冻结用 position:sticky；勾选框列钉在最左（left:0）
   - 勾选框列是**真列**（塞在 index 0），所以所有按「第几列」读的地方都要过
     cellAt()/colOff() 换算；这是本文件唯一需要小心的地方

   ⚠ 与 table.js 的互动：
   - 共用 #filterPopup，document 级「点外面关闭」由 table.js 的监听器负责；
     本文件的表头点击必须 stopPropagation
   - 员工明细表自带搜索 / 分页 / CSV（table.js），这里只补勾选框与冻结/隐藏，
     工具栏只保留「隐藏所选 / 恢复隐藏」，避免出现两套搜索框
   ═══════════════════════════════════════════════════════════════ */
(function () {
  if (window.__gridEnhance) return;
  window.__gridEnhance = true;

  const colFilters  = new Map();  // 列筛选  key(page|table|ci) -> Set(选中值)
  const freezeState = new Map();  // 冻结    key(page|table)     -> { fr, fc }
  const hiddenRows  = new Map();  // 隐藏行  key(page|table)     -> Set(行 key)
  const hiddenCols  = new Map();  // 隐藏列  key(page|table)     -> Set(逻辑列序号)
  const selRows     = new Map();  // 已勾选行 key(page|table)    -> Set(行 key)
  const selCols     = new Map();  // 已勾选列 key(page|table)    -> Set(逻辑列序号)
  const searchState = new Map();  // 搜索词  key(page|table)    -> string
  const pageState   = new Map();  // 分页    key(page|table)    -> { size, page }
  /* 每页条数 / 起始页的唯一默认值。取值处一律 pageDefault()（返回新对象——pageState 里的
     对象会被就地改动，共用同一个字面量会让一张表翻页带着别的表一起跳） */
  const PAGE_DEFAULT = { size: 50, page: 1 };
  const pageDefault = () => ({ ...PAGE_DEFAULT });
  /* 通过「隐藏 + 列筛选 + 搜索」的行数（**分页前**）。工具栏的「第 x/y 页」要用它，
     不能数页面上可见的行——那一数出来永远是「当前页 50 行 → 1/1 页」。 */
  const statCount   = new Map();
  let gridCur = null;             // 筛选弹窗上下文 { table, ci, key }
  /* 多选模式：{ table, kind:'row'|'col', tk }。只有进入模式才挂勾选框列。 */
  let selMode = null;
  let scanQueued = false;

  /* 这张表当前处于哪种多选模式（重渲染后表元素换了，按 tk 认） */
  function modeKindOf(table) {
    if (!selMode || selMode.tk !== tk(table)) return null;
    selMode.table = table;    // 重渲染后把指针换到新表上
    return selMode.kind;
  }

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

  function isEmpTable(table) { return !!table.closest('.emp-table-wrap'); }
  function isMini(table) { return table.classList.contains('mini-table'); }
  /* 数据表 = 需要勾选框列 + 工具栏的表。矩阵表 / 说明表不参与，避免打乱它们自己的索引计算 */
  function isDataGrid(table) { return isMini(table) || isEmpTable(table); }

  /* ── 勾选框列带来的索引偏移（本文件唯一的地基）── */
  function colOff(table) { return table.dataset.gridSel === '1' ? 1 : 0; }
  /* off 可选：热循环（排序比较器 / 逐格遍历）里先算一次 colOff 传进来，
     省掉每次读格子都做一次 tr.closest('table') 的祖先链遍历 */
  function cellAt(tr, ci, off) {
    if (!tr) return undefined;
    if (off === undefined) {
      const t = tr.closest ? tr.closest('table') : null;
      off = t && t.dataset.gridSel === '1' ? 1 : 0;
    }
    return tr.cells[ci + off];
  }
  function logicalCols(table) {
    const r = table.tHead && table.tHead.rows[0];
    return r ? r.cells.length - colOff(table) : 0;
  }
  function logicalIndex(table, cell) { return cell.cellIndex - colOff(table); }

  /* 行在该列的值；colspan 占位行（如「暂无数据」）返回 null = 不参与本列筛选 */
  function cellText(row, ci, off) {
    const td = cellAt(row, ci, off);
    if (!td) return null;
    const v = td.textContent.trim();
    return v === '' ? '(空白)' : v;
  }

  /* ═══════════ 通用表头排序 ═══════════
     入口与员工明细表一致：点表头 → 筛选弹窗顶部「升序 / 降序」，不新增图标。
     语义同款：逐列稳定叠加（先 A 后 B，A 序保留组内按 B 排）；状态按 tk 存。 */
  const sortState = new Map();          // tk(table) -> [{ci, asc}] 最早到最新
  const numOfCell = s => {
    const t = String(s).replace(/[\s年天人份条%]/g, '');
    return /^[+\-]?\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null;   // 「6.5 年」→6.5；「T3」→ 文本比
  };
  function applySort(table) {
    const st = sortState.get(tk(table));
    const tbody = table.querySelector('tbody');
    if (!tbody || !st || !st.length) return;
    const rows = [...tbody.rows];
    if (rows.length < 2) return;
    const off = colOff(table);                     // 比较器会被调用 O(n log n) 次，别每次重算
    st.forEach(({ ci, asc }) => {
      rows.sort((r1, r2) => {
        const a = cellText(r1, ci, off), b = cellText(r2, ci, off);
        if (a == null || b == null) return 0;
        const e1 = a === '(空白)' || a === '—', e2 = b === '(空白)' || b === '—';
        if (e1 || e2) return e1 && e2 ? 0 : (e1 ? 1 : -1);
        const na = numOfCell(a), nb = numOfCell(b);
        const c = (na != null && nb != null) ? na - nb : a.localeCompare(b, 'zh');
        return asc ? c : -c;
      });
    });
    rows.forEach(r => tbody.appendChild(r));
  }
  window.gridSortBy = function (dir) {
    if (!gridCur) return;
    const key = tk(gridCur.table);
    const st = sortState.get(key) || [];
    const last = st[st.length - 1];
    if (last && last.ci === gridCur.ci) last.asc = dir === 'asc';
    else st.push({ ci: gridCur.ci, asc: dir === 'asc' });
    sortState.set(key, st);
    applySort(gridCur.table);
    refreshSortArrow(gridCur.table);
    gridClosePopup();
  };
  function refreshSortArrow(table) {
    if (!table.tHead || !table.tHead.rows.length) return;
    const st = sortState.get(tk(table)) || [];
    const last = st[st.length - 1];
    [...table.tHead.rows[0].cells].forEach((th, i) => {
      if (th.classList.contains('grid-selth')) return;
      const ci = logicalIndex(table, th);
      let arrow = th.querySelector('.grid-sort-arrow');
      const cur = last && last.ci === ci ? last : null;
      if (!cur) { if (arrow) arrow.remove(); return; }
      if (!arrow) { arrow = document.createElement('span'); arrow.className = 'mi grid-sort-arrow'; th.appendChild(arrow); }
      arrow.textContent = cur.asc ? 'arrow_upward' : 'arrow_downward';
    });
  }

  /* ═══════════ 挂载 ═══════════ */
  function initGrid(table) {
    if (table.closest('.filter-popup')) return;
    if (table.hasAttribute('data-grid-off')) return;
    const thead = table.querySelector('thead');
    if (!thead || !thead.rows.length) return;
    const isEmp = isEmpTable(table);

    if (thead.dataset.gridReady) {
      const sig = tableSig(table);
      if (thead.dataset.gridSig !== sig) { thead.dataset.gridSig = sig; applyAll(table); }
      return;
    }
    thead.dataset.gridReady = '1';
    thead.dataset.gridSig = tableSig(table);

    [...thead.rows[0].cells].forEach((th, ci) => {
      if (th.dataset.gridTh) return;
      if (th.classList.contains('grid-selth')) return;   // 勾选框列不是数据列
      th.dataset.gridTh = '1';
      const label = th.textContent.trim();
      if (!label) return;
      /* 该列声明了自己不可筛（员工明细的「序号」）→ 不给任何「点了有用」的信号 */
      if (th.hasAttribute('data-nofilter')) return;
      th.classList.add('grid-th');
      th.tabIndex = 0;
      const funnel = document.createElement('span');
      funnel.className = 'mi grid-funnel';
      funnel.style.pointerEvents = 'none';
      funnel.textContent = 'filter_list';
      th.appendChild(funnel);

      const hint = '点击筛选「' + label + '」· 右键冻结 / 隐藏 / 多选';
      th.setAttribute('aria-label', hint);
      if (!isEmp) {
        /* 员工明细：点击仍走 table.js 自己的 toggleFilterPopup
           （th 上有内联 onclick + onkeydown，键盘激活由那边负责，这里不再重复挂） */
        const act = () => gridOpenPopup(table, ci, th, label);
        th.addEventListener('click', e => { e.stopPropagation(); act(); });
        th.addEventListener('keydown', e => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault(); act();
        });
      }
      th.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation();
        openHeadMenu(table, ci, th, label, e);
      });
      th.addEventListener('keydown', e => {
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          e.preventDefault(); openHeadMenu(table, ci, th, label, null);
        }
      });
    });

    /* 列多选模式：点表头 = 切换这一列的选中。用捕获阶段拦下，
       这样员工明细表 th 上的内联 onclick（开筛选弹窗）不会跟着触发。 */
    table.addEventListener('click', e => {
      const th = e.target.closest('th');
      if (!th || th.closest('table') !== table) return;
      if (modeKindOf(table) !== 'col') return;
      if (th.classList.contains('grid-selth')) return;
      e.preventDefault(); e.stopPropagation();
      toggleColSel(table, logicalIndex(table, th));
    }, true);

    const tbody = table.querySelector('tbody');
    if (tbody && !tbody.dataset.gridRows) {
      tbody.dataset.gridRows = '1';
      /* 行多选模式：点行 = 切换该行（⌘/Ctrl 点击在非模式下调不动，
         不提供拖拽选区——按住拖是浏览器选文字，用户明确不要）。 */
      tbody.addEventListener('click', e => {
        const tr = e.target.closest('tr');
        if (!tr) return;
        if (modeKindOf(table) === 'row') {
          if (e.target.closest('.grid-cbx')) return;   // 勾选框自己走 change，别重复切换
          e.preventDefault();
          toggleRowSel(table, tr);
          return;
        }
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); toggleRowSel(table, tr); }
      });
      tbody.addEventListener('contextmenu', e => {
        const tr = e.target.closest('tr');
        if (!tr) return;
        e.preventDefault(); e.stopPropagation();
        openRowMenu(table, tr, e);
      });
    }
    applyAll(table);
  }

  /* ═══════════ 勾选框列（只在行多选模式里出现，真列） ═══════════
     插在每行 index 0；列筛选 / 冻结 / 排序一律按「逻辑列序号」走，
     由 cellAt() 统一换算（见文件头的警告）。
     退出模式时 unmountSelCol() 整列摘掉，平时表里根本没有这一列。 */
  function mountSelCol(table) {
    if (!isDataGrid(table)) return;
    const hr = table.tHead && table.tHead.rows[0];
    if (!hr) return;
    if (table.dataset.gridSel !== '1') table.dataset.gridSel = '1';

    if (!hr.cells[0] || !hr.cells[0].classList.contains('grid-selth')) {
      const th = document.createElement('th');
      th.className = 'grid-selth';
      th.dataset.nofilter = '1';
      th.setAttribute('scope', 'col');
      th.setAttribute('aria-label', '选择列');
      th.innerHTML = '<input type="checkbox" class="grid-cbx-all" aria-label="全选本页可见行">';
      hr.insertBefore(th, hr.firstChild);
      const all = th.querySelector('.grid-cbx-all');
      /* 指针落在这格（input 本身 pointer-events:none，见 style.css）；键盘走 input 的 change */
      th.addEventListener('click', e => {
        e.stopPropagation();
        selectAllVisible(table, !all.checked);
      });
      all.addEventListener('change', () => selectAllVisible(table, all.checked));
    }
    /* 其余表头行（多行表头）+ 所有正文行补一个空格子 */
    [...table.tHead.rows, ...allRowsOf(table)].forEach(tr => {
      if (tr === hr) return;
      if (tr.cells[0] && tr.cells[0].classList.contains('grid-selcell')) return;
      const cell = document.createElement(tr.parentElement.tagName === 'THEAD' ? 'th' : 'td');
      cell.className = 'grid-selcell';
      if (cell.tagName === 'TD') {
        cell.innerHTML = '<input type="checkbox" class="grid-cbx" aria-label="选择此行">';
        cell.querySelector('.grid-cbx').addEventListener('change', () => {
          const i = allRowsOf(table).indexOf(tr);
          if (i >= 0) toggleRowKeyAt(table, i);
        });
      }
      tr.insertBefore(cell, tr.firstChild);
    });
  }
  function unmountSelCol(table) {
    /* 平时（没进过行多选）表里根本没有勾选框列：dataset 标记就是「挂过没有」，
       直接返回，省掉每次 applyAll（重渲染/筛选/翻页都会跑）对整表的两趟选择器扫描 */
    if (table.dataset.gridSel !== '1') return;
    delete table.dataset.gridSel;
    table.querySelectorAll('.grid-selth, .grid-selcell').forEach(c => c.remove());
    /* 残留的 sticky 内联样式不用清：applyAll 紧接着会跑 applyFreeze，
       它开头就把每格 position/top/left/zIndex 全部重置再按需重设。 */
  }
  function selectAllVisible(table, on) {
    const keys = rowKeys(table);
    const set = selRows.get(tk(table)) || new Set();
    allRowsOf(table).forEach((tr, i) => {
      if (tr.style.display === 'none') return;
      if (on) set.add(keys[i]); else set.delete(keys[i]);
    });
    selRows.set(tk(table), set);
    applySelStyles(table); updateToolbar(table);
  }

  /* ═══════════ 点击十字高亮 ═══════════
     点单元格=行+列高亮（底色=悬停同款），点表头=仅列；再点同一格取消。 */
  /* col 存的是**逻辑列号**（过了 colOff），行身份走 rowKeys 的 key ——
     与全文件「按列读写一律过 cellAt/logicalIndex」同一套约定。
     nodes 记住上次加过类的节点，取消高亮只碰这几个，不再全文档查一遍。 */
  const xh = { table: null, col: -1, key: null, anchor: null, ti: -1, nodes: [] };
  function xhLocate(table) {
    if (table.id) return { anchor: table.id, ti: -1 };
    const host = table.parentElement ? table.parentElement.closest('[id]') : null;
    if (!host) return null;
    const ti = [...host.querySelectorAll('table')].indexOf(table);
    return ti >= 0 ? { anchor: host.id, ti } : null;
  }
  function xhApply() {
    xh.nodes.forEach(c => c.classList.remove('xh-row', 'xh-col'));
    xh.nodes = [];
    const t = xh.table;
    if (!t || !t.isConnected || xh.col < 0) return;
    const off = colOff(t);
    [...t.querySelectorAll('tr')].forEach(tr => {
      const c = cellAt(tr, xh.col, off);
      if (c) { c.classList.add('xh-col'); xh.nodes.push(c); }
    });
    if (xh.key != null) {
      const i = rowKeys(t).indexOf(xh.key);
      const tr = i >= 0 ? allRowsOf(t)[i] : null;
      if (tr) { tr.classList.add('xh-row'); xh.nodes.push(tr); }
    }
  }
  document.addEventListener('click', e => {
    const cell = e.target && e.target.closest ? e.target.closest('td,th') : null;
    const table = cell ? cell.closest('table') : null;
    if (!table || cell.classList.contains('grid-selcell') || cell.classList.contains('grid-selth')) {
      if (xh.table) { xh.table = null; xh.col = -1; xh.key = null; xhApply(); }
      return;
    }
    const tr = cell.closest('tr');
    const col = logicalIndex(table, cell);
    let key = null;
    if (cell.tagName === 'TD' && tr) {
      const i = allRowsOf(table).indexOf(tr);
      if (i >= 0) key = rowKeys(table)[i];
    }
    if (xh.table === table && xh.col === col && xh.key === key) { xh.table = null; xh.col = -1; xh.key = null; }
    else {
      const loc = xhLocate(table);
      if (!loc) return;
      xh.table = table; xh.col = col; xh.key = key; xh.anchor = loc.anchor; xh.ti = loc.ti;
    }
    xhApply();
  }, true);

  /* ═══════════ 应用：列 → 排序 → 可见性 → 冻结（顺序影响测量）═══════════ */
  function applyAll(table) {
    /* 勾选框列只在「行多选模式」里存在；其余时候连列都没有 */
    if (modeKindOf(table) === 'row') mountSelCol(table); else unmountSelCol(table);
    applyHiddenCols(table);
    applySort(table);             // 重渲染后重放通用排序（先排再分页，页码才对得上）
    applyVisibility(table);       // 隐藏行 + 列筛选 + 搜索 + 分页，一次算完
    applyFreeze(table);
    refreshFunnel(table);
    refreshSortArrow(table);
    applySelStyles(table);        // 重渲染后恢复勾选与选中高亮
    applyColStyles(table);
    ensureToolbar(table);
    updateToolbar(table);
    /* 十字高亮恢复：表格被整体重建后 xh.table 已断链，按锚点认领新表 */
    if ((!xh.table || !xh.table.isConnected) && xh.anchor != null) {
      let t = null;
      if (xh.ti < 0) t = document.getElementById(xh.anchor);
      else { const host = document.getElementById(xh.anchor); if (host) t = host.querySelectorAll('table')[xh.ti]; }
      if (t === table) xh.table = table;
    }
    /* 勾选框列会在进入行多选时插到最左，物理列号跟着变 —— 重新按逻辑列号落一遍 */
    if (xh.table === table) xhApply();
  }

  function applyHiddenCols(table) {
    const hide = hiddenCols.get(tk(table));
    const off = colOff(table);
    const rows = [...(table.tHead ? table.tHead.rows : []), ...(table.tBodies[0] ? table.tBodies[0].rows : [])];
    rows.forEach(tr => {
      /* 直接从 cells 起遍历：逻辑列 ci 就是 cells[ci + off]，不必再逐格查祖先 */
      for (let i = off; i < tr.cells.length; i++) {
        tr.cells[i].style.display = (hide && hide.has(i - off)) ? 'none' : '';
      }
    });
  }

  /* 可见性统一管线：用户隐藏 → 列筛选 → 搜索 → 分页。
     分页只对 mini-table 生效（员工明细有 table.js 自己的分页）。 */
  function applyVisibility(table) {
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    const byCol = new Map();
    [...table.querySelectorAll('thead th')].forEach(th => {
      if (!th.dataset.gridTh || th.classList.contains('grid-selth')) return;
      const ci = logicalIndex(table, th);
      const set = colFilters.get(stateKey(table, ci));
      if (set && set.size) byCol.set(ci, set);
    });
    const k = tk(table);
    const hide = hiddenRows.get(k);
    /* rowKeys 是整表扫（每行一次 textContent 拼接）——只在真有隐藏行时才算 */
    const keys = hide && hide.size ? rowKeys(table) : null;
    const off = colOff(table);
    const q = (searchState.get(k) || '').trim().toLowerCase();
    const paged = isMini(table) && !isEmpTable(table);
    const st = pageState.get(k) || pageDefault();

    const eligible = [];
    [...tbody.rows].forEach((row, ri) => {
      let show = !(keys && hide.has(keys[ri]));
      if (show && byCol.size) {
        for (const [ci, set] of byCol) {
          const v = cellText(row, ci, off);
          if (v === null) continue;
          if (!set.has(v)) { show = false; break; }
        }
      }
      if (show && q && row.textContent.toLowerCase().indexOf(q) < 0) show = false;
      if (show) eligible.push(row); else row.style.display = 'none';
    });

    statCount.set(k, eligible.length);
    if (!paged) { eligible.forEach(r => { r.style.display = ''; }); return; }

    const pages = Math.max(1, Math.ceil(eligible.length / st.size));
    st.page = Math.min(Math.max(1, st.page), pages);
    pageState.set(k, st);
    const start = (st.page - 1) * st.size;
    eligible.forEach((row, i) => { row.style.display = (i >= start && i < start + st.size) ? '' : 'none'; });
  }

  function refreshFunnel(table) {
    [...table.querySelectorAll('thead th')].forEach(th => {
      if (!th.dataset.gridTh || th.classList.contains('grid-selth')) return;
      const set = colFilters.get(stateKey(table, logicalIndex(table, th)));
      th.classList.toggle('grid-filtered', !!(set && set.size));
    });
  }

  /* ── 冻结：fr = 冻结到第几行（正文序号），fc = 冻结到第几个逻辑列 ── */

  function baseTopOf(table) {
    let el = table.parentElement;
    while (el && el !== document.documentElement) {
      if (getComputedStyle(el).overflowY !== 'visible') return 0;
      el = el.parentElement;
    }
    const tb = document.querySelector('.topbar');
    return tb ? (tb.getBoundingClientRect().height || tb.offsetHeight) : 0;
  }
  function rowH(tr) {
    let h = 0;
    [...tr.cells].forEach(c => {
      if (c.style.display === 'none') return;
      h = Math.max(h, c.getBoundingClientRect().height || c.offsetHeight);
    });
    return h;
  }
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

    [...headRows, ...bodyRows].forEach(tr => [...tr.cells].forEach(c => {
      c.classList.remove('grid-frozen-cell', 'grid-frozen-row', 'grid-frozen-col', 'grid-frozen-corner');
      c.style.position = ''; c.style.top = ''; c.style.left = ''; c.style.zIndex = '';
    }));
    if (!st.fr && !st.fc) { pinSelCol(table); return; }

    const base = baseTopOf(table);
    const off = colOff(table);
    const selW = off && headRows[0] && headRows[0].cells[0] ? headRows[0].cells[0].offsetWidth : 0;

    /* ① 列冻结：从勾选框列右侧开始累加可见宽度 */
    let lefts = [];
    if (st.fc > 0) {
      const probe = headRows[0] || bodyRows.find(r => r.style.display !== 'none') || bodyRows[0];
      if (probe) {
        lefts = [selW];
        let acc = selW, frozen = 0;
        for (let i = off; i < probe.cells.length && frozen < st.fc; i++) {
          const c = probe.cells[i];
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
        for (let i = off; i < row.cells.length && frozen < st.fc; i++) {
          const c = row.cells[i];
          if (c.style.display === 'none') continue;
          c.style.position = 'sticky';
          c.style.left = (lefts[frozen] != null ? lefts[frozen] : selW) + 'px';
          c.style.zIndex = zBase;
          c.classList.add('grid-frozen-cell', 'grid-frozen-col');
          frozen++;
        }
      };
      headRows.forEach(tr => markCol(tr, 4));
      bodyRows.forEach(tr => { if (tr.style.display !== 'none') markCol(tr, 2); });
    }

    /* ② 行冻结：表头从基准 top 起浮点累加 */
    let top = base;
    headRows.forEach(tr => {
      [...tr.cells].forEach(c => {
        if (c.style.display === 'none') return;
        c.style.position = 'sticky';
        c.style.top = top + 'px';
        c.style.zIndex = st.fc ? (c.classList.contains('grid-frozen-col') ? 5 : 4) : 3;
        c.classList.add('grid-frozen-cell', 'grid-frozen-row');
        if (st.fc) c.classList.add('grid-frozen-corner');
      });
      top += rowH(tr);
    });
    let frozenRows = 0;
    for (const tr of bodyRows) {
      if (frozenRows >= st.fr) break;
      if (tr.style.display === 'none') continue;
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
    pinSelCol(table);
  }

  /* 勾选框列永远钉最左。放在冻结之后调用，保证它拿到「表头压正文」的层级。 */
  function pinSelCol(table) {
    if (table.dataset.gridSel !== '1') return;
    const headRows = table.tHead ? [...table.tHead.rows] : [];
    const bodyRows = allRowsOf(table);
    headRows.forEach(tr => {
      const c = tr.cells[0];
      if (!c) return;
      c.style.position = 'sticky';
      c.style.left = '0px';
      c.style.zIndex = 6;
    });
    bodyRows.forEach(tr => {
      const c = tr.cells[0];
      if (!c) return;
      c.style.position = 'sticky';
      c.style.left = '0px';
      c.style.zIndex = 3;
    });
  }

  /* ═══════════ 筛选弹窗（只管筛选：值列表 + 清除 / 应用）═══════════ */
  function gridOpenPopup(table, ci, th, label) {
    const popup = document.getElementById('filterPopup');
    if (!popup) return;
    const key = stateKey(table, ci);
    if (gridCur && gridCur.key === key && popup.style.display === 'block') { gridClosePopup(); return; }

    const tbody = table.querySelector('tbody');
    const others = new Map();
    const n = logicalCols(table);
    for (let i = 0; i < n; i++) {
      if (i === ci) continue;
      const set = colFilters.get(stateKey(table, i));
      if (set && set.size) others.set(i, set);
    }
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

    gridCur = { table, ci, key, th };
    window.__fpOnChange = () => gridOnValChange();
    window.__fpApplyOnly = set => { colFilters.set(key, set); applyVisibility(table); refreshFunnel(table); };
    popup.innerHTML =
      fpHeaderHtml(label, 'gridClosePopup()') +
      fpSortHtml("gridSortBy('asc')", "gridSortBy('desc')") +
      `<div class="fp-body">` +
      `<label class="fp-row fp-all"><input type="checkbox" class="cb-all"${allChecked ? ' checked' : ''} onchange="gridToggleAll(this)"><b>全选</b><span class="fp-count">${total}</span></label>` +
      fpRenderList(entries, selected, 'gridOnValChange()') + '</div>' +
      `<div class="fp-foot">` +
      `<button class="tb-btn" onclick="gridClearColumn()">清除本列筛选</button>` +
      `<button class="tb-btn primary" onclick="gridClosePopup()">应用筛选</button></div>`;

    popup.style.display = 'block';
    fpPlacePopup(popup, th.getBoundingClientRect(), 360, 240);
    fpOpenDialog(popup, label);
  }

  function collectChecked() {
    const selected = new Set();
    document.querySelectorAll('#filterPopup input[type="checkbox"][data-val]')
      .forEach(c => { if (c.checked) selected.add(c.dataset.val); });
    return selected;
  }
  window.gridOnValChange = function () {
    if (!gridCur) return;
    const sel = collectChecked();
    if (sel.size) colFilters.set(gridCur.key, sel);
    else colFilters.delete(gridCur.key);
    pageState.delete(tk(gridCur.table));       // 筛选变了回到第 1 页
    applyVisibility(gridCur.table);
    refreshFunnel(gridCur.table);
    updateToolbar(gridCur.table);
  };
  window.gridToggleAll = function (cb) {
    document.querySelectorAll('#filterPopup input[type="checkbox"][data-val]')
      .forEach(c => { c.checked = cb.checked; });
    gridOnValChange();
    fpSyncNodes();
  };
  window.gridClearColumn = function () {
    if (gridCur) {
      colFilters.delete(gridCur.key);
      pageState.delete(tk(gridCur.table));
      applyVisibility(gridCur.table);
      updateToolbar(gridCur.table);
    }
    gridClosePopup();
  };
  window.gridClosePopup = function () {
    const p = document.getElementById('filterPopup');
    if (p && p.style.display === 'block') {
      p.style.display = 'none';
      fpFocus(gridCur && gridCur.th);
    }
    gridCur = null;
  };

  function setFreeze(table, fr, fc) {
    const k = tk(table);
    const st = freezeState.get(k) || { fr: 0, fc: 0 };
    if (fr !== null && fr !== undefined) st.fr = fr;
    if (fc !== null && fc !== undefined) st.fc = fc;
    if (st.fr <= 0 && st.fc <= 0) freezeState.delete(k);
    else freezeState.set(k, st);
    applyAll(table);
  }

  /* ═══════════ 行身份与选中 ═══════════
     行 key = 员工表的 data-eid，其余用「整行文本 + 同文本第几次出现」——
     跨分页/重渲染稳定，序号列（页内递增）不会污染 key。 */
  function allRowsOf(table) {
    return [...(table.tBodies[0] ? table.tBodies[0].rows : [])];
  }
  function rowKeys(table) {
    const counts = new Map();
    return allRowsOf(table).map(tr => {
      if (tr.dataset && tr.dataset.eid) return 'e:' + tr.dataset.eid;
      const txt = tr.textContent;
      const n = counts.get(txt) || 0;
      counts.set(txt, n + 1);
      return txt + '#' + n;
    });
  }
  function toggleRowKeyAt(table, ri) {
    const keys = rowKeys(table);
    if (ri < 0 || ri >= keys.length) return;
    setRowKey(table, keys[ri]);
  }
  function setRowKey(table, key, on) {
    const k = tk(table);
    const set = selRows.get(k) || new Set();
    if (on === undefined) on = !set.has(key);
    if (on) set.add(key); else set.delete(key);
    if (set.size) selRows.set(k, set); else selRows.delete(k);
    applySelStyles(table);
    updateToolbar(table);
  }
  function toggleRowSel(table, tr) {
    const i = allRowsOf(table).indexOf(tr);
    if (i >= 0) toggleRowKeyAt(table, i);
  }
  function toggleColSel(table, ci) {
    const k = tk(table);
    const set = selCols.get(k) || new Set();
    if (set.has(ci)) set.delete(ci); else set.add(ci);
    if (set.size) selCols.set(k, set); else selCols.delete(k);
    applyColStyles(table);
    updateToolbar(table);
  }

  /* ═══════════ 进出多选模式 ═══════════
     入口 = 右键行 / 表头菜单的「多选隐藏…」（见 openRowMenu / openHeadMenu）。
     模式只作用于一张表；进别的表的多选会先退出上一张。 */
  function enterSelMode(table, kind) {
    const k = tk(table);
    if (selMode && selMode.tk === k && selMode.kind === kind) return;
    if (selMode && selMode.kind === 'row' && selMode.table !== table) unmountSelCol(selMode.table);
    selRows.delete(k);
    selCols.delete(k);
    selMode = { table, kind, tk: k };
    applyAll(table);
    updateToolbar(table);
  }
  function exitSelMode(table) {
    if (!selMode) return;
    if (table && selMode.tk !== tk(table)) return;
    const t = selMode.table;
    selRows.delete(selMode.tk);
    selCols.delete(selMode.tk);
    selMode = null;
    if (t && t.isConnected) applyAll(t);
  }

  /* 行高亮 + 勾选框同步（只碰扫一遍，避免 O(行²)） */
  function applySelStyles(table) {
    if (!isDataGrid(table)) return;
    const k = tk(table);
    const sel = selRows.get(k);
    const keys = sel && sel.size ? rowKeys(table) : null;   // 没选任何行就不必整表取 key
    let visN = 0, selVis = 0;
    allRowsOf(table).forEach((tr, i) => {
      const on = !!(keys && sel.has(keys[i]));
      tr.classList.toggle('grid-sel-row', on);
      const cb = tr.cells[0] && tr.cells[0].querySelector('.grid-cbx');
      if (cb) cb.checked = on;
      if (tr.style.display !== 'none') { visN++; if (on) selVis++; }
    });
    const allCb = table.querySelector('thead .grid-cbx-all');
    if (allCb) {
      allCb.checked = visN > 0 && selVis === visN;
      allCb.indeterminate = selVis > 0 && selVis < visN;
    }
  }
  function applyColStyles(table) {
    if (!isDataGrid(table)) return;
    table.querySelectorAll('.grid-sel-col').forEach(el => el.classList.remove('grid-sel-col'));
    const cs = selCols.get(tk(table));
    if (!cs || !cs.size) return;
    const off = colOff(table);
    const rows = [...(table.tHead ? table.tHead.rows : []), ...allRowsOf(table)];
    cs.forEach(ci => {
      rows.forEach(tr => { const c = cellAt(tr, ci, off); if (c) c.classList.add('grid-sel-col'); });
    });
  }

  /* ═══════════ 隐藏行/列 + 恢复 ═══════════ */
  function hideSelected(table) {
    if (!table) return;
    const k = tk(table);
    const rs = selRows.get(k), cs = selCols.get(k);
    let n = 0;
    if (rs && rs.size) {
      const set = hiddenRows.get(k) || new Set();
      rs.forEach(x => set.add(x));
      hiddenRows.set(k, set);
      n += rs.size;
      selRows.delete(k);
    }
    if (cs && cs.size) {
      const set = hiddenCols.get(k) || new Set();
      cs.forEach(x => set.add(x));
      hiddenCols.set(k, set);
      n += cs.size;
      selCols.delete(k);
    }
    if (n) {
      if (selMode && selMode.tk === k) selMode = null;   // 隐藏完就退出多选，勾选框列随之摘掉
      applyAll(table);                                   // 末尾自带 updateToolbar
    } else {
      updateToolbar(table);                              // 没东西可藏，只把计数刷一遍
    }
  }
  function restoreHidden(table) {
    if (!table) return;
    const k = tk(table);
    hiddenRows.delete(k);
    hiddenCols.delete(k);
    pageState.delete(k);
    applyAll(table);
  }

  /* ═══════════ 统一工具栏（搜索 / 隐藏 / CSV / 分页）═══════════
     2026-10-21 用户要求「看板里的表格都统一样式功能」。
     员工明细表已有自己的搜索/分页/CSV，这里只补「隐藏所选 / 恢复隐藏」，
     否则页面上会出现两套搜索框。 */
  function ensureToolbar(table) {
    if (!isDataGrid(table)) return null;
    const host = table.parentElement;
    if (!host || !host.parentNode) return null;
    const key = tk(table);
    let tb = host.previousElementSibling;
    if (tb && tb.classList.contains('grid-tb') && tb.dataset.gtb === key) { tb._tbl = table; return tb; }
    const emp = isEmpTable(table);
    tb = document.createElement('div');
    tb.className = 'grid-tb';
    tb.dataset.gtb = key;
    tb.innerHTML =
      `<div class="gtb-left">` +
      (emp ? '' : `<input class="gtb-search" type="search" placeholder="搜索本表…" aria-label="搜索本表">`) +
      `<span class="gtb-count" aria-live="polite"></span>` +
      `<button class="tb-btn gtb-btn" data-act="hide" disabled><span class="mi">visibility_off</span>隐藏所选</button>` +
      `<button class="tb-btn gtb-btn" data-act="restore" disabled><span class="mi">undo</span>恢复隐藏</button>` +
      `<button class="tb-btn gtb-btn" data-act="exit" style="display:none"><span class="mi">close</span>退出多选</button>` +
      (emp ? '' : `<button class="tb-btn gtb-btn" data-act="csv"><span class="mi">download</span>导出 CSV</button>`) +
      `</div>` +
      (emp ? '' :
        `<div class="gtb-page">` +
        `<button class="tb-btn gtb-btn" data-act="prev" aria-label="上一页"><span class="mi">chevron_left</span></button>` +
        `<span class="gtb-page-n"></span>` +
        `<button class="tb-btn gtb-btn" data-act="next" aria-label="下一页"><span class="mi">chevron_right</span></button>` +
        `<select class="gtb-size" aria-label="每页行数"><option value="20">20 行</option><option value="50">50 行</option><option value="100">100 行</option></select>` +
        `</div>`);
    host.parentNode.insertBefore(tb, host);
    tb._tbl = table;
    bindToolbar(tb);
    return tb;
  }

  /* 工具栏里「只改了可见性」的动作共用这一段：列/行筛选没变，所以不走整条 applyAll */
  function repaint(table) {
    applyVisibility(table);
    applyFreeze(table);
    applySelStyles(table);
    updateToolbar(table);
  }

  function bindToolbar(tb) {
    tb.addEventListener('click', e => {
      const btn = e.target.closest('.gtb-btn');
      if (!btn || btn.disabled || !tb._tbl) return;
      const act = btn.dataset.act;
      const table = tb._tbl;
      const k = tk(table);
      const st = pageState.get(k) || pageDefault();
      if (act === 'hide') hideSelected(table);
      else if (act === 'restore') restoreHidden(table);
      else if (act === 'exit') exitSelMode(table);
      else if (act === 'csv') exportCsv(table);
      else if (act === 'prev' || act === 'next') {
        st.page += (act === 'next' ? 1 : -1);
        pageState.set(k, st);
        repaint(table);
      }
    });
    const search = tb.querySelector('.gtb-search');
    if (search) {
      let t = null;
      search.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          if (!tb._tbl) return;
          const table = tb._tbl;
          const v = search.value || '';
          if (v.trim()) searchState.set(tk(table), v); else searchState.delete(tk(table));
          pageState.delete(tk(table));
          repaint(table);
        }, 160);
      });
    }
    const size = tb.querySelector('.gtb-size');
    if (size) {
      size.addEventListener('change', () => {
        if (!tb._tbl) return;
        const table = tb._tbl;
        const k = tk(table);
        pageState.set(k, { size: Math.max(10, parseInt(size.value, 10) || 50), page: 1 });
        repaint(table);
      });
    }
  }

  function updateToolbar(table) {
    const tb = table && table.parentElement ? table.parentElement.previousElementSibling : null;
    if (!tb || !tb.classList || !tb.classList.contains('grid-tb')) return;
    const k = tk(table);
    const nR = (selRows.get(k) || new Set()).size;
    const nC = (selCols.get(k) || new Set()).size;
    const hiddenN = ((hiddenRows.get(k) || new Set()).size) + ((hiddenCols.get(k) || new Set()).size);

    /* 按钮文字只在数量变化时才重写：写 innerHTML 会重建 .mi 图标节点并触发连字重排，
       而 updateToolbar 每次 applyAll / 每次点选都会跑 */
    const setLabel = (btn, icon, text, n) => {
      btn.disabled = !n;
      const label = icon + text + (n ? '（' + n + '）' : '');
      if (btn._label === label) return;
      btn._label = label;
      btn.innerHTML = `<span class="mi">${icon}</span>${text}${n ? '（' + n + '）' : ''}`;
    };
    const hideBtn = tb.querySelector('[data-act="hide"]');
    if (hideBtn) setLabel(hideBtn, 'visibility_off', '隐藏所选', nR + nC);
    const rsBtn = tb.querySelector('[data-act="restore"]');
    if (rsBtn) setLabel(rsBtn, 'undo', '恢复隐藏', hiddenN);
    const exitBtn = tb.querySelector('[data-act="exit"]');
    if (exitBtn) exitBtn.style.display = (selMode && selMode.tk === k) ? '' : 'none';

    const count = tb.querySelector('.gtb-count');
    const all = allRowsOf(table).length;
    const matched = statCount.has(k) ? statCount.get(k) : all;
    if (count) {
      const parts = [];
      if (nR) parts.push(`已选 ${nR} 行`);
      if (nC) parts.push(`已选 ${nC} 列`);
      count.textContent = parts.join(' · ') || (matched !== all ? `匹配 ${matched}/${all} 行` : '');
      count.classList.toggle('on', !!(nR + nC));
    }

    const pageBox = tb.querySelector('.gtb-page');
    if (pageBox) {
      const st = pageState.get(k) || pageDefault();
      const pages = Math.max(1, Math.ceil(matched / st.size));
      pageBox.querySelector('.gtb-page-n').textContent = `第 ${st.page}/${pages} 页`;
      pageBox.querySelector('[data-act="prev"]').disabled = st.page <= 1;
      pageBox.querySelector('[data-act="next"]').disabled = st.page >= pages;
      pageBox.querySelector('.gtb-size').value = String(st.size);
      pageBox.style.display = matched > st.size ? '' : 'none';
    }
  }

  /* CSV：所见即所得（只导当前可见行 × 可见列），勾选框列与隐藏列都不进文件 */
  function exportCsv(table) {
    const off = colOff(table);
    const hr = table.tHead && table.tHead.rows[0];
    if (!hr) return;
    const idxs = [...hr.cells].map((_, i) => i).filter(i => i >= off && hr.cells[i].style.display !== 'none');
    const head = idxs.map(i => hr.cells[i].textContent.trim());
    const rows = allRowsOf(table).filter(tr => tr.style.display !== 'none')
      .map(tr => idxs.map(i => (tr.cells[i] ? tr.cells[i].textContent.trim() : '')));
    /* 只给基名：日期戳由 downloadCsv() 统一拼（再自己拼一次会变成 xxx_2026-10-26_2026-10-26.csv） */
    downloadCsv(table.id || pageId(table).replace('page-', '') || 'table', csvText(head, rows));
  }

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

  function openRowMenu(table, tr, ev) {
    const st = freezeState.get(tk(table)) || { fr: 0, fc: 0 };
    const idx = allRowsOf(table);
    const ri = idx.indexOf(tr);
    const hid = hiddenRows.get(tk(table));
    openMenu([
      { label: `<span class="mi">${st.fr ? 'lock_open' : 'vertical_align_top'}</span> ${st.fr ? '取消行冻结' : `冻结到此行（表头 + 前 ${Math.min(ri + 1, idx.length)} 行）`}`,
        fn: () => setFreeze(table, st.fr ? 0 : ri + 1, null) },
      { label: '<span class="mi">visibility_off</span> 隐藏此行', fn: () => {
          const set = hiddenRows.get(tk(table)) || new Set();
          const key = rowKeys(table)[ri];
          if (key) set.add(key);
          hiddenRows.set(tk(table), set); applyAll(table);
        } },
      { label: '<span class="mi">checklist</span> 多选隐藏…', fn: () => enterSelMode(table, 'row') },
      '-',
      { label: `<span class="mi">undo</span> 恢复隐藏（${(hid && hid.size) || 0}）`, disabled: !hid || !hid.size,
        fn: () => restoreHidden(table) },
    ], ev ? ev.clientX : tr.getBoundingClientRect().left, ev ? ev.clientY : tr.getBoundingClientRect().bottom);
  }
  function openHeadMenu(table, ci, th, label, ev) {
    const st = freezeState.get(tk(table)) || { fr: 0, fc: 0 };
    const hid = hiddenCols.get(tk(table));
    openMenu([
      { label: `<span class="mi">${st.fc ? 'lock_open' : 'vertical_align_top'}</span> ${st.fc ? '取消列冻结' : `冻结到此列（${esc(label)} 及以左）`}`,
        fn: () => setFreeze(table, null, st.fc ? 0 : ci + 1) },
      { label: `<span class="mi">visibility_off</span> 隐藏「${esc(label)}」列`, fn: () => {
          const set = hiddenCols.get(tk(table)) || new Set();
          set.add(ci); hiddenCols.set(tk(table), set); applyAll(table);
        } },
      { label: '<span class="mi">checklist</span> 多选隐藏…', fn: () => enterSelMode(table, 'col') },
      '-',
      { label: `<span class="mi">undo</span> 恢复隐藏（${(hid && hid.size) || 0}）`, disabled: !hid || !hid.size,
        fn: () => restoreHidden(table) },
    ], ev ? ev.clientX : th.getBoundingClientRect().left, ev ? ev.clientY : th.getBoundingClientRect().bottom);
  }

  /* Esc：关菜单 / 关弹窗 / 清空选中 */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (menuEl) menuEl.style.display = 'none';
    gridClosePopup();
    if (selMode) exitSelMode(null);
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
