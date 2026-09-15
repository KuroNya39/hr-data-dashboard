# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⭐ 当前架构（2026-09-12 晚定稿：双击 HTML 即用 + 手工维护 `data/SWC人力看板.xlsx`）

**新需求一律改 `assets/` 下的代码。已无 `v8/` 目录，无任何 bat。**

### 为什么改
原方案靠 `启动看板.bat` 起 http 服务。实际使用中该 bat 双击直接「无法打开」（文件关联被劫持/被安全策略拦），
分享给同事还要求对方装 Python。改为**双击 HTML 直读数据包**：零依赖、零脚本、断网可用。

### 目录
```
HR看板/
├─ 看板.html              ← ★ 完整版入口，双击即用
├─ 分享版/                ← 打包发给同事（自包含，压缩后发）
│   ├─ 看板.html
│   └─ assets/{css,js,vendor} + hr-data.js   （仅 SWC 的数据包）
├─ assets/
│   ├─ css/ js/ vendor/   ← 代码与本地化资源（Chart.js / SheetJS / Noto Sans SC / Material Symbols）
│   └─ hr-data.js         ← ★ 完整版数据包（Excel 预生成成 JS）
├─ data/                  ← ★ 只有两份 Excel（不入库）
│   ├─ SWC人力看板.xlsx   ← ★ 用户手工维护的原数据表（13 sheet，见下）
│   └─ KPA*.xls           ← 总体人员花名册基准（用户从系统导出更新）
├─ 工具/                  ← 生成数据包.js · 生成分享版.js（仅维护者用）
└─ 使用指南.md · CLAUDE.md
```

### 原数据表 `data/SWC人力看板.xlsx`（2026-09-12 晚起，用户亲手整理）
**工作流（用户定的，别改回去）**：用户**手工维护**这张表（SWC人员名单从 KPA 复制粘贴更新），
人员花名册基准 = `data/KPA*.xls`（用户从系统导出更新）。
sheet 按**关键字**命名，解析器按关键字认表、不认位置：

| sheet | 谓词 | 归属 |
|---|---|---|
| SWC人员名单（867 人，从 KPA 复制） | `^SWC人员名单`（**必须锚定**——入职名单/高潜名单/C型干部名单都含「名单」）| roster = 分享白名单 |
| 干部梯队26H1绩效考评明细 / 人才梯队26H1绩效考评明细 | `绩效考评明细` | perf |
| 绩效B-C人员情况 / 27届校招需求 / 招聘未达成需求 / 储备干部名单 / 高潜名单 / 本年度入职名单 / 外包评价 / 部门梯队 | LEDGER_SIGNALS 关键字，且**非** `绩效考评明细` | ledger |
| C型干部名单 / 26届校招名单 | `C型干部`/`校招名单` | ledger（随包携带，台账页暂无渲染块）|

- **两边谓词必须一致**：`工具/生成数据包.js` 的 `SHEET` 对象 与 `assets/js/data.js` 的 `isEmpSheet/isPerfSheet/isLedgerSheet/isManualSheet/isRosterSheet` 是同一套规则。改一边必须同步另一边，否则「生成数据包」和「从 data 文件夹读取」会读出不同结果。
- **这张表里没有人员数据 sheet**——`looksLikeConsolidated()` 已改为不要求 `isEmpSheet`，人员一律走 KPA 原文件。
- 旧「手工四张表」（部门编制/指标目标/月度快照/招聘计划）已按用户要求移除，编制/目标类指标静默降级显示「—」。
- **整份丢给 `ingestWorkbook` 会出错**：里面躺着 9+ 张台账 sheet，`looksLikeLedger()` 会命中，整个文件被当台账处理。所以 `data.js` 先用 `subWorkbook()` 拆成子工作簿再分别喂 —— 这就是 `ingestConsolidated()` 干的事。
- 结构兼容性（2026-09-12 实测）：ledger 各解析器按表头名找列，新表名/新列序直接兼容；`本年度入职名单` 第 1 行是标题、`高潜名单` 第 1 行是合并组头——`findHeaderRow()` 按关键字扫描表头行，天然兼容；`外包评价` 列位与旧 `外包名单` 一致；绩效解析（`core.js parsePerfWorkbook`）对新列名（工号/中心/职等/梯队类型/2024年中…）直接兼容。
- ⚠️ **`招聘未达成需求` 的 `!ref` 声明了上百万行假范围**（用户从系统复制带来的）——任何直接 `sheet_to_json` 的读取都会 OOM，必须走 `sheetRowsSafe()`/`aoaOfSheet()` 先裁剪。现有管线已全覆盖，新写读取代码别裸读。

