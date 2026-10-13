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

  /* 多选模式：{ table, kind:'row'|'col', keys:Set(行key), cols:Set(ci), tk:表标识 }
     2026-10-13 重构：选中按「行身份 key」存（整行文本+同文序号），翻页/重渲染后自动恢复；
     员工表分页是整表重建（旧表被替换），靠 tk 匹配重绑新表 */
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
    rebindIfReplaced(table);   // 分页整表重建后接续多选状态

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
      /* 该列声明了自己不可筛（员工明细的「序号」）→ 不给任何「点了有用」的信号：
         不加 .grid-th（指针光标）、不加 tabindex（键盘能聚焦却按不动 = 焦点陷阱）、不加漏斗 */
      if (th.hasAttribute('data-nofilter')) return;
      th.classList.add('grid-th');
      th.tabIndex = 0;   // 列头可聚焦：键盘可达 + 关弹窗后焦点有处可归
      const funnel = document.createElement('span');
      funnel.className = 'mi grid-funnel';
      funnel.style.pointerEvents = 'none';      // 别拦住 th 自己的点击
      funnel.textContent = 'filter_list';
      th.appendChild(funnel);

      /* 读屏名而不是原生 title：title 会弹系统气泡、且不算可访问名（G11）。
         「右键冻结/隐藏」不是唯一入口 —— 弹窗底部本来就有这两个按钮，所以这里降级为读屏提示。 */
      const hint = '点击筛选「' + label + '」· 右键冻结 / 隐藏';
      if (isEmp) {
        /* 员工明细：点击仍走 table.js 自己的 toggleFilterPopup（th 上有内联 onclick） */
        th.setAttribute('aria-label', hint);
      } else {
        th.setAttribute('aria-label', hint);
        th.addEventListener('click', e => {
          e.stopPropagation();
          if (selMode && selMode.table === table && selMode.kind === 'col') { toggleColSel(table, ci); return; }
          gridOpenPopup(table, ci, th, label);
        });
      }
      th.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation();
        openHeadMenu(table, ci, th, label, e);
      });
    });

    const tbody = table.querySelector('tbody');
    if (tbody && !tbody.dataset.gridRows) {
      tbody.dataset.gridRows = '1';
      tbody.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        const tr = e.target.closest('tr');
        if (!tr || e.target.closest('.grid-cbx, .grid-cbx-all')) return;
        const active = selMode && selMode.table === table && selMode.kind === 'row';
        if (!active || e.ctrlKey || e.metaKey) return;   // 非模式/Ctrl 加选走 click
        e.preventDefault();                              // 拖拽期间禁止选中文本
        const idx = allRowsOf(table).indexOf(tr);
        if (idx < 0) return;
        dragSel = { table, anchor: idx, last: idx };
        selRange(table, idx, idx);
      });
      tbody.addEventListener('mouseover', e => {
        if (!dragSel || dragSel.table !== table) return;
        const tr = e.target.closest('tr');
        if (!tr) return;
        const idx = allRowsOf(table).indexOf(tr);
        if (idx < 0 || idx === dragSel.last) return;
        dragSel.last = idx;
        selRange(table, dragSel.anchor, idx);            // Excel 式：拖到哪选到哪（区间替换）
      });
      tbody.addEventListener('click', e => {
        const tr = e.target.closest('tr');
        if (!tr) return;
        const active = selMode && selMode.table === table && selMode.kind === 'row';
        if (active) {
          e.stopPropagation();
          if (e.ctrlKey || e.metaKey) toggleRowSel(table, tr);  // Ctrl=加/减选；普通点击已由 mousedown 按区间处理
          return;
        }
        if (e.ctrlKey || e.metaKey) {           // 任何时刻 Ctrl+点行 = 临时多选
          e.preventDefault(); toggleRowSel(table, tr);
        }
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

  /* ═══════════ 应用：隐藏列 → 隐藏行 → 冻结（顺序影响测量）═══════════ */
  function applyAll(table) {
    applyHiddenCols(table);
    applyGridFilter(table);       // 行筛选与隐藏行合并处理
    if (selMode && selMode.table === table && selMode.kind === 'row') mountCheckboxes(table); // 先挂勾选框再测冻结宽度
    applyFreeze(table);
    refreshFunnel(table);
    if (selMode && selMode.table === table) applySelVisual(table);  // 重渲染后恢复选中高亮
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
    const keys = hide && hide.size ? rowKeys(table) : null;   // 2026-10-13：隐藏行按行身份存
    [...tbody.rows].forEach((row, ri) => {
      let show = !(keys && hide.has(keys[ri]));
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

    /* ② 行冻结：表头从基准 top 起浮点累加；冻结行接在表头之后
       ⚠ z 层级：冻结列的表头(5) > 普通表头(4) > 正文冻结格(2)——
       2026-10-13 修复：此前所有表头统一 z=5，横向滚动时未冻结表头
       （DOM 靠后）盖住冻结列表头，视觉上=「冻结列时表头没有冻结」 */
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

    gridCur = { table, ci, key, th };
    /* 值列表渲染走 core.js 共享实现：日期列自动分组 年→月→日，每行 hover「仅筛此项」 */
    window.__fpOnChange = () => gridOnValChange();
    window.__fpApplyOnly = set => { colFilters.set(key, set); applyGridFilter(table); refreshFunnel(table); };
    popup.innerHTML =
      fpHeaderHtml(label, 'gridClosePopup()') +
      `<div class="fp-body">` +
      `<label class="fp-row fp-all"><input type="checkbox" class="cb-all"${allChecked ? ' checked' : ''} onchange="gridToggleAll(this)"><b>全选</b><span class="fp-count">${total}</span></label>` +
      fpRenderList(entries, selected, 'gridOnValChange()') + '</div>' +
      `<div class="fp-foot split">` +
      `<span><button class="tb-btn" onclick="gridFreezeCol()" aria-label="冻结表头到此列（含以左全部冻结）">冻结到此列</button> <button class="tb-btn" onclick="gridHideCol()">隐藏本列</button></span>` +
      `<span><button class="tb-btn" onclick="gridClearColumn()">清除</button> <button class="tb-btn primary" onclick="gridClosePopup()">确定</button></span></div>`;

    popup.style.display = 'block';
    const rect = th.getBoundingClientRect();
    fpPlacePopup(popup, rect, 340, 240);
    /* 读屏可达 + 焦点进弹窗（与 table.js 员工明细弹窗同一套规范） */
    fpOpenDialog(popup, label);
  }

  function collectChecked() {
    const selected = new Set();
    /* 只认叶子（data-val）：日期分组节点 .cb-node 不带值 */
    document.querySelectorAll('#filterPopup input[type="checkbox"][data-val]')
      .forEach(c => { if (c.checked) selected.add(c.dataset.val); });
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
    document.querySelectorAll('#filterPopup input[type="checkbox"][data-val]')
      .forEach(c => { c.checked = cb.checked; });
    gridOnValChange();
    fpSyncNodes();
  };
  window.gridClearColumn = function () {
    if (gridCur) { colFilters.delete(gridCur.key); applyGridFilter(gridCur.table); }
    gridClosePopup();
  };
  window.gridClosePopup = function () {
    const p = document.getElementById('filterPopup');
    if (p && p.style.display === 'block') {
      p.style.display = 'none';
      fpFocus(gridCur && gridCur.th);   // 焦点归还触发列头
    }
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

  /* ═══════════ 行身份与选中恢复（2026-10-13）═══════════
     行 key = 整行文本 + 同文本第几次出现——跨分页/重渲染稳定，
     序号列（页内递增）不会污染 key。员工表首列是页内序号，故不能用首格。 */
  function rowKeys(table) {
    const counts = new Map();
    return allRowsOf(table).map(tr => {
      const txt = tr.textContent;
      const n = counts.get(txt) || 0;
      counts.set(txt, n + 1);
      return txt + '#' + n;
    });
  }
  function rowKeyAt(table, ri) { return rowKeys(table)[ri]; }

  /* 勾选框：塞进每行第一个可见格（不动列结构，ci 体系不受影响） */
  function mountCheckboxes(table) {
    const keys = rowKeys(table);
    const tbody = table.tBodies[0];
    if (!tbody) return;
    const headTh = table.tHead && table.tHead.rows[0].cells[0];
    if (headTh && !headTh.querySelector('.grid-cbx-all')) {
      const all = document.createElement('input');
      all.type = 'checkbox'; all.className = 'grid-cbx-all';
      all.setAttribute('aria-label', '全选本页可见行');
      all.addEventListener('click', e => e.stopPropagation());
      all.addEventListener('change', () => {
        const keysNow = rowKeys(table);
        allRowsOf(table).forEach((tr, i) => {
          if (tr.style.display === 'none') return;
          if (all.checked) selMode.keys.add(keysNow[i]);
          else selMode.keys.delete(keysNow[i]);
        });
        applySelVisual(table); showBar();
      });
      headTh.insertBefore(all, headTh.firstChild);
    }
    allRowsOf(table).forEach((tr, i) => {
      const td = [...tr.cells].find(c => c.style.display !== 'none');
      if (!td || td.querySelector('.grid-cbx')) return;
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.className = 'grid-cbx';
      cb.checked = selMode.keys.has(keys[i]);
      cb.addEventListener('click', e => e.stopPropagation());
      cb.addEventListener('change', () => toggleRowKey(table, keys[i], cb.checked));
      td.insertBefore(cb, td.firstChild);
    });
  }
  function unmountCheckboxes(table) {
    table.querySelectorAll('.grid-cbx, .grid-cbx-all').forEach(el => el.remove());
  }
  /* 按 key 选中/取消一行，并同步视觉与勾选框 */
  function toggleRowKey(table, key, on) {
    if (on === undefined) on = !selMode.keys.has(key);
    if (on) selMode.keys.add(key); else selMode.keys.delete(key);
    applySelVisual(table); showBar();
  }
  /* Excel 式拖拽：区间替换选中（含锚点行..当前行） */
  let dragSel = null;
  function selRange(table, a, b) {
    if (!selMode || selMode.table !== table) return;
    const keys = rowKeys(table);
    const lo = Math.min(a, b), hi = Math.max(a, b);
    selMode.keys = new Set(keys.slice(lo, hi + 1));
    applySelVisual(table); showBar();
  }
  document.addEventListener('mouseup', () => { dragSel = null; });
  /* 重渲染后由 applyAll 调用：勾选框重挂 + 高亮恢复 */
  function applySelVisual(table) {
    if (!selMode || selMode.table !== table) return;
    if (selMode.kind === 'row') {
      const keys = rowKeys(table);
      /* 一遍过：高亮 / 勾选框 / 可见计数 / 已选可见计数一起算。
         原先第二遍写成 vis.filter(... allRowsOf(table).indexOf(tr) ...)，每行都把整表重算一遍 key
         （rowKeys 要对每行做全行 textContent 拼接），是 O(行²) 次文本读取；
         员工明细每页可到 500 行，而拖拽框选的每个 mouseover 都会调到这里 —— 明细页卡顿的源。 */
      let visN = 0, selVis = 0;
      allRowsOf(table).forEach((tr, i) => {
        const on = selMode.keys.has(keys[i]);
        tr.classList.toggle('grid-sel-row', on);
        const cb = tr.querySelector('.grid-cbx');
        if (cb) cb.checked = on;
        if (tr.style.display !== 'none') { visN++; if (on) selVis++; }
      });
      const allCb = table.querySelector('thead .grid-cbx-all');
      if (allCb) {
        allCb.checked = visN > 0 && selVis === visN;
        allCb.indeterminate = selVis > 0 && selVis < visN;
      }
    } else {
      const ths = table.tHead.rows[0].cells;
      allRowsOf(table).forEach(tr => [...tr.cells].forEach((c, ci) => c.classList.toggle('grid-sel-col', selMode.cols.has(ci))));
      [...ths].forEach((th, ci) => th.classList.toggle('grid-sel-col', selMode.cols.has(ci)));
    }
  }

  /* ═══════════ 隐藏行/列 + 多选 ═══════════ */
  function toggleRowSel(table, tr) {
    ensureSel(table, 'row');
    const keys = rowKeys(table);
    const ri = allRowsOf(table).indexOf(tr);
    if (ri >= 0) toggleRowKey(table, keys[ri]);
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
      selMode = { table, kind, keys: new Set(), cols: new Set(), tk: tk(table) };
      table.classList.add('grid-selmode');
      if (kind === 'row') mountCheckboxes(table);
    }
    return selMode;
  }
  /* 表被整表重建（分页/重渲染）后：按 tk 重绑 selMode / barTable 指向新表 */
  function rebindIfReplaced(table) {
    if (selMode && selMode.table !== table && selMode.tk === tk(table)) {
      selMode.table = table;
      if (selMode.kind === 'row') { mountCheckboxes(table); applySelVisual(table); }
      if (barTable && !barTable.isConnected) barTable = table;
    }
  }
  function clearSelVisual() {
    if (!selMode) return;
    selMode.table.querySelectorAll('.grid-sel-row').forEach(el => el.classList.remove('grid-sel-row'));
    selMode.table.querySelectorAll('.grid-sel-col').forEach(el => el.classList.remove('grid-sel-col'));
    unmountCheckboxes(selMode.table);
    selMode.table.classList.remove('grid-selmode');
    selMode = null;
  }
  function exitSelMode() { clearSelVisual(); if (barTable) showBar(); }

  function hideSelected() {
    if (!selMode) return;
    const table = selMode.table, kind = selMode.kind;
    const k = tk(table);
    if (kind === 'row' && selMode.keys.size) {
      const set = hiddenRows.get(k) || new Set();
      selMode.keys.forEach(key => set.add(key));   // 按行身份存，跨页/重渲染稳定
      hiddenRows.set(k, set);
      selMode.keys.clear();                        // 留在模式里继续勾选
      applyAll(table);                             // 内部会恢复勾选框与高亮
    } else if (kind === 'col' && selMode.cols.size) {
      const set = hiddenCols.get(k) || new Set();
      selMode.cols.forEach(ci => set.add(ci));
      hiddenCols.set(k, set);
      clearSelVisual();
      applyAll(table);
    }
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

  /* 2026-10-13 瘦身为 4 项：冻结改开关态（低频的「取消冻结」并入第一项）、
     多选入口合一、恢复隐藏带计数；图标一律 Material（旧 ❄✂ emoji 退役）；位置跟随鼠标 */
  function openRowMenu(table, tr, ev) {
    barTable = table;
    const st = freezeState.get(tk(table)) || { fr: 0, fc: 0 };
    const idx = allRowsOf(table);
    const ri = idx.indexOf(tr);
    const hid = hiddenRows.get(tk(table));
    openMenu([
      { label: `<span class="mi">${st.fr ? 'lock_open' : 'vertical_align_top'}</span> ${st.fr ? '取消行冻结' : `冻结到此行（表头 + 前 ${Math.min(ri + 1, idx.length)} 行）`}`,
        fn: () => setFreeze(table, st.fr ? 0 : ri + 1, null) },
      { label: '<span class="mi">visibility_off</span> 隐藏此行', fn: () => {
          const set = hiddenRows.get(tk(table)) || new Set();
          const key = rowKeyAt(table, ri);
          if (key) set.add(key);
          hiddenRows.set(tk(table), set); applyAll(table); showBar();
        } },
      { label: '<span class="mi">checklist</span> 多选隐藏…', fn: () => { ensureSel(table, 'row'); applySelVisual(table); showBar(); } },
      '-',
      { label: `<span class="mi">undo</span> 恢复隐藏（${(hid && hid.size) || 0}）`, disabled: !hid || !hid.size,
        fn: () => { hiddenRows.delete(tk(table)); hiddenCols.delete(tk(table)); applyAll(table); showBar(); } },
    ], ev ? ev.clientX : tr.getBoundingClientRect().left, ev ? ev.clientY : tr.getBoundingClientRect().bottom);
  }
  function openHeadMenu(table, ci, th, label, ev) {
    barTable = table;
    const st = freezeState.get(tk(table)) || { fr: 0, fc: 0 };
    const hid = hiddenCols.get(tk(table));
    openMenu([
      { label: `<span class="mi">${st.fc ? 'lock_open' : 'vertical_align_top'}</span> ${st.fc ? '取消列冻结' : `冻结到此列（${esc(label)} 及以左）`}`,
        fn: () => setFreeze(table, null, st.fc ? 0 : ci + 1) },
      { label: `<span class="mi">visibility_off</span> 隐藏「${esc(label)}」列`, fn: () => {
          const set = hiddenCols.get(tk(table)) || new Set();
          set.add(ci); hiddenCols.set(tk(table), set); applyAll(table); showBar();
        } },
      { label: '<span class="mi">checklist</span> 多选隐藏…', fn: () => { ensureSel(table, 'col'); showBar(); } },
      '-',
      { label: `<span class="mi">undo</span> 恢复隐藏（${(hid && hid.size) || 0}）`, disabled: !hid || !hid.size,
        fn: () => { hiddenRows.delete(tk(table)); hiddenCols.delete(tk(table)); applyAll(table); showBar(); } },
    ], ev ? ev.clientX : th.getBoundingClientRect().left, ev ? ev.clientY : th.getBoundingClientRect().bottom);
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
    const selN = selMode && selMode.table === barTable ? (selMode.kind === 'row' ? selMode.keys.size : selMode.cols.size) : 0;

    bar.innerHTML =
      (mode
        ? `<span class="gb-label">${mode === 'row' ? '点行或行首勾选框选择' : '点表头选择'}</span>` +
          `<button class="gb-btn primary" onclick="gridBarHideSel()"${selN ? '' : ' disabled'}>隐藏所选（${selN}）</button>` +
          `<button class="gb-btn" onclick="gridRestoreHidden()"${(nR + nC) ? '' : ' disabled'} aria-label="显示全部被隐藏的行/列"><span class="mi">undo</span> 恢复(${nR + nC})</button>` +
          `<button class="gb-btn" onclick="gridBarExit()">退出</button>`
        : `<span class="gb-label">冻结到</span>` +
          `<select class="gb-sel" onchange="gridBarFreeze('row',+this.value)">` +
            Array.from({ length: Math.min(8, nBody) + 1 }, (_, i) => `<option value="${i}"${st.fr === i ? ' selected' : ''}>${i ? i + ' 行' : '无'}</option>`).join('') +
          `</select>` +
          `<select class="gb-sel" onchange="gridBarFreeze('col',+this.value)">` +
            Array.from({ length: Math.min(5, nHead) + 1 }, (_, i) => `<option value="${i}"${st.fc === i ? ' selected' : ''}>${i ? i + ' 列' : '无'}</option>`).join('') +
          `</select>` +
          `<span class="gb-sep"></span>` +
          `<button class="gb-btn" onclick="gridBarMode('row')" aria-label="进入后每行出现勾选框，支持跨页累计"><span class="mi">checklist</span> 选行</button>` +
          `<button class="gb-btn" onclick="gridBarMode('col')" aria-label="进入后点表头勾选"><span class="mi">view_column</span> 选列</button>` +
          (nR || nC ? `<button class="gb-btn" onclick="gridRestoreHidden()" aria-label="显示全部被隐藏的行/列"><span class="mi">undo</span> 恢复(${nR + nC})</button>` : '')) +
      (nR || nC && mode ? `<span class="gb-note">已隐藏 ${nR}行/${nC}列</span>` : '');

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
    rebindIfReplaced(t);
    if (t === barTable) { clearTimeout(barHideTimer); return; }
    if (selMode && selMode.table !== t) return;   // 多选进行中别切换绑定
    /* 2026-10-12 反馈：悬停正文读数也弹工具条太碍事 →
       只在悬停「表头」时唤出（冻结/隐藏本来就是表头操作）；
       已弹出时在表内移动不清除，离开表格 1.5s 后自动隐藏（mouseout 逻辑不变） */
    if (!(e.target.closest && e.target.closest('thead'))) return;
    barTable = t;
    showBar();
  });
  document.addEventListener('mouseout', e => {
    if (!barEl || barEl.style.display !== 'flex') return;
    if (selMode && selMode.table === barTable) return;   // 多选模式中工具条常显
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