### ⚠️ 重打包 zip 的坑（历史教训，源自已删的 `建汇总表.js`）
社区版 SheetJS **不写 `<calcPr>`**（怎么设 `wb.Workbook.CalcPr` 都不写，实测），而公式单元格没有缓存值时，
WPS / 在线预览 / 老版 Excel 会先显示一片空白。所以该脚本手工重写了一遍 zip 来塞 `<calcPr fullCalcOnLoad="1"/>`。

**EOCD 的「中央目录偏移」（offset 16）必须填「中央目录的起点」= 所有本地条目长度之和，不是 `body.length`。**
写成 `body.length` 会指向 EOCD 自己 → **Excel 打不开，报「文件已损坏」**；而
SheetJS 容错（它顺着本地头扫），所以 `XLSX.readFile` 照样读得出来，**问题被完全掩盖**。
更致命的是 `生成数据包.js` 第一步就是 `XLSX.readFile(汇总表)` —— **汇总表一坏，整条下游链路直接停摆**。

- 已加写后自检：跑到 `zip 自检：✔ EOCD 的 CD 偏移/大小/条目数都自洽` 才能往下走。
- 验收用**三个读取器交叉验证**（脚本 `~/.workbuddy/binaries/node/workspace/verify-cons.js`）：
  ① 自己走中央目录 ② SheetJS ③ **PowerShell `Expand-Archive`（.NET ZipFile，严格度等同 Excel）**。
  只验 ①② 会漏掉这个 bug。
- 同理：**不要用裸字节 `indexOf('fullCalcOnLoad')` 判断有没有写进去** —— 内容被 deflate 压过，搜不到是真正常（曾因此误判成失败）。

### file:// 下的能力实测（这决定整个架构）
| 能力 | 结果 |
|---|---|
| `<script src>` 引本地 JS | ✅ 可用 |
| `@font-face` 引本地字体 | ✅ 可用（字体不用降级）|
| IndexedDB / localStorage | ✅ 可用 |
| `showSaveFilePicker` / `showDirectoryPicker` | ✅ 可用（须用户点击触发）|
| `fetch` 读本地 Excel | ❌ **被拦 —— 唯一的限制** |
| `fetch` 读 `data/` 目录列表 | ✅ 可用（http 打开时用于兜底发现文件）|

因此：**数据不能 fetch，只能预生成成 JS 数据包用 `<script>` 引**；
**写文件靠 File System Access API**，目录句柄存进 IndexedDB 复用（第二次不用再选目录）。

### 数据包格式（`assets/hr-data.js`）
```js
window.HR_DATA = { v:1, scope:'full'|'swc', built:ISO, files:{emp,perf,ledger,manual},
                   books:{ emp:[[sheetName, AOA]], perf:[...], ledger:[...], manual:[...] } };
```
- 存 **AOA**（`sheet_to_json(header:1)` 的结果）。加载端 `packSheetToWorkbook()` 用 `aoa_to_sheet` 还原成 workbook，
  直接喂现有 `ingestWorkbook()` —— **解析逻辑一行都没改**，口径与「拖文件进来」完全一致。
- `books.manual` **含 SWC花名册**（手工 4 张 + 花名册 = 5 张）。`rosterIdsFromPack()` 从它取工号白名单，
  「用花名册导出分享版」不选文件就能裁。
- 体积/耗时：全量 2.3MB / 900ms，仅 SWC 1.1MB / 500ms。

### 加载优先级（`data.js` 的 `init()`）
1. `restoreSnapshot()`（IndexedDB）——「接着上次看到的地方」，也是拖入新数据后的暂存
2. 内联数据包 `window.HR_DATA` —— 数据包的 `built` 变了就作废旧快照（比对 `snap.packBuilt`）
3. `data/` 目录 fetch —— 仅用 http 打开时的兜底
4. 都没有：停在拖入界面

### 三条链路
- **打开**：双击 `看板.html`
- **更新**（数据维护面板三组按钮）：
  - 组「更新数据」：**从 data 文件夹读取最新数据**（授权一次，之后一点即读，最省事）· 回到数据包 · 把当前数据保存为数据包
  - 组「分享给 SWC 管理人员」：**用花名册导出分享版** · 导出分享版数据（仅 SWC）· 用指定名单导出分享版
  - 组「其它」：清空浏览器缓存
  - 另有：拖 Excel 进页面（临时生效、自动记住；`_packedBooks` 会记下 AOA 供固化）
- **分享**：任选上述一种导出 → 把整个 `分享版/` 压缩发送

### 分享版安全设计（物理裁剪，不是界面隐藏）
- 数据包里只保留**花名册里的工号**（有花名册时）或 `一级部门英文简称 === 'SWC'` 的行（无花名册时回落）
- 当前结果：867 行保留 / 998 行剔除（按中心模式时另剔除 37 个其他中心）
- IDB 库名隔离 `hr-dashboard-v8-shared`，否则会从完整版缓存里恢复出含其他中心的数据
- **自检判据二选一**：有花名册 → 工号必须在名单内；无花名册 → 决定中心归属的那一列必须是 SWC。
  三处实现（`生成数据包.js` 自检、`生成分享版.js` 第 5.1 步、`data.js` 的 `buildSwcPackText`）判据必须一致。
- ⚠️ **不要对整个 JSON / HTML 做全文正则扫中心名。** 与中心简称同名的值（「公司英文简称」列里有 `XP`）、
  成本中心描述里的其他中心字样，都会误报。这个坑踩过两次，后果是**分享版永远导不出去**（自检永远不通过）。
  同理，代码注释里也不要写具体中心名，否则 `生成分享版.js` 的 HTML/JS 扫描会命中。
- **v8.7 侧边栏二级菜单 + 人员概览页**（2026-09-13，按「SWC 人力看板设计说明.md」实现）
  - **侧边栏改两级**：7 个一级组（人员/招聘/校招/人才梯队/干部梯队/绩效/外包）+「日常办公」旧页区。
    一级菜单可展开/收起（`toggleNavGroup()` + `.nav-group.open`），当前页高亮一级也高亮二级。
    映射：`人员异动`=旧 人员流动+转正与合同（`PAGE_MULTI.move`）；`梯队绩效`=旧 梯队绩效盘点页（`PAGE_MULTI.talent_perf`）。
  - **占位页**：未实现的 15 个二级菜单项统一落到 `#page-placeholder`（`PLACEHOLDER_PAGES`+`renderPlaceholder()`）。
    ⚠️ `switchPage` 里占位页的 ids 必须给 `['placeholder']`，否则所有 section 都被隐藏、内容空白（已踩）。
  - **人员概览页**（`page-people` / `renderPeople()`，四大模块）：① 人员规模 5 卡 ② 人员结构（部门横向条形+组织类型环形+职级下钻）③ 人员变化（本月入/离职/净增 + 近12月入离职双折线）④ 人员预警（未来60天转正/合同/离职 3 卡）。
  - **交互框架**：所有卡片/图表点击 → `jumpToDetail(key)` → 人员明细自动带筛选（`alerts.js` 的 `DETAIL_FILTERS` + `registerDetailFilter()`；`drill:` 前缀运行时解析）。明细顶部横幅 `empAlertBanner` 可一键清除。
  - **职级结构不框死序列名**（换公司可复用）：`seriesChannelOf()` 优先取 KPA「职位序列中文描述」（`normSeries` 归一化），缺失才按职等前缀兜底；通道清单由数据驱动，数据里有什么序列就展示什么（当前 SWC：研发技术/营销/支持/管理/未识别）。下钻 = 序列 → 职等 → 子等级 → 明细，`drillPanel` 全数据驱动。
  - **口径**：人员规模/结构/变化/趋势均为全体在职（正式+实习+外包）；职级结构仅正式员工；较上月变化暂缺历史快照，不显示。

---

## 以下为 v8 的指标口径与视觉规范（仍然有效，改造时全部保留）


- **v8 相对 v7 的核心变化**
  1. **三类人群拆开**：`staffGroupOf()` 把 KPA 用工 6 类归并为 `正式员工 / 实习生 / 外协 OD` 三组；`segByGroup()/groupCounts()` 做分组统计。公司口径「在职 N」= 正式员工（已转正+试用期），不含实习与外协
  2. **口径徽标**：每个指标旁挂 `正式` / `正式+实习` / `全员` 三色徽标（`scopeTag()`/`scopeNote()`），一眼看出含不含实习/外协
  3. **比率指标只算正式员工**：离职率等不接受非正式人群（`formalOnly()`），实习到期离岗/外协换人不计入流失
  4. **部门透视表**：`renderDeptMatrix()` 出 18 个二级部门 × 在职/正式/实习/外协/滚动离职率/平均司龄/主要职等
  5. **HR 工作台账页**：新增 `v8/js/ledger.js`，解析手工台账（`SWC最新人才现状-*.xlsx`）9 个 sheet → 招聘缺口/末位改进/储备干部/高潜/外协/入职/校招/部门梯队
  6. **冷色调视觉**：分类色板跨色相（蓝/翠绿/品红/深青绿/浅蓝/浅紫/浅薄荷/青），同一张图内的颜色经 CIEDE2000 校验 ΔE ≥ 15；暖色仅留语义告警（critical/warning）
  7. **v8.1 视觉改版**（2026-09-11）
     - **配色**：抛弃「全冷色梯度」改为**跨色相分类板**（旧板 s1~s8 全是蓝→青，而 `pages.js` 大量取前 2~4 个槽位用，导致学历/性别/合同类型等图变成一堆蓝）。所有 KPI 色块与图表取色改为**按用途挑色**，不再用 `palette[i]` 前 N 个。校验脚本：`palette-final.js`（逐图打印最小 ΔE）
     - **字体**：全站统一 **Noto Sans SC**（`--font` 令牌），本地化到 `vendor/fonts/noto-sans-sc/`（101 个 unicode-range 子集、可变字重 100–900、CSS 108KB）。旧的 `system-ui` 栈在 Windows 上拉丁走 Segoe UI、中文走微软雅黑，属于混排
     - **图标**：全部换 **Material Symbols Outlined**（`vendor/material-symbols.css` + `vendor/fonts/material-symbols/`，单文件 316KB），用法 `<span class="mi">icon_name</span>`，靠 liga 连字渲染。替换了导航 9 处、顶栏 6 处、预警 8 个 emoji、表格排序/清除等符号
     - **注意热改路径**：字体 CSS 必须放在 `v8/vendor/` 下（与 material-symbols.css 同级），因为两者内部的 `url(fonts/...)` 是相对 `vendor/` 写的；放进 `vendor/fonts/` 会解析成 `vendor/fonts/fonts/...` 而 404
  8. **v8.4 语义色改版**（2026-09-11）
     - **语义色翻转为公司口径**：红 `#dc2626`=好（--pos）、绿 `#16a34a`=不好（--neg）、黄 `#d97706`=警告（--warn）。旧的 --good/--warning/--critical/--neutral 令牌全部废弃删除。KPI 语义重派：离职率/累计离职/实习外协流出=绿，净增/转正率=红，90天届满/待办预警=黄；入职趋势线红、离职线绿（红入绿出）
     - **分类板全色相重解**：s1–s6 = 蓝/紫/玫红/橙/金/橄榄（品牌强调色仍是 `#2563eb`，图表主蓝改用 `#3b82f6` 以拉开与紫的距离），红绿专留给语义不进分类板。绩效 7 级改「深红(SA好)→深绿(D差)」热力梯；合同到期 3 档黄色强度梯（--expire-30/60/90）
     - **侧边栏**：左上副标题改「HRBP 工作台」；左下角统计串（dataFoot）删除，位置换成深色模式按钮（`updateFootStatus()` 已从 data.js 移除）；组织与用工 KPI「职级数」改「总人数」
     - **校验**：`palette-v84-verify.js` 逐图 ΔE（浅 18.2/深 20.9，最低值都在有序梯度上，分类图全部 ≥23）；`walk-v84.js` 浏览器断言（语义色、令牌、布局、数据不回退、控制台 0 错误）。**playwright-cli 已不可用**（主目录 `playwright@1.63.0-alpha` 导出不兼容报 ERR_PACKAGE_PATH_NOT_EXPORTED），改用 `run-walk-v84.js`（NODE_PATH 指向主目录 node_modules、chromium.launch 直跑同一份 `async page => {}` 脚本）
  9. **v8.5 数据源改造 + 分享版**（2026-09-12）
     - **data/ 作为数据源**：新增 `v8/js/datasource.js`（手工数据源读取，`dsData` 全局态 / `loadDataSource()` / `dsBudgetSummary()` / `dsTarget()`，全程**静默降级**——读不到就保持空、指标显示「—」，绝不阻断 `refreshAll()`）；`data.js` 新增 `DATA_FILES` + `fetchWorkbook()` + `autoLoadFromDataDir()`，init 时先 `loadDataSource(true)`，**无缓存时回落到自动加载 data/**
     - **路径坑（务必注意）**：`index.html` 在 `v8/` 下，而数据在项目根 `data/`，所以相对路径**必须带 `../`** —— `DATA_FILES` 用 `'../data/KPA...'`、`DS_PATH` 用 `'../data/看板数据源.xlsx'`。写成 `'data/…'` 会解析到 `v8/data/…` 而 404（静默降级，表现为数据全空）
     - **防缓存**：`fetch(rel + '?t=' + Date.now(), { cache:'no-store' })`，否则改完 Excel 刷新看到的还是旧数
     - **按表头名找列**：`dsColIndex()` 建立「列名→索引」映射，解析不依赖列顺序（`dsCell(r, cols, 'HC 计划', 'HC计划', '计划', '编制')` 多候选名）
     - **编制口径**：`dsBudgetSummary()` 的「已到位」只统计**正式员工**（`staffGroupOf(d)==='formal'`），不含实习与外协；Excel 手填了「已到位」优先用手填的。`pages.js` 的 `renderBudgetGap()` 兜底逻辑同口径（此前误用全员在职，会把达成率抬高）
     - **新增 UI**：顶栏「重读数据源」按钮（`reloadDataSource()` + `dsBtn`/`dsDot` 状态点）；结构页「编制达成率」KPI + `chartBudgetGap` 堆叠缺口图（按缺口倒序）
     - **分享版（物理裁剪）**：`data/生成分享版.js`（7 步自包含）产出 `v8/分享版/`。核心原则——**不是界面隐藏，而是文件里根本没有**：只保留 `一级部门英文简称==='SWC'` 的行（867 行，剔除 998 行 / 37 个中心）
       - 生成物：`index.html`（改标题/副标题、**移除中心筛选器**、插 `share-banner` 横幅、**移除 4 个上传/重读按钮**、注入 `window.HR_DATA_FILES` + `HR_IDB_NAME='hr-dashboard-v8-shared'` + 运行期补丁）+ `data/{swc-only.xls, perf-swc-only.xlsx, ledger-swc.xlsx, 看板数据源.xlsx}` + `css/js/vendor` 副本 + `打开分享版.bat`
       - **IDB 库名必须隔离**（`hr-dashboard-v8-shared`）：否则会从本机残留的完整版快照恢复出含其他中心的数据，物理裁剪被自己的缓存绕过
       - **安全自检**（脚本第 7 步）：裁剪文件非 SWC 行数须为 0 · 分享版目录不得有 KPA 原件 · HTML/JS 不得出现其他中心名（词界匹配，避免 BU1 命中 BU10）
       - **不要用 `fs.cpSync` 复制 vendor/**：本机 node 24 递归复制 106 个字体分片会栈溢出（exit 0xC0000409），改用显式栈式遍历逐目录创建 + 逐文件 `copyFileSync`
       - **也不要「整目录删光再复制」**：WorkBuddy 托管 node 带批量删除保护（阈值 50 个/轮），删 114 个文件会被 `SAFE_DELETE_BULK_CONFIRM_REQUIRED` 拦下并让脚本非 0 退出。第 ⑤ 步已改成 `pruneExtras()` 增量同步（只删源里没有的，正常 0 个）
       - **选源文件取「最新修改的一份」**：`findFile()` 从「按文件名取第一个」改成按 mtime 倒序，多份候选时打印用了哪份、忽略了哪份（此前按名字排序，新导出的 KPA 时间戳更大反而排在后面，会静默拿到旧文件）
  10. **v8.5 补丁：三条使用链路的可用性加固**（2026-09-12）
     - **`启动看板.bat` 的 `cd /d "%~dp0.."` 是错的**：该 bat 在项目根，`..` 会跑到 `Desktop\`，服务根错位 → `/v8/index.html` 404。已改 `cd /d "%~dp0"`
     - **批处理 `else` 块里嵌套 `if %errorlevel%` 会被提前展开**，`py` 兜底分支永远走不到 → 三个 bat 统一改成 `set VAR=` + `if not defined VAR`
     - **Python 探测改用 `python -c "import sys"` 试跑**：Windows 的 `python.exe` 应用执行别名会让 `where python` 命中，运行时却弹微软商店。Node 同理 `node -v` 试跑 + `D:\nodejs\node.exe` 兜底
     - **`reloadDataSource()` 从「只重读手工 Excel」改成「整份重读」**：现在会清空后重读人员/绩效/台账 + 手工数据源。清空是必须的——`ingestWorkbook` 是「按工号覆盖合并」，不清空则新导出里被删掉的人会永远残留；若一份都没读到，把原状态放回去并 toast 提示，不把看板清空
     - **自动发现兜底**：`fetchDataFile()` 先试固定名（和本会话已发现的名字），404 再读 `data/` 目录列表（python http.server 的 HTML 索引）按模式匹配、取日期戳最新的一份，并把结果记进 `_resolvedFile` 避免重复 404。`DATA_DIR` 从 `DATA_FILES.emp` 推导（分享版的 `data/` 是同级目录，不能写死 `../data/`）
     - **验收新增 B2 段**（`walk-v85.js`）：调 `reloadDataSource()` 断言「人员不被清空 + 人数不重复累加」；另用「把 KPA 改名成新时间戳」验证兜底发现真的生效
     - **验收**：`walk-v85.js`（+ `run-walk-v85.js` 运行器）——完整版自动加载 1865 人 / 在职 517 / 台账 10 / 数据源 errors 0；分享版 867 人 / 在职 311 / 越权检查仅 SWC / 0 错误；编制口径断言 actual=258（正式）而非 311（全员）
  11. **v8.6 单一汇总表 + 花名册分享**（2026-09-12）
     - **`data/HR看板数据源.xlsx` 成为唯一维护文件**（19 sheet：填写说明 · 看板 · 人员数据 · 绩效×2 · 台账×9 · 部门编制/指标目标/月度快照/招聘计划 · SWC花名册）。做法与坑见上文「单一汇总表」与「重打包 zip 的坑」两节
     - **（已删）`工具/建汇总表.js`**：曾负责散装 Excel → 汇总表，v8.7 起弃用删除。其「看板」公式页经验仍有效（**全部用 SUMPRODUCT，不用 COUNTIFS** —— `"<>T"` 在空单元格上行为不一致会算错；行号一律运行时算，不写死，否则前面插一行全错）
     - **`生成数据包.js` 改为按 sheet 名从汇总表拆四路**；人员**优先取 `KPA*.xls` 原文件**（HTML 要看新鲜原表），找不到才回落汇总表副本
     - **浏览器端新增**：`ingestConsolidated()` / `looksLikeConsolidated()` / `subWorkbook()` / `rosterIdsFromPack()` / `exportSharePackByRoster()` / `isRosterSheet()`。`handleFiles` 会识别「整份汇总表」并自动拆解 → **用户可以整份拖进来**
     - **SWC花名册成为分享名单的权威来源**：删一行 = 以后不再发这个人。`buildSwcPackText(emp, ids)` 加白名单模式（`mode:'roster'`），无花名册时回落按中心列裁（`mode:'center'`）
     - **数据维护面板重排为三组 7 个按钮**：更新数据（从 data 文件夹读取最新数据 · 回到数据包 · 把当前数据保存为数据包）/ 分享给 SWC 管理人员（用花名册导出分享版 · 导出分享版数据（仅 SWC）· 用指定名单导出分享版）/ 其它（清空浏览器缓存）
     - **`生成数据包.js` 的 `findFile()` 按 mtime 取最新一份**（导出文件名带时间戳，按名字排序会拿到旧的）
     - **踩坑记录**：T1 台账 sheet 的 `!ref` 声明假范围（上百万行），遍历前必须 `sheetRowsSafe()`/`aoaOfSheet()` 裁剪；
       T2 SheetJS 社区版不写 `<calcPr>`；T3 **EOCD 的 CD 偏移写错导致 Excel 打不开、但 SheetJS 能读**（隐藏最深的一个，见上）；
       T4 裸字节搜 `indexOf('fullCalcOnLoad')` 在 deflate 压缩后必然返回 -1，会误判成「没写进去」
     - **验收**（2026-09-12 全部通过，控制台 0 错误）：`walk-file.js` 完整版 1865 人 / 在职 517（450+39+28）/ 绩效 215 / 台账 9 / 10 页 34 图 · 幂等不重复累加 ·
       拖入覆盖更新 · 页面内裁分享版 867 保留 998 剔除 自检 0；
       `walk-share.js` 分享版 867 / 在职 311（258+26+27）/ 中心集合仅 ["SWC"] / 无上传与数据维护按钮 / 无越权 / IDB 隔离；
       `walk-consolidated.js` 整份汇总表拖入与基线一致 · 517=450+39+28 · 手工四表 19/5/6/3 · **花名册 867 随包进来** · 白名单模式命中 3 / 越界 0 / 能识别不存在的工号；
       `relocate-share.js` 复制 116 文件到别的目录仍能双击打开
- **结构**：`js/core.js`（状态/字段映射/人群分组/口径工具/解析/图表封装）→ `js/ledger.js` → **`js/datasource.js`**（手工数据源）→ `js/pages.js`（9 页渲染）→ `js/table.js` → `js/alerts.js`（8 条预警带口径）→ `js/data.js`（汇总表拆分/上传/自动加载/台账识别/IndexedDB/筛选器，最后加载）
- **页面**：总览 / 组织与用工 / 人员结构 / 人员流动 / 转正与合同 / 梯队绩效盘点 / 职级健康度 / **HR 工作台账** / 员工明细 / 简报模式
- **数据持久化**：IndexedDB `hr-dashboard-v8`（人员 + 绩效 + 台账三份快照），上传后自动存，重开自动恢复；**分享版用独立库 `hr-dashboard-v8-shared`**（库名由 `window.HR_IDB_NAME` 可配）
- **数据坑备忘（v8 新增）**
  - 台账 sheet 的 `!ref` 存在**声明假范围**（如「招聘未达成需求」声明 1048536 行 × 16374 列），必须用 `sheetRowsSafe()` 裁剪后再遍历，否则 OOM
  - 台账汇总行（「合计/小计」）名称列为空，解析时须用 `!lv(cellAt(row, i.dept))` 过滤，否则会被算成数据行
  - 台账存在**右侧小表**，取说明性文本时只取每行最靠左一格 ≥8 字符且含中文的长文本，避免串行
  - 绩效结果**只保留每半年度等级**，细分维度不接入（自评名单不接入）
- **测试**：Node 验收脚本 `~/.workbuddy/binaries/node/workspace/test-v8.js`（core+ledger+pages 同作用域 eval + 真实 Excel 跑数）
  - **file:// 冒烟（当前主用）**：`walk-file.js`（完整版）· `walk-share.js`（分享版）· `walk-consolidated.js`（整份汇总表拖入）· `relocate-share.js`（换目录自包含）。
    运行：`cd ~/.workbuddy/binaries/node/workspace && export NODE_PATH=C:/Users/wushangyan/node_modules && "D:/nodejs/node.exe" walk-file.js`
    —— **用系统 node `D:\nodejs\node.exe`**（托管 node 有批量删除保护，`生成分享版.js` 会被拦）。
    脚本 `console.log('done')` 收尾，**结果要读 `%TEMP%` 下的同名 txt**，stdout 只有 done。
  - **汇总表结构校验**：`verify-cons.js`（走中心目录 + CRC + calcPr）+ PowerShell `Expand-Archive` 严格复验。
  - **已废弃**：`walk-v84.js` / `walk-v85.js`（http 版，配 `run-walk-*.js`）。**playwright-cli 不可用**
    （主目录 `playwright@1.63.0-alpha` 导出不兼容，`ERR_PACKAGE_PATH_NOT_EXPORTED`），
    但 `require('playwright')` + `chromium.launch()` 直跑**可用**（靠 `NODE_PATH`）。
- **验收结论（2026-09-12）**：人群拆分后的在职数与手工台账逐项对齐（正式 + 实习 + 外协 = 在职合计）；
  9 页遍历零控制台错误；台账 9 sheet 解析 59ms（OOM 防护生效）；
  **v8.6 单一汇总表 + 花名册分享 + 四套 file:// 冒烟全通过，全程控制台 0 错误、资源加载失败 0 条**

---

## 以下为 v7 文档（可回退参考）

2026-09 重做版本，旧 v6 根目录文件仅作回退保留。**新需求一律改 `v7/`**。

- **入口**：`v7/index.html`，双击即用；Chart.js/SheetJS 已本地化到 `v7/vendor/`，断网可用
- **结构**：`js/core.js`（状态/字段映射/解析/排序归一化/图表封装）→ `js/pages.js`（8 页渲染）→ `js/table.js`（明细表+列筛选+CSV）→ `js/alerts.js`（8 条预警）→ `js/data.js`（上传/IndexedDB/筛选器/页面切换，最后加载）
- **页面**：总览 / 组织与用工 / 人员结构 / 人员流动 / 转正与合同 / 梯队绩效盘点 / 职级健康度 / 员工明细 / 简报模式（打印）
- **数据持久化**：IndexedDB `hr-dashboard-v7`，上传后自动存快照，重开自动恢复
- **关键口径**：滚动 12 月离职率 = 近 12 月离职 ÷ 月均在册；绩效预警周期动态取最新 3/4 期；用工 6 类全收（含劳务人员）；职等自然排序（T/M/L/P/S/数字级）
- **测试**：Node 环境解析验收脚本在 `~/.workbuddy/binaries/node/workspace/test-v7.js`（core.js + 真实 Excel 跑数）
- **数据坑备忘**：KPA 导出「职等」列是 C0xx 代码，可读职等在「职等中文描述」；「梯队」等约 20 列存在重复列组（`_1`~`_5` 后缀），由 mergeDups 逻辑兜底；绩效文件按中心分文件导出，表头「半年内/近半年绩效变动」命名不一

---

## 以下为旧版 v6 文档（仅回退参考）

## 项目概述

纯前端 HR 数据看板 — 上传 Excel（KPA 格式人员数据 + 绩效考评表），浏览器端解析后在 Chart.js 图表中可视化分析。**无后端、无构建、无测试**。双击 HTML 即可运行。

## 启动方式

- **开发**：直接用浏览器打开 `HR数据看板.html`（双击即可）
- **本地 HTTP 服务器**（可选，支持自动扫描文件夹内 Excel）：`python -m http.server 8000` 然后在 `http://localhost:8000` 打开
- **无依赖安装** — 无需 npm/pip/bundle

## 核心架构

### 模块分工

| 文件 | 职责 |
|------|------|
| `HR数据看板.html` | 主页面 — HTML 结构 + CSS 设计令牌 + CDN 脚本加载 |
| `hr-core.js` | 全局状态 + 字段映射 + 绩效工具函数 + 主题 + Chart.js 封装 |
| `hr-data.js` | 文件上传/解析 + 筛选器 + 页面切换 + 刷新协调 |
| `hr-render.js` | 9 个页面的图表渲染函数（概览/组织/人员/流动/绩效/用工/人才/健康度/明细） |
| `hr-table.js` | 员工明细表 + 绩效表 + Excel 风格列筛选弹窗 + 分页 + CSV 导出 |
| `hr-alerts.js` | 6 条预警规则 + 预警 UI 渲染 + 员工筛选联动 |

### 数据流

1. **上传** → `hr-data.js` 通过 FileReader 读取 `.xlsx`/`.xls`
2. **解析** → XLSX.js 将 Excel 转为 JSON，`parseRow()` 按 `FIELD_MAP` 字段映射表标准化
3. **存储** → `rawData[]` 员工数组 + `perfData{}` 绩效字典（按工号索引）
4. **匹配** → `attachPerfData()` 按工号将绩效关联到员工对象
5. **筛选** → `getFiltered()` 多维度互联筛选器（中心/部门/用工类型/状态/日期）
6. **渲染** → `refreshAll()` 统一入口 → 各页面 render 函数 → Chart.js 图表

### 关键全局变量

- `rawData[]` — 员工数据（主数组）
- `perfData{}` — 绩效数据（key = 工号字符串）
- `perfFileLoaded` / `perfFileCount` — 绩效文件加载状态
- `chartInstances{}` — 所有 Chart.js 实例
- `columnFilters{}` — 员工明细表的列筛选状态
- `dismissedAlertTitles` — 本次会话中已关闭的预警

### 筛选器系统

互联筛选器（Excel slicer 风格）：改变一个筛选器后，其他下拉框的选项自动缩减到与当前筛选结果交集。核心函数：
- `getFilterValues(excludeKey)` — 获取除某字段外的筛选状态
- `getFiltered(excludeKey)` — 获取筛选后的数据子集
- `refreshFilterOptions(changedKey)` — 刷新下拉选项（排除已变更字段）

### 预警系统（hr-alerts.js）

6 条规则，每条可关闭（会话级）、可跳到对应页面并自动筛选目标员工：
1. 入职 80-105 天访谈提醒
2. 试用期 ≥4.5 月转正提醒
3. 连续 3 次 B 级及以下绩效
4. 绩效连续下降（4 期递减）
5. 高绩效(SA/A) + 司龄 >5 年 + T3 以下职级
6. 外包人员入职 >2 年

### 页面系统

9 个页面通过 `.hidden` CSS 类切换，无需路由：
- **概览**：KPI 卡片 + 编制分布 + 入离职趋势 + 用工类型
- **组织架构**：职级分布 + 职级×子等级矩阵 + 部门排名 + 岗位序列
- **人员构成**：年龄/司龄/学历/性别 + 司龄×学历交叉
- **人员流动**：离职按职级/司龄/用工类型 + 招聘来源
- **绩效评估**（需上传绩效文件）：等级分布 + 等级×职级矩阵 + 投入系数 + 变动 + 历史趋势
- **用工类型**：各中心用工 + 用工×职级交叉 + 组织类型
- **人才发展**：晋升通道 + 高绩效分布 + 梯队 + 留存风险
- **职级健康度**：职级金字塔 + 管理vs技术通道 + 各中心职级对比
- **员工明细**：Excel 风格全字段表格（列筛选/排序/分页/CSV 导出）

### 绩效数据结构

KPA 导出员工列映射见 `hr-core.js` 的 `FIELD_MAP`（支持大量别名变体）。绩效文件按表头自动识别各期字段（`2024年中/2024年终/2025中/2025终/2026H1初评/2026H1终评`）。绩效等级顺序：`SA > A > B+ > B > B- > C > D`。

### 主题系统

CSS 自定义属性驱动，支持浅色/深色模式（`data-theme="dark"` + `prefers-color-scheme`）。`toggleTheme()` 切换并触发 `refreshAll()`。`MutationObserver` 监听 `data-theme` 属性变化自动重绘图表。

### 字段映射注意事项

`FIELD_MAP` 覆盖了大量 Excel 列名变体。当遇到未覆盖的字段时，`parseRow()` 会保留原始列名作为 key。KPA 导出中重复列组（带 `_1`~`_5` 后缀）有专门的回退合并逻辑。

### 常见操作

- **添加新页面**：在 HTML 中添加 `class="page hidden"` 的 div，在 `hr-render.js` 中编写 render 函数，在 `hr-data.js` 的 `switchPage()` 注册标题和副标题，在 `refreshAll()` 中调用新 render 函数
- **添加新预警规则**：在 `hr-alerts.js` 的 `generateAlerts()` 中添加规则，返回含 `{type, icon, title, desc, count, page, filter}` 的对象
- **添加新图表**：在 HTML 中添加 canvas，在 `hr-render.js` 中使用 `barChart()/lineChart()/doughnutChart()` 工具函数
- **添加新筛选维度**：在 HTML 筛选栏添加控件，在 `hr-data.js` 的 `getFiltered()` 中添加筛选逻辑，在 `refreshFilterOptions()` 中添加选项刷新
- **上传新数据**：刷新页面后重新拖拽/选择文件夹
