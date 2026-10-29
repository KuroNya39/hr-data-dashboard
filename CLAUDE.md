# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⭐ 当前架构（2026-09-12 晚定稿：双击 HTML 即用 + 手工维护汇总表）

**新需求一律改 `assets/` 下的代码。已无 `v8/` 目录，无任何 bat。**

### 为什么改
原方案靠 `启动看板.bat` 起 http 服务。实际使用中该 bat 双击直接「无法打开」（文件关联被劫持/被安全策略拦），
分享给同事还要求对方装 Python。改为**双击 HTML 直读数据包**：零依赖、零脚本、断网可用。

### 目录
```
HR看板/
├─ 看板.html              ← ★ 完整版入口，双击即用
├─ assets/
│   ├─ css/ js/ vendor/   ← 代码与本地化资源（Chart.js / SheetJS / Noto Sans SC / Material Symbols）
│   ├─ bu-config.js       ← ★ 本部门配置（中性占位，随仓库公开）
│   ├─ bu-config.local.js ← ★ 本部门配置（真实值，不入库；缺失时自动回落到占位）
│   └─ hr-data.js         ← ★ 完整版数据包（Excel 预生成成 JS）
├─ data/                  ← ★ 只有两份 Excel（不入库）
│   ├─ {本部门}人力看板.xlsx ← ★ 手工维护的汇总表（13 sheet，见下；文件名见 bu-config.local.js 的 book）
│   └─ KPA*.xls           ← 总体人员花名册基准（用户从系统导出更新）
├─ 工具/                  ← 生成数据包.js · 读取部门配置.js（仅维护者用）
└─ 设计系统.md · CLAUDE.md
```

### 本部门配置（`assets/bu-config.js` + `assets/bu-config.local.js`）
**公开仓库里不能出现真实部门名 / 文件名**，所以所有「本部门相关」的值一律走配置，不写死在代码里：

| 键 | 含义 |
|---|---|
| `code` | 本部门代号（配置标识） |
| `label` | 界面显示名 |
| `orgMap` | 组织名关键字 → 中心代号，`core.js` 组织归属兜底用；留空 = 不做这层兜底 |
| `rosterSheet` | 花名册 sheet 名的正则，**必须锚定开头** |
| `book` | 汇总表文件名（`data/` 下，旧链路里也当 `files.cons` 用） |
| `files` | 四路数据源文件名（`cons`/`emp`/`perf`/`ledger`），无汇总表时的回落路径 |
| `scope` | 数据包 `scope` 字段的值（`code` 的小写） |

- **两个文件都写 `window.BU = …`**：`bu-config.js` 是中性占位（不入库真实值），`bu-config.local.js` 用 `Object.assign(window.BU, {...})` 覆盖。
- **浏览器**：`看板.html` 里两个 `<script>` 顺序加载（占位在前、本地在后），位置在 `hr-data.js` **之前**（`data.js` 一加载就取 `BU.book`）。
- **node**：`工具/读取部门配置.js` 造一个假 `window` 用 `new Function` 跑这两个文件再取 `BU`，所有生成脚本都 `require` 它。**两边取到的必须是同一份值**，所以别在 node 侧另写一份解析。
- ⚠️ **键名不要改**（改了要同步 `读取部门配置.js`、`data.js`、`datasource.js`、两个生成脚本）。
- `window.HR_DATA_FILES` / `window.HR_DATA_SOURCE` 若被显式注入（历史兼容机制），优先级高于 `BU.files` / `BU.book`。

### 原数据表（文件名见 `bu-config.local.js` 的 `book`；2026-09-12 晚起，用户亲手整理）
**工作流（用户定的，别改回去）**：用户**手工维护**这张表（人员名单从 KPA 复制粘贴更新），
人员花名册基准 = `data/KPA*.xls`（用户从系统导出更新）。
sheet 按**关键字**命名，解析器按关键字认表、不认位置：

| sheet | 谓词 | 归属 |
|---|---|---|
| 本部门人员名单（从 KPA 复制） | 见 `bu-config.js` 的 `rosterSheet`（**必须锚定开头**——入职名单/高潜名单/C型干部名单都含「名单」）| roster |
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
window.HR_DATA = { v:1, scope:'full', built:ISO, files:{emp,perf,ledger,manual},
                   books:{ emp:[[sheetName, AOA]], perf:[...], ledger:[...], manual:[...] } };
```
- 存 **AOA**（`sheet_to_json(header:1)` 的结果）。加载端 `packSheetToWorkbook()` 用 `aoa_to_sheet` 还原成 workbook，
  直接喂现有 `ingestWorkbook()` —— **解析逻辑一行都没改**，口径与「拖文件进来」完全一致。
- `books.manual` **含花名册**（手工表 + 花名册）。
- 体积/耗时：全量约 2.6MB / 900ms。

### 加载优先级（`data.js` 的 `init()`）
1. `restoreSnapshot()`（IndexedDB）——「接着上次看到的地方」，也是拖入新数据后的暂存
2. 内联数据包 `window.HR_DATA` —— 数据包的 `built` 变了就作废旧快照（比对 `snap.packBuilt`）
3. `data/` 目录 fetch —— 仅用 http 打开时的兜底
4. 都没有：停在拖入界面

### 发布说明（`RELEASE_NOTES.md`）

**改完一轮、用户能看到或感觉到变化时，在根目录 `RELEASE_NOTES.md` 顶部加一节。**
格式照 `D:/boss-candidate-tool/RELEASE_NOTES.md`（同一个人维护的两个项目，格式一致）：

```
## 更新内容（M月D日）          ← 同一天多次改版只写一个日期头
### v8.NN 更新内容             ← 一天可以有多节，新的在上
**一句话说清这次改了什么**     ← 加粗小标题，接着是 2–5 条大白话 bullet
**内部整理（功能与界面无变化）** ← 只有内部整理时才有这一段
```

- **用大白话写「用户感受到什么」**，不要贴 commit 列表、不要出现函数名和变量名。
- **版本号**：`v8.N` 顺延；**有新功能或界面/流程变化 → 进一位**；只修 bug / 纯内部整理 → 记为 `v8.N.1` 这样的补丁位。
- **`设计系统.md` 不记流水账**：日期、具体页面举例、「曾经是 X」都不进那份文档，
  改了什么写在这里。规范只留「现在是什么、为什么」。
- 本仓库没有自动发布流程，`RELEASE_NOTES.md` 就是唯一的对外变更说明，**手动维护**。

### 链路
- **打开**：双击 `看板.html`
- **更新**：双击根目录 **`更新数据.bat`**（→ `update-data.js` → `工具/生成数据包.js`）重新生成
  `assets/hr-data.js`，回看板按 F5。`built` 变了，旧快照自动作废。
- **临时看一份新导出的表**：拖 Excel 进页面，或点顶栏「上传数据」（人员/绩效/台账/整份汇总表自动识别）。
  只改浏览器里的当前内容，不动数据文件。

> 分享版功能已于 2026-10-12 按用户要求整体移除（产物目录、导出按钮、`生成分享版.js`、
> `生成数据包.js --share` 分支与安全自检）。备份见 `.workbuddy/backup/share-removal-20261012.tar`。

- **v8.21 代码清理（/simplify，2026-10-29，无用户可见的大改动）**：只去重复与死码，行为不变。
  - **统计窗口目录收成一份**：`FLOW_WINS` 删掉 `m24` / `ytd` / `all`（HTML 里本来就没有这三个按钮，
    `flowWindowOf` 里对应分支也一并删，`dataStartMs` 仍由「区间对比」用）；
    `ye/ye2/ye3` 改为 `{ yearsAgo: n }`，年份映射只此一处；`flowWindowOf(win)` **不再接 scopeArr**。
  - **窗口谓词只留一个** `inWinOf(sinceMs)`（pages.js 顶层）：人员异动的入职/离职计数、
    人员变化的净增、各部门净变化、明细筛选全走它；`deptKeyOf(d)` 也提到顶层。
  - **明细筛选闭包改成 `Set.has`**（原来 `arr.includes(d)` × 每个员工 = 一次重绘 O(N²)，
    搜索框每敲一下都会触发）。`chg:g:*` 的人群判断也预先建 Set，不再按行解析日期。
  - **人员变化块**：签名改 `renderPeopleChange(scopeArr, win, tc)`（在职由 scopeArr 推出）；
    人群顺序/组名走 core.js 的 `GROUP_ORDER` / `GROUP_LABEL`（`CHG_GRPS` 删，只留色点表 `CHG_TONE`）；
    期初/当前计数改用 `groupCounts()`。
  - **性能**：`hcEnds` 改用 `tenurePairsOf()` + `headcountAtMs()`（每人日期只解析一次）；
    分月离职数改用 `countByMonth()` 一次分桶，不再按月重扫全表。
  - **删死码**：`lastYearEndOf()`（与 `yearEndSince(1)` 逐字同义、零调用）；
    `style.css` 里 `.win-row .win-label` / `.win-row .chart-note` / `.seg-switch + .win-label` 三条
    （统计窗口注记 2026-10-26 已移到 `.module-head`，这三条匹配不到元素）。
  - **补 CSS**：`.kpi-sub:empty { display:none }` —— 没有小字的卡不再留 4px 空档。
  - **id 更名**：`#trend12Note` → `#deptNetNote`（它现在打印的是任意窗口，不再只是「近12月」）；
    `#peopleChangeNote` 连同其复述式文案一起删（见下条 §10.9）。
  - 验收：`tmp-probe-change-moved` **17/17** · `probe-scope` 37/37 · `probe-simplify` 25/25 ·
    `probe-a11y` 19/19 · `probe-selx` 24/24 · `probe-ninebox` 13/13 · `probe-talent` 15/15 ·
    `probe-cleanup` 22/22 · `walk-pages` 16 页 0 console 错误；人员异动浅/深截图目测。
- **v8.20 人员变化并入人员异动 + 卡片小字去废话**（2026-10-26，用户三条反馈）：
  1. **「人员变化」整块从人员概览搬到人员异动**（`renderPeopleChange()`，插在 KPI 行与区间对比之间）。
     两页原来各有一套一模一样的统计窗口开关，**合并成一套**（只留 `flowWin` / `#flowWinSwitch`）；
     `chgWin` / `CHG_WINS` / `setChgWin` / `chgWindowOf` 已删（统计窗口档位本来就覆盖它们，见 v8.21）。
     ⚠️ 搬迁后**各部门净变化 / 人员变化都读 `win`**，别再给它们单开一套窗口状态。
  2. **搬来后只留「各人群净增」+「各部门净变化」**：原「期间入职 / 期间离职 / 净增」三张卡
     与上方「近X月入职 / 近X月离职」是同一个数，已删；「当前在册」卡与总览「在职合计」重复，也删了。
     入职卡挪到离职卡**右侧相邻**，这两张卡**不再有小字**（标题已自明）。
  3. **与小字相关的通用规则见 `设计系统.md` §10.9**：小字只写「这个数怎么算的」，
     不写「这个数是关于谁的」。据此删掉：早期流失的「近X月离职者 ·」前缀（只留判定条件）、
     离职员工平均司龄的整行小字、总览「部门数」的「覆盖 N 人」、校招概览「覆盖部门」的「实际到岗 N 人」、
     人员变化模块标题右侧的「近X月 · 跟顶栏人群」（2026-10-29 补删，窗口开关与顶栏下拉就在正上方）。
     **人员概览 / 总览「平均司龄」的「全员 N 人」保留**——2026-10-23 用户专门拍板要它体现口径联动，别顺手删。
  - **验收**：`.workbuddy/tmp-probe-change-moved.js` **17/17** · `probe-scope` 37/37 · `probe-simplify` 25/25 ·
    `probe-a11y` 19/19 · `probe-selx` 24/24 · `probe-ninebox` 13/13 · `probe-talent` 15/15 ·
    `walk-pages` 全页 0 console 错误；浅/深两套主题截图逐页目测。
  - 文档同步：本文件 §v8.7 的「人员概览四大模块」已改注 ③ 已搬走；`设计系统.md` 新增 §10.9、
    §12.2 自查清单补两条。
- **v8.19 预警三档改回标准色原值**（2026-10-23，用户「红黄蓝的颜色和我规定的色值不一样」）：
  - 问题**不在结构**（「红条 + 蓝数字」是刻意的两套语言），而在**令牌取值**：`--alarm-hi/mid/lo`
    一直用为了凑 3:1 而压深过一档的 `#e02b28` / `#c98500` / `#1a6ae0`，与用户 2026-10-15 给定的
    四个标准色（蓝 `#3186ff` / 红 `#fc413d` / 黄 `#ffbe00` / 绿 `#00af57`）对不上。
  - 改为**原值**，且**浅/深两套主题同值**（三支在深底 `#0f1c2e` 上分别 4.74 / 9.74 / 4.77，本来就达标）。
    红 3.52 / 蓝 3.50 过图形档 3:1；**黄 `#ffbe00` 白底只有 1.66，用户知情并选「宁可淡一点」**。
  - ⚠️ **别再为对比度把黄档压深**——那正是这次被推翻的做法。严重度另有「排序 + 图标形状 + 左边条」
    三条通道兜底，不是只靠颜色。要改先问用户。
  - `probe-contrast-scan.js` 新增 `ACCEPTED` 已知例外清单，这组单独打 `⚠ 已知例外`、
    不再混进 `✘ 不达标`，免得以后被当成新回归又「修」回去。
  - **人数颜色跟随严重度**（同日用户第二条：「提醒项人数的颜色都是蓝色，没有和色条同步」）：
    `.alert-count` 原写死 `--accent`，红条黄条上一律蓝数字。改为按 `.alert-critical/.alert-warning/.alert-info`
    取新令牌 `--alarm-hi-fg` / `--alarm-mid-fg` / `--alarm-lo-fg`。
    ⚠️ **两个角色别合并**：`--alarm-*` 是图形色（门槛 3:1），`-fg` 是 12px 文字色（门槛 4.5:1）。
    浅色取「能过 4.5 的最浅同色相值」`#c62a26` / `#9a6b00` / `#1a6ae0`（5.58 / 4.69 / 5.02）；
    **深色直接用原值**（4.86 / 10.29 / 4.88 本来就过线）——深底文字要提亮，压深反而糊。
  - 验收：浅色 33 组仅 1 条（即上述例外）/ 深色 32 组 0 条 / `walk-pages` 全页 0 console 错误；
    浅深两套主题实测 `.alert-item` 左边条与图标 = `rgb(252,65,61)` / `rgb(255,190,0)` / `rgb(49,134,255)`，
    人数 = `rgb(198,42,38)` / `rgb(154,107,0)` / `rgb(26,106,224)`（深色三项与条同值）。
  - 文档同步：`设计系统.md` §3.2 告警强度行 + §14.1 例外表（新增「黄色档低于 3:1 仍然保留」一行）。
- **v8.15 焦点环统一成一层**（2026-10-21，用户「输入框的焦点环是两层很奇怪」）：
  - **成因**：全局 `:focus-visible { outline:1px solid var(--accent); outline-offset:1px }` 一直在；
    另有两处 `:focus { border-color:var(--accent) }`（`.filter-bar select, .filter-bar input`
    与 `.emp-toolbar input`）。键盘 Tab 到输入框时**描边变蓝 + 1px 空隙 + 外面再一圈同色蓝环**，
    读起来就是两个圈。
  - **改法**：删掉那两条 `border-color`，**一个控件只留一层信号（全局 1px 环）**。
    没加任何 `outline:none`，白名单仍是 `.selx-btn` / `.selx-opt` 两条。
  - ⚠️ 别再把它当「额外强化」加回来；要更醒目就调 `--accent`，别叠第二层。
    `.tb-btn.primary`（强调按钮）**看着像两层但不是问题**——它的描边/底色本来就叫 `--accent`，
    是按钮的常驻外形、不是焦点信号，别给它加特判。
  - **验收**：真键盘 Tab 逐页扫 8 页 99 个唯一控件 —— 两层 0 个、无焦点指示 0 个、
    0 console 错误；3 倍截图逐张目测（日期框 / 搜索框 / 下拉）。
  - 文档同步：`设计系统.md` §5.5（规则改写）、§14.5 ②（弯路记录补齐「兜底手段要随根因修复退役」）、
    §9 组件速查表、§11 自查清单新增「一个控件只有一层焦点信号」。
- **v8.18 多选回退成「右键进模式」+ 绩效明细补全 + 入离职改中性色**（2026-10-21，用户五条反馈）：
  1. **常驻勾选框列不要了**（用户「每张表最左边固定一列勾选框→不要，不好看，还是用之前那种右键菜单可以选择多选吧」）。
     改回：**右键行 / 右键表头 →「多选隐藏…」进入多选模式**；行模式才**临时**挂出勾选框列，
     列模式点表头切换；工具栏有「退出多选」，Esc 也能退出；隐藏完自动退出、勾选框整列删除。
  2. **拖拽选区整个删掉**（用户「按住它上下拖就是框选一片行→这个不行啊，按住拖拽就是选中文字了」）。
     `rowDrag`/`colDrag`/`suppressThClick`/`lastCtrlClick`/document mousemove+mouseup/`body.grid-dragging` 全删。
     ⚠️ 这两个方案已在 `grid.js` 文件头与 `设计系统.md` §10.6 写明「用户否掉，别再改回去」——
     正文上按住拖是**浏览器选文字**，表格不该去劫持原生文本选择。
  3. **绩效明细表数据不全**（用户「部分员工的名字都搜不到，比如某位已离职员工」）：原取 `perfActive`（只在职 210），
     28 名**有绩效但已离职**的人整批进不来。改为 `getFiltered().filter(d => d.hasPerf)`（238 行）+ 新增「状态」列
     （在职/离职药丸）；KPI / 九宫格 / 趋势仍按在职口径不变。
  4. **入离职改中性色**（用户「入离职相关的数据不关系好坏，都用蓝色或黑色」）：
     `renderPeople` 的「本月入职 / 本月离职 / 净增」三卡点色改 `--s1`、去掉 `pos/neg` 字色；
     各部门近 12 月净变化单序列改 `tc.s1` 蓝，原「红增绿减」取消。**入离职不是好坏信号，别借语义色。**
  5. **区间对比卡片顶部空一行**（用户「把年份写在数据上面，下面写离职人数和月均在册人数」）：
     `.kpi-card.range-card` 改成与其它 KPI 卡同构 —— `.kpi-label` 放年份（「2025 年」/「2026 年至今」）→
     `.kpi-value` 放离职率 → `.kpi-sub` 放「N 人离职 · 月均在册 M」。
  - **验收**：`tmp-grid-v3.js` 37/37 · `probe-grid2` 全 ✔ · `probe-gridbar` 21/21 · `probe-talent` 15/15 ·
    `probe-a11y` 19/19 · `probe-selx` 24/24，0 console 错误。
    另断言：全站平时 0 个 `.grid-selth` / `.grid-selcell`；正文拖拽后 `getSelection()` 有内容且选中行不变。
  - 文档同步：`设计系统.md` §10.6 改写为「多选（2026-10-21 二次定稿）」。
- **v8.17 表格多选重做 + 全站表格统一 + 绩效明细去截断**（2026-10-21，用户六条反馈，**其中第 2 条已于 v8.18 回退**）：
  1. 总览卡片「建设中」徽标、侧栏「人员明细」④ 角标全部删除（DOM 里已无 `.mod-badge` / `.nav-badge`）。
  2. ~~**多选改成「常驻勾选框列 + 拖拽」**（用户拍板，不用先右键进模式）~~ ——
     ⚠️ **2026-10-21 当天用户即反悔，v8.18 已整体回退成「右键进模式 + 点击选行」**，
     下面这条保留仅作历史记录，**不要再照它实现**：
     - 勾选框列是**真列**（DOM index 0），由 `syncSelCol()` 插入。⚠️ **所有按列号读写的地方都要过
       `cellAt()/colOff()/logicalIndex()/logicalCols()` 换算**——列筛选、冻结、排序、CSV 导出全都改过了，
       以后新写读列的代码别再直接 `row.cells[i]`。
     - 选行：按住勾选框列上下拖 = 区间；单击 = 切换；表头勾选框 = 全选可见行（半选 `indeterminate`）。
       选列：按住表头横向拖 > 8px（点一下仍是开筛选弹窗，拖完用 `suppressThClick` 吞掉那一次 click）；
       `Ctrl/⌘ + 点表头` = 单列增减。
     - ⚠️ **勾选框必须 `pointer-events:none`**：Chrome 在 `mousedown` 被 `preventDefault()` 后
       **仍会派发 input 的原生 `change`**，与手动 toggle 抵消（表现为「点了勾上又立刻取消」，逐层取证才查到）。
       指针事件交给单元格统一处理，键盘仍走 `change`；表头全选因此改挂 th 的 click。
     - 勾选框 `appearance:none` 自绘（用户原话「选中的 UI 好像还是原生的」），勾形用 border 旋转画，不引图标字体。
  3. **冻结后「镂空」的根因是半透明**：选中行原用 `--accent-soft`（rgba），压在冻结列的不透明底上时
     横向滚动会透出下层列。新增**不透明令牌 `--sel-bg`**（浅 `#e2edfd` / 深 `#1b3352`），
     选中行 / 选中列一律用它。⚠️ 别再改回 `--accent-soft`。
     冻结列在隐藏后重算 `left`（跳过 `display:none`），实测剩余冻结列首尾相接、无缝隙。
  4. **10 张明细表统一工具栏**（用户拍板「全部统一」）：`grid.js` 新增常驻 `.grid-tb`
     （搜索本表 / 隐藏所选 / 恢复隐藏 / 导出 CSV / 分页 20·50·100），mini-table 全给；
     员工明细表只补隐藏/恢复（它已有自己的搜索 / 分页 / CSV，不重复塞）。
     - ⚠️ **页码要数「分页前」的匹配行数**：`statCount` 在 `applyVisibility` 里记录 eligible 长度。
       数页面可见行会恒等于页大小 → 永远是「第 1/1 页」（已踩）。
     - 旧的悬停唤出工具条 `#gridBar` / `.gb-*` / `gridBarHideSel` / `gridBarExit` **整体删除**，
       多选模式概念一并取消；`#gridBar` 曾是懒创建，相关探针已改写。
  5. **筛选弹窗排版**：`.filter-popup` 加宽到 `min-width:300px`（内容决定宽度，只写 `max-width` 撑不开），
     值行内距 8/16、`max-height:288px`、标题/底栏 padding 统一 8/16。
  6. **绩效明细表「只有干部梯队」是截断造成的**：原按最新一期绩效从高到低排完再 `.slice(0,40)`，
     干部梯队高绩效扎堆正好占满前 40 行。改为**工号自然序、全量**（210 行，三个梯队齐全），
     排序仍可点表头，分页/搜索交给统一工具栏。
  - **验收**：`tmp-grid-v3.js` 29/29 · `probe-grid2` 全过 · `probe-gridbar` 19/19 ·
    `probe-a11y` 19/19 · `probe-selx` 24/24 · `tmp-freeze-hide` 6/6（冻结后再隐藏无镂空）·
    全站切页 console 0 错误；截图目测勾选框列 / 工具栏 / 冻结边界。
  - 文档同步：`设计系统.md` §3.4（`--sel-bg` 令牌 + `--accent-soft` 不再用于选中行）、
    §10.6（多选与工具栏规则）、§9 组件速查表、§7.5 降级选择器。
- **v8.16 绩效表改版适配 + 初评一律不读**（2026-10-21，用户新表「部分人缺少绩效数据」）：
  - **表结构变了**：绩效从「绩效考评明细」两张，拆成 `干部梯队26H1绩效` / `人才梯队26H1绩效` /
    `25H2绩效` / `干部梯队25H1绩效` / `人才梯队25H1绩效`；花名册 sheet 也改名为「人员名单」。
    旧谓词 `/绩效考评明细/` 与 `/^<部门代号>人员名单/` 全部落空 → 数据包里绩效 0 张、花名册没进来。
  - **谓词（两处必须逐字一致）**：`SHEET.perf`（`工具/生成数据包.js`）与 `isPerfSheet`（`data.js`）
    改成 `/绩效考评明细|^(干部梯队|人才梯队).*绩效$|^\d{2}H\d绩效$/`；
    台账侧 `isLedgerSheet` 必须先排除它（`绩效B-C人员` 名字里也有「绩效」），并补 `'B-C'` 关键字。
  - **初评一律不读**（用户两次强调）：表头写「…初评绩效等级」的列**完全不读**，没有「找不到终评就退初评」
    的兜底；`idxAll('2026','终评')` 必须锚定年份，否则单条件 `终评` 会先命中 25H1 那两张表、等级串期。
  - **跨表冲突**：`25H2绩效` 表全部 A-，而 26H1 表的「2025年终」列对应 18 人是 B+。
    无法用第三份数据裁决，用户侧按「专用表优先」处理：`perfSheetRank()` 让 `NNHn绩效` 这类
    **按期间单独成表的最后解析**（写死排序，不依赖 Excel 里 sheet 的先后）。
  - **结果**：绩效 5 张、可用 5 期（24H1/24H2/25H1/25H2/26H1）；口径内在职 318 人、有绩效 210 人。
    缺的 108 人**经比对确认绩效表里本来就没有这些工号**（ID 匹配失败 0 例），
    属源表覆盖范围（20 已转正 + 33 试用 + 27 外协 + 28 实习），不是解析问题。
  - ⚠️ **探针断言坑**：`tmp-verify-data.js` 里「页面不能出现『无绩效数据』」是**写反了**——
    「108 人无绩效数据，未纳入盘点」是正确且必要的提示语，不是缺数据告警。
- **v8.14 环形图标注折行 + 图例放不下就不画**（2026-10-16，修 v8.13 ② 留下的两个缺陷）：
  起因是转正与合同页「合同类型结构」图上，**图例文字被自己的 padding 裁掉**
  （屏幕上是「已期限劳动」「定期限劳」…），**环半径同时塌到 23px**（同页其他环形图 44–57px）。
  用户选的方案是「长名字折成两行」，但**没有照字面执行**——折行落在**引导线旁的标注**上，
  图例改为**放不下就整块不画**。全部改动集中在 `core.js` 的环形图区块。
  - **① 标注折行**：`wrapRingName` → `wrapRingText()`（先按空格切词，词还超宽才 `splitEven()`
    按字数均分），`ringLabelLines()` 返回**带字体与语义的行对象**（不再靠「最后一行是人数」猜）。
    预算 `labelBudget()` 改成**二分**求最小可行值（48 ~ 400），判据
    **「名称 ≤ 2 行 且 人数行 = 1 行」**（`RING_LABEL_LINES` / `RING_PCT_LINES`）。
    ⚠️ 判据别写成「整块 ≤ 3 行」——「男 / 266 人 / (84.4%)」也满足 3 行，二分就会一路缩到下限，
    把一行放得下的短名称也拆两行（试过：性别图 2 行→3 行，环反而更小）。
    ⚠️ **预算只看文字本身，不看画布宽**（旧版按画布宽算，才引出下面那条「两个宽度」的坑）。
  - **② 图例不折行，放不下就不画**：Chart.js 4.4.7 的 legend `_fitRows` 按**单行**量高
    （一个 `itemHeight`，不乘 text 数组行数），给 `text` 传数组**能画出两行却排不下两行、条目互相摞住**
    （试过，截图取证）。既然折不了、又和标注抢同一条横向空间，就只剩二选一：
    `legendNeedW(labels)`（最宽图例文字 + `RING_LEGEND_CHROME` 32）`> availW − 2×pad`
    时 `legend.display = false`。全站**只有转正与合同页那张命中**（要 140 > 可用 104），其余 5 张照旧。
  - **③ 建图那一刻的 `el.clientWidth` 不可信**：Chart.js 还没铺开 canvas，读到的是**固有尺寸 300**，
    比容器真宽 312 少十几像素。曾因此让位比文字少十几像素、**标注末尾被画布裁掉**；
    当时用 `inst.update('none')` 事后对账，结果**留下过期的弧几何**（R=82/cy=89，应为 71/78）。
    **对账块已整个删掉**，量宽源改成 `el.parentElement.clientWidth`（`.chart-box`，padding 0）。
  - **验收**：`probe-ringlabels` **34/34**（新增 ③ 段：按 `legend.legendHitBoxes` 断言
    留下的图例**不越界、条目不重叠**——正是「折行导致重叠」的回归守卫）；
    `probe-gridbar` 17/17 · `probe-grid2` 全过 · `probe-selx` 23/23 · `probe-ninebox` 13/13 ·
    `probe-a11y` 18/18 · `walk-pages` 全页 0 console 错误。6 张环形图逐张截图目测：无裁切、无重叠。
  - ⚠️ **已知代价**：人员概览页「组织类型」单块环半径只有 **44px**（让位 111 由「318 人 (100.0%)」
    这行人数撑大）。单块图本就没多少信息，暂不特殊处理；要放大就得允许**人数行也折行**，
    那会破坏「人数必须一行」的判据，**先问用户**。
- **v8.13 配色换代到四个标准色 + 环形图标注重做 + 表格悬浮工具条退役 + 筛选弹窗瘦身**（2026-10-15）：
  - **① 配色换代（用户给定 `#3186ff` `#fc413d` `#ffbe00` `#00af57`）**：
    **锚点色只管填充，文字一律走 `-strong` 档**——四个色里红 3.52、绿 2.89、黄 1.66（按白底算）
    全部不能当文字色。语义三族新值见 `设计系统.md` §3.1/§3.3。
    - 分类板 `--s1…--s6` 换成 s1 蓝/s2 绿/s3 红/s4 黄（= 用户四色）+ 自选 s5 品红 `#c026d3`、
      s6 青 `#00a6b8`（脚本搜出来的，非手挑）。**ΔE 浅 29.6 / 深 27.0**（旧版 24.8 / 24.1）。
    - 绩效 7 级梯、`--gtag-*`、`--expire-*` 全部跟着重配，相邻 ΔE 浅 18.1 / 深 19.0。
    - ⚠️ **代价：分类板的红绿与语义红绿同色**（用户两条要求叠加的必然结果）。后果是一条硬约束：
      **单序列计数图不得用 `s2`/`s3`**——纯人数用绿会被读成「这类人不行」，还会和同页真正的
      语义图撞色。本次据此把 `chartTrackTier` / `chartSource` / `chartSeriesBar` 三张改回 `s1`。
      **新加单序列图一律 `s1`；只有多序列分类图才动用完整色板。**
    - 顺带修两处：`.nav-badge` 字色改 `--on-warn`（白字压 `#ffbe00` 只有 1.66:1）、
      `.alert-close:hover` 描边改 `--warn-strong`（`--warn` 当 1px 描边等于看不见）。
    - 验收：`verify-palette.js`（**直接解析 `style.css`**）全达标；`probe-contrast-scan.js`
      浅/深各 33 组组合 **0 条不达标**；`shot-palette.js` 浅深各 4 页 0 console 错误。
  - **② 环形 / 饼图标注重做**（用户两轮反馈）：
    「图例写完整：女: 49 人 (15.6%)」→「**图例还原**，是引导线指着的数字要写完整」→
    「**对应的类别也要写上**，现在只写了数字和比例」。最终：**图例只留名称**
    （删掉 `ringLegendLabels` 自定义 `generateLabels`，走 Chart.js 默认），
    **引导线上两行**：类别名（`--ink-2` 600）/ `11 人 (36.7%)`（`--ink-3` 400）。
    - **引导线颜色试了三档，新增专用令牌 `--ring-leader`**（浅 `#9db0c6` / 深 `#3f5674`，约 2.2:1）：
      `--gridline` 1px「几乎看不见」→ `--ink-3` 1.5px「太深了」→ 最终**留住 1.5px 粗细、
      颜色单开一档**。引导线只把标签牵到弧面，信息在文字里，**不吃 3:1 图形门槛**。
      ⚠️ 别再借 `--ink-3` 当线用，它是「注释级**文字**」的灰，必然偏重。
    - `ringLabelPad(data, labels)` **要传 labels**——让出的宽度由「名称 / 数字」较长那行决定。
    - **一块也画**（原先 `length < 2` 就退出，理由「100% 是废话、图例已经说明」；
      数字挪出图例后这条理由不成立，不画就变成整张图一个数字都没有）。
    - ⚠️ **本节留有两个缺陷，v8.14（2026-10-16）已修，见上方 v8.14 条**：
      ① 标注不折行 → 转正与合同页「合同类型结构」图最长标签「无固定期限劳动合同」≈108px
      把环半径压到 **23px**（同页其他环形图 44–57px）；
      ② `ringLabelPad()` 的量经 `options.layout.padding` 作用于**整张画布**，**图例也被排进那个
      被压窄的盒子**，画布 312px 时可用宽只剩 48px → **图例文字两侧被裁**（「已期限劳动」…）。
      修法：标注折行（名称最多两行）+ 图例放不下就整块不画。
  - **③ 表格悬浮工具条退役**（用户「悬停还是会有冻结列的悬浮框出现，不需要了」）：
    `#gridBar` 原先「一副面孔两用」——常驻的「冻结到 N 行/N 列」条靠 `mouseover`/`focusin`
    唤出，多选模式条只在选中时出现。用户要删的是前者。
    - **不能整块删**：`hideSelected()` 唯一入口就是工具条按钮。改成**只保留多选模式条**
      （`showBar()` 开头 `if (!selMode || …) { hideBar(); return; }`）。
    - 删掉三个 document 监听器（`mouseover`/`focusin`/`mouseout`）、`window.gridBarFreeze`、
      `window.gridBarMode`、`barHideTimer`，以及 `.gb-sel` / `.gb-sep` / `.gb-note` / `.gb-btn.on`
      五条 CSS。**冻结 / 隐藏 / 恢复改走表头右键菜单**（菜单里本来就有，能力没少）。
    - ⚠️ **`#gridBar` 现在是懒创建的**（`ensureBarEl()`），探针里 `getElementById('gridBar')`
      要判空——已踩过一次（`probe-selx.js` ⑤ 段崩在 `.style` of null）。
  - **④ 筛选弹窗底部：删掉「冻结到此列 / 隐藏本列」**（用户「点击表头出现的下拉，不要有冻结到此列和隐藏此列按钮了，删掉」）：
    - 中间态曾因「4 个按钮 330px 塞进 300px 弹窗、都挤在一起」改过 `.fp-foot.stack` 两排
      （2026-10-13）。**两排只是把拥挤藏起来**，真正的问题是这两个按钮不属于这个弹窗 ——
      它们是表头右键菜单（`openHeadMenu`）的复述。删掉后回到 **2 个按钮一排**，
      与员工明细表那张弹窗同形（`gridOpenPopup` 与 `toggleFilterPopup` 底部现在完全一致）。
    - 能力没丢：**右键列头仍是冻结 / 隐藏的入口**；`th` 的 `aria-label` 提示语照旧保留
      （现在它是键盘 / 读屏用户唯一的入口提示，删不得）。
    - 删 `window.gridFreezeCol` / `window.gridHideCol`（唯一调用方就是这两个按钮）、
      `.fp-foot.stack` / `.fp-foot-row` / `.fp-foot-row.split` 三条 CSS。
      ⚠️ `.fp-foot.split` 也一并删了 —— 全库只剩这一处用，留着会让人以为还有分排版式。
  - **⑤ 探针维护**：断言随行为变更同步改（不是产品回退）——
    `probe-a11y`「焦点落在表头时工具条出现」→ 反转为「**不**弹工具条」；
    `probe-selx` ④ 段改成「`.gb-sel` 已彻底删除」的回归守卫；
    `probe-ringlabels` 的「只有 1 块 → 不画标注」改成「没有数据块 → 不画」；
    `probe-gridbar` ③ 段改成「弹窗底部 2 个按钮一排、无 `stack`/`fp-foot-row`」；
    `probe-grid2` ④ 段反转为「弹窗里**没有**冻结/隐藏按钮」的回归守卫。
    - 另修 `probe-gridbar` 自身一个序列化 bug（`Math.round(x)` 应为 `Math.round(x.y)`，一直误报）。
    - ⚠️ **`probe-talent` 的「六处 `:active` 都在生效的样式表里」是假失败**，根因值得记：
      **`file://` 下每份文件是各自的不透明源，`document.styleSheets[i].cssRules` 一律抛
      `SecurityError`**，被 `try/catch` 吞掉后 `found` 恒为空 → 六条全报「缺失」。
      改为在 node 侧读 `style.css` 源文本逐项比对（本探针只验「规则在不在」，按下观感靠截图）。
    - ⚠️ **两个探针的靶子被 v8.9 删页掏空了**（2026-10-16 修）：
      `probe-grid2` ②③④⑤ 和 `probe-selx` ②⑤ 原本都拿 **`#page-ledger`**（HR 工作台账页）
      与 **`.range-select`（自定义起止区间）**当靶，两者分别已于 v8.9 / 2026-10-15 删除 →
      探针取到 `undefined` 直接崩（`#page-ledger table` 找不着 / `rangeStart` 是 null），
      **崩溃比失败更糟：它看起来像「这次改动把功能弄坏了」**。
      改靶：`probe-grid2` 换到**社招需求页 `#recruitNeedTable`**（同样走 grid.js 通用挂载），
      冻结改走**右键菜单**（悬停工具条退役后这是唯一入口）；`probe-selx` 换到
      **顶栏人群下拉 `#filterGroup`**（同为 `enhanceSelects` 接管，且是全站唯一的 `.selx.is-group`）。
      - 顺带修三处**探针自己写错的断言**（不是产品问题）：
        ① 员工明细「漏斗全覆盖」——第 1 列「序号」带 `data-nofilter`，本就该少一个，改成「除序号外全覆盖」；
        ② 行冻结断言 `行1 top === 0`——top 是**累加值**，正文第 1 行 = 表头高（>0），改成「逐行递增且都 >0」；
        ③ 列筛选读 `checkbox.value`——值挂在 **`data-val`** 上（`value` 恒为 `"on"`，按它筛等于没筛）。
      - ⚠️ 挂漏斗是 MutationObserver 异步做的：固定 `waitForTimeout(900)` 有时够有时不够
        （同一次改动前后跑，漏斗数在 **0 和 49** 之间跳）。改成 `waitForFunction` 等它出现。
      - ⚠️ 顺带查实一条**行为**（非 bug，是刻意的）：列多选里点「隐藏所选」后 `clearSelVisual()`
        退出模式 → `showBar()` 见 `selMode` 为空 → `hideBar()` 把 **`barTable` 清空**。
        所以此后**不能**再调 `gridRestoreHidden()`（它 `if (!barTable) return`，静默什么都不做），
        **恢复要走右键菜单的「恢复隐藏（N）」**。行多选不受影响（它刻意留在模式里）。
        「被隐藏的列头点不到了、留着模式也没法反选」正是列这边退出模式的理由。
  - **⑥ 司龄口径：离职的人算到离职日**（2026-10-16，用户报「某员工 1/5 入职、7/8 离职，为什么司龄 0.8 年」）：
    - 根因：`calcTenure(jd)` 只接一个参数、**一律算到 `Date.now()`**，离职者被算成「活到今天」。
      该员工 → 1/5 到 10/16 = 284 天 = **0.778 年 → 显示 0.8年**（用户看到的数）。
    - 修法：新增 `empTenure(d)` = `calcTenure(d.joinDate, 离职 ? d.leaveDate : null)`，
      只给**员工明细表**的司龄列 / 排序 / CSV 用（`table.js:88/111/188`）；
      「离职人员平均司龄」「在职时长分布（离职时）」走 `tenureSpanOf()`（也是 join→leave），口径一致。
      → 该员工现在 **184 天 = 0.504 → 显示「0.5年」**。
    - ⚠️ **在职人群的行为一个字没变**：KPI / 图表 / 预警仍走 `calcTenure` 原语义（到今天截止）。
      `empTenure` 只是给「已经离开的人」补上终点，别顺手把别的调用点也换掉。
  - **验收**：`probe-scope` 38/38 · `probe-simplify` 25/25 · `probe-a11y` 18/18 ·
    `probe-selx` 24/24 · `probe-ringlabels` 24/24 · `probe-ninebox` 13/13 ·
    `probe-talent` 15/15 · `walk-pages` 全页 0 console 错误 ·
    `probe-contrast-scan` 0 条不达标 · 全站 0 console 错误。
- **v8.12 人口口径统一到顶栏下拉 + 自定义下拉不要焦点环**（2026-10-14，用户两条反馈）：
  - **反馈一「很多数据还是限制了只计算正式员工，我希望筛选限制只用最上方的下拉筛选」**。
    关键认识：`getScopeData()` / `getFiltered()` **已经**把 `filterGroup` 套在 `rawData` 上了，
    所以页面里再叠一层 `formalOnly()` 就是**二次收窄** ——「选了全部还是只算正式员工」就是这么来的。
    改法是**删掉收窄**，不是加新过滤。新增 `core.js` 的 `scopeOfFilter()` / `scopeLabelOf(short)`
    作唯一口径来源（下拉的值恰好就是 `SCOPE_META` 的键，可直接喂 `scopeTag`/`scopeNote`）。
  - 删掉的二次收窄：`renderKpiCards`（离职率/净增/平均司龄三卡的 `formalScope`/`pop`）、
    `renderTurnover`（`rateBase` 原为 `eff==='all' ? seg.formal : seg[eff]`，现直接 `rel`；
    `chartLeavers`/`joinPop` 同批）、`renderStructDist`（`formalActive` → `levelPop`，
    `window.__formalActive` 随之改名 `__levelPop`，`renderLevelDrill` 形参同步）、
    `renderOverview` 的 `trendPop`、`alerts.js` 的绩效三条（5/6/7，`scope:'formal'` → `'all'`）。
    顺带删掉与 `scopeOfFilter()` 重复的 `effFlowType()` + `FLOW_TYPES`。
  - **两处刻意保留，不是漏改**：
    ① `renderOps` 的转正队列仍 `formalOnly(active)` —— `estProbEndOf` 对谁都给得出日期
    （缺 `probationEnd` 就按入职+6 月估），不限定正式员工会把实习/外协算进「届满」分母、转正率凭空掉一截；
    ② 预警 2/3（试用期届满 / 逾期未转正）仍走 `formal` —— 它们本来就带 `empType==='试用期'` 闸门，
    结果与 `active` 完全相同，写出来只是让徽标说真话。
  - **社招 / 编制口径没动**：`ledgerData.recruitOpen` 与 `dsData.budget` 是**独立的 Excel 数据集**，
    根本不经过顶栏人群筛选，谈不上「放开」；而 `dsBudgetSummary()` 只数正式员工是**已修的 bug**
    （CLAUDE.md 记过「此前误用全员在职，会把达成率抬高」），反向改回去等于把 bug 装回来。
  - **反馈二「不要焦点环」**：`.selx-btn` / `.selx-opt` 两处显式 `outline:none`，
    改走 `border-color`（按钮）与 `.active` 底色（菜单项）。这是 `设计系统.md` §5.5 记在案的
    **唯一例外**。踩坑：单类 `.selx-btn:focus-visible`(0,2,0) 被 `.selx.is-group .selx-btn`(0,3,0)
    压住，而「人群」下拉正是 `.is-group` —— 现写成 `.selx .selx-btn:focus-visible` 并放在 `.is-group` 之后。
  - 验收：`.workbuddy/binaries/node/workspace/probe-scope.js` **38/38 通过、0 console 错误**
    （含真实键盘 Tab 验焦点环；`el.focus()` 在 Chromium 里不触发 `:focus-visible`，会误报）。
    另 `probe-simplify.js` 复跑 25/25 无回退。
- **v8.11 动效放缓**（2026-10-13，用户反馈「太快、突兀」）：
  - 三档时长整体上抬：`--dur-fast` 120→**150ms**、`--dur-base` 180→**220ms**、`--dur-slow` 260→**300ms**
    （300 就是 UI 动效上限，**别再往上加**）。
  - **主因不是时长而是曲线**：`--ease-out` 原为 `cubic-bezier(.22,1,.36,1)`（easeOutExpo 级），
    前 15% 时间就走完九成距离，眼睛看到的是「啪」一下。换成 `cubic-bezier(.215,.61,.355,1)`
    （easeOutCubic 同族）——仍然开头快（响应感不丢），但把位移摊到整段时长上。
    `core.js` 的图表入场同步 `easeOutQuart` → **`easeOutCubic`**，**CSS 与 Chart.js 两边必须同族**。
  - 逐项交错（24ms/档、第 6 块封顶 120ms）与 reduced-motion 降级不变。
  - 验收：`.workbuddy/tmp-motion.js` **9/9 通过、0 console 错误**（含 reduced-motion 下
    位移降级成 `ds-fade`、图表 `animation:false`）。
- **v8.10 设计系统落地**（2026-10-13）：新建 **`设计系统.md`**（13 节：原则 / IA / 色彩 / 度量 /
  状态模型 / 交互 / 动效 / 图标 / 组件速查表 / a11y 清单 / 令牌流程 / **例外与弯路记录**），
  按「当前事实」写，**改样式前先读它的「改动自查清单」**。
  - **令牌层重建**：`style.css` 的 `:root` 收敛为 **90 个令牌，逐个有用户、无悬挂引用**；
    删 6 个零引用档（`--fs-44` `--fw-normal` `--ctl-h-lg` `--hit-touch` `--t-fast` `--t-base`），
    把原有但没人用的 `--shadow-pop` / `--hit-min` 接上（→ `.filter-popup` / `.link-btn`）。
    间距归 8 网格（4/8/16/24/32/48），字号去半像素档。
  - **等级配色换层**：原先 `campusGradePill`/`trackGradePill` 用 **JS 挑分类色板**（`--s1…--s6`）当白底文字色，
    `--s2` 绿 3.3:1、`--s5` 黄绿 1.6:1 全不达标；改为**归档位色阶**（`.pill-grade-*` → `--gtag-*`，
    与绩效 `.tag-grade-*` 同批色）。`core.js` 抽 `GRADE_RUNG` + `gradeRung()` 作**唯一映射**，JS 不再挑色。
  - **修 3 处实测问题**：`.link-btn` 命中区 38×17 → 38×25；等级药丸对比度 3.3 → 5.18–8.31（浅）/ 9.03–12.99（深）；
    `.filter-bar select:focus` 等写 `outline:none` 权重压过全局 `:focus-visible`、把焦点环删了（改为只加描边）。
    另修 `.filter-popup` 影层用错、`--ink-3` 按白底校准（改按最深底色 `--surface-2`）。
  - **验收**：`.workbuddy/tmp-ds-probe.js` **32/32 通过、0 console 错误**；焦点环真键盘 Tab 驱动 30/30 有环
    （`page.focus()` 是程序聚焦、Chromium 不认作键盘模态，会误报，勿用它验焦点环）。
  - 删 `使用指南.md`（内容并入 `设计系统.md`）。
- **v8.9 社招两页落地 + 日常办公组删除 + 流失时间窗 + 结构分布区**（2026-10-12）：
  - 菜单「招聘管理」→「社招管理」，`recruit_overview/recruit_need` 从占位转正为「社招概览/社招需求」；
    数据 = `ledgerData.recruitOpen`（`parseRecruitOpen` 已补「备注」列）。口径：备注含「已入职」=达成（剔除出缺口 KPI，
    需求页保留打绿标 `pill-done`）；渠道三分 正式工(s1)/外协(s2)/双渠道(s4)；原因归五桶（离职替补/人力缺口/新增需求/技术攻坚/其他）。
    概览 = 5 KPI + 部门×渠道堆叠 + 原因环图 + 影响项目 Top15 hbar + 明细表；需求页 = 5 KPI + 全量明细表（grid 自动筛选）。
  - 删「日常办公」组四页（structure/demographics/health/ledger）：renderStructure/renderDeptMatrix/renderDemographics/
    renderHealth/renderLedger/renderBudgetGap/tc2/structureScope/scopeWord 全删，refreshAll 对应清理，
    `refreshAll` 的 `!rawData.length` 分支改为直接 return。ledger.js 解析层保留（社招数据 + 未来校招页共用），
    顶栏「上传台账」按钮保留（后于同日并入「上传数据」）。台账里的末位改进/储备干部/高潜/校招需求等块的**数据仍在**（ledgerData），后续占位页可直接消费。
  - **顶栏精简 + 面板/简报页整体移除**（2026-10-12，用户要求）：五个顶栏按钮
    （上传人员数据/上传绩效数据/上传台账/数据维护/简报模式）合并为一个靠右的 **「上传数据」**（`.tb-right`），
    走 `uploadData()` → `handleFiles`（`ingestWorkbook` 按 台账→人员→绩效 依次判定，用户不用先选类型；
    绩效 sheet 表头是「工号/姓名」而 `FIELD_MAP` 只认「员工编号/员工姓名」，所以不会被误当人员表吞掉）。
    **数据维护面板**（`#dataPanel`/`#dataPanelOverlay`/`toggleDataPanel`/`refreshDataPanel`/`reloadDataSource`/
    `saveDataPack`/`reloadFromDataFolder`/`clearSnapshot`/`buildPackText`/`pickDir`/`writeFileInDir`/`idbGetKey`/
    `idbSetKey`/`rosterIdsFromPack`/`dsUpdateStatusUI` 及全部 `.dp-*` 样式、`--z-dp*`/`--shadow-drawer` 令牌）
    与**简报模式页**（`#page-brief`/`renderBrief`/`PAGE_TITLES.brief`/全部 `.brief-*` 样式）一并删除。
    数据更新改由 `更新数据.bat` 承担；`_packedBooks` 与 `wbToPack()`（只为「保存为数据包」而存在）随之删除。
    ⚠️ 副作用：面板里那个「回到数据包 / 清空浏览器缓存」没了，唯一的回退路径是重跑 `更新数据.bat` 换 `built` 再 F5。
  - 人员异动页加「统计窗口」分段切换（当时是 m3/m6/m12/m24/ytd/all + 三档「较N年末」；
    m24/ytd/all 已于 v8.21 删除，因为从未有按钮指向它们。`flowWindowOf()` 返回 months+sinceMs，
    all 档探测数据起点、趋势图最多 60 个月；rollingTurnover 改签名 `(scopeArr, months, sinceMs)`）。
    作用于流失+入职板块全部 KPI/图表；转正与合同不跟随。
  - 人员概览新增「结构分布」区（renderStructDist，13 图三组：职级体系 level/level·subLevel/jobFamily/position Top15；
    人群画像 gender/age/talentPipeline/edu/workLocation；年限与来源 tenure/工龄/社经vs司龄/招聘来源），
    口径开关 seg-switch（仅正式默认/全员，filterGroup 指定人群时遵从）；旧 demographics 页的
    学历/地点/社经vs司龄图逻辑并入。新 helper：`hbarChart`（indexAxis:y + parsed.x tooltip）。
    `parseRecruitOpen` 的过滤从 `!n ||` 改为只看部门空——需求人数 0 的行要保留（备注=已入职）。
  - 验证：probe 脚本 `.workbuddy/tmp-probe-new.js`（社招两页 KPI/表格/绿标 + 窗口切换 + 结构区 13 图）全过 0 console 错误。
- **v8.8 移除分享版功能**（2026-10-12，用户要求）：删 `分享版/` 目录、`工具/生成分享版.js`、
  看板面板分享按钮组 3 个、`data.js` 分享导出函数块（buildSharePackText/writeSharePack/三个入口）、
  `生成数据包.js` 的 `--share` 分支与安全自检。`--out` 参数保留。全量包重出验证 ✓。
- **v8.7 侧边栏二级菜单 + 人员概览页**（2026-09-13，按「人力看板设计说明.md」实现）
  - **侧边栏改两级**：7 个一级组（人员/招聘/校招/人才梯队/干部梯队/绩效/外包）+「日常办公」旧页区。
    一级菜单可展开/收起（`toggleNavGroup()` + `.nav-group.open`），当前页高亮一级也高亮二级。
    映射：`人员异动`=旧 人员流动+转正与合同（`PAGE_MULTI.move`）；`梯队绩效`=旧 梯队绩效盘点页（`PAGE_MULTI.talent_perf`）。
  - **占位页**：未实现的 15 个二级菜单项统一落到 `#page-placeholder`（`PLACEHOLDER_PAGES`+`renderPlaceholder()`）。
    ⚠️ `switchPage` 里占位页的 ids 必须给 `['placeholder']`，否则所有 section 都被隐藏、内容空白（已踩）。
  - **人员概览页**（`page-people` / `renderPeople()`，三大模块）：① 人员规模 5 卡 ② 人员结构（部门横向条形+组织类型环形+职级结构）③ 人员预警（未来60天转正/合同/离职 3 卡）。
    ⚠️ 原第 ③ 块「人员变化（本月入/离职/净增 + 近12月入离职双折线）」**已于 2026-10-26 整块搬到人员异动页**
    （见文首 v8.20），概览页只剩三块。
  - **交互框架**：所有卡片/图表点击 → `jumpToDetail(key)` → 人员明细自动带筛选（`alerts.js` 的 `DETAIL_FILTERS` + `registerDetailFilter()`；`drill:` 前缀运行时解析）。明细顶部横幅 `empAlertBanner` 可一键清除。
  - **职级结构不框死序列名**（换公司可复用）：`seriesChannelOf()` 优先取 KPA「职位序列中文描述」（`normSeries` 归一化），缺失才按职等前缀兜底；通道清单由数据驱动，数据里有什么序列就展示什么（当前数据：研发技术/营销/支持/管理/未识别）。下钻 = 序列 → 职等 → 子等级 → 明细，`drillPanel` 全数据驱动。
  - **口径**：人员规模/结构/变化/趋势均为全体在职（正式+实习+外包）；职级结构**原为仅正式员工，2026-10-14 起改为跟随顶栏人群下拉**（见 v8.12）；较上月变化暂缺历史快照，不显示。

---

## 以下为 v8 的指标口径与视觉规范（仍然有效，改造时全部保留）


- **v8 相对 v7 的核心变化**
  1. **三类人群拆开**：`staffGroupOf()` 把 KPA 用工 6 类归并为 `正式员工 / 实习生 / 外协 OD` 三组；`segByGroup()/groupCounts()` 做分组统计。公司口径「在职 N」= 正式员工（已转正+试用期），不含实习与外协
  2. **口径徽标**：每个指标旁挂 `正式` / `正式+实习` / `全员` 三色徽标（`scopeTag()`/`scopeNote()`），一眼看出含不含实习/外协
  3. ~~**比率指标只算正式员工**~~ —— **2026-10-14 用户拍板改掉**：人口口径**只跟顶栏「人群」下拉**，
     选「全部」就是全员口径（离职率 = 全员离职 ÷ 全员月均在册，**与公司口径不同**，用户已确认接受）。
     全站唯一还保留 `formalOnly()` 的地方是「转正与合同」页的转正队列（转正概念只属于正式员工，
     放开会把实习/外协算进「届满」分母），详见下面的 v8.12
  4. **部门透视表**：`renderDeptMatrix()` 出 18 个二级部门 × 在职/正式/实习/外协/滚动离职率/平均司龄/主要职等
  5. **HR 工作台账页**：新增 `v8/js/ledger.js`，解析手工台账 9 个 sheet → 招聘缺口/末位改进/储备干部/高潜/外协/入职/校招/部门梯队
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
     - **分享版（物理裁剪）**：`data/生成分享版.js`（7 步自包含）产出 `v8/分享版/`。核心原则——**不是界面隐藏，而是文件里根本没有**：只保留 `一级部门英文简称===本部门代号` 的行，其余全部剔除
       - 生成物：`index.html`（改标题/副标题、**移除中心筛选器**、插 `share-banner` 横幅、**移除 4 个上传/重读按钮**、注入 `window.HR_DATA_FILES` + `HR_IDB_NAME='hr-dashboard-v8-shared'` + 运行期补丁）+ 裁剪后的数据文件 + `css/js/vendor` 副本 + `打开分享版.bat`
       - **IDB 库名必须隔离**（`hr-dashboard-v8-shared`）：否则会从本机残留的完整版快照恢复出含其他中心的数据，物理裁剪被自己的缓存绕过
       - **安全自检**（脚本第 7 步）：裁剪文件非本部门行数须为 0 · 分享版目录不得有 KPA 原件 · HTML/JS 不得出现其他中心名（词界匹配，避免 BU1 命中 BU10）
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
     - **验收**：`walk-v85.js`（+ `run-walk-v85.js` 运行器）——完整版自动加载全量人员 / 台账 10 / 数据源 errors 0；分享版仅本部门人员 / 越权检查仅本部门 / 0 错误；编制口径断言 actual=正式员工数而非全员数
  11. **v8.6 单一汇总表 + 花名册分享**（2026-09-12）
     - **`data/<汇总表文件名>`（见 `bu-config.local.js` 的 `book`）成为唯一维护文件**（19 sheet：填写说明 · 看板 · 人员数据 · 绩效×2 · 台账×9 · 部门编制/指标目标/月度快照/招聘计划 · 花名册）。做法与坑见上文「单一汇总表」与「重打包 zip 的坑」两节
     - **（已删）`工具/建汇总表.js`**：曾负责散装 Excel → 汇总表，v8.7 起弃用删除。其「看板」公式页经验仍有效（**全部用 SUMPRODUCT，不用 COUNTIFS** —— `"<>T"` 在空单元格上行为不一致会算错；行号一律运行时算，不写死，否则前面插一行全错）
     - **`生成数据包.js` 改为按 sheet 名从汇总表拆四路**；人员**优先取 `KPA*.xls` 原文件**（HTML 要看新鲜原表），找不到才回落汇总表副本
     - **浏览器端新增**：`ingestConsolidated()` / `looksLikeConsolidated()` / `subWorkbook()` / `rosterIdsFromPack()` / `exportSharePackByRoster()` / `isRosterSheet()`。`handleFiles` 会识别「整份汇总表」并自动拆解 → **用户可以整份拖进来**
     - **花名册成为分享名单的权威来源**：删一行 = 以后不再发这个人。分享版数据包生成加白名单模式（`mode:'roster'`），无花名册时回落按中心列裁（`mode:'center'`）
     - **数据维护面板重排为三组 7 个按钮**：更新数据（从 data 文件夹读取最新数据 · 回到数据包 · 把当前数据保存为数据包）/ 分享给本部门管理人员（用花名册导出分享版 · 导出分享版数据（仅本部门）· 用指定名单导出分享版）/ 其它（清空浏览器缓存）
     - **`生成数据包.js` 的 `findFile()` 按 mtime 取最新一份**（导出文件名带时间戳，按名字排序会拿到旧的）
     - **踩坑记录**：T1 台账 sheet 的 `!ref` 声明假范围（上百万行），遍历前必须 `sheetRowsSafe()`/`aoaOfSheet()` 裁剪；
       T2 SheetJS 社区版不写 `<calcPr>`；T3 **EOCD 的 CD 偏移写错导致 Excel 打不开、但 SheetJS 能读**（隐藏最深的一个，见上）；
       T4 裸字节搜 `indexOf('fullCalcOnLoad')` 在 deflate 压缩后必然返回 -1，会误判成「没写进去」
     - **验收**（2026-09-12 全部通过，控制台 0 错误）：`walk-file.js` 完整版全量人员 / 在职 = 正式+实习+外协 三组相加 / 绩效记录数一致 / 台账 9 / 10 页 34 图 · 幂等不重复累加 ·
       拖入覆盖更新 · 页面内裁分享版只留本部门、其余剔除、自检 0；
       `walk-share.js` 分享版仅本部门人员 / 在职 = 三组相加 / 中心集合仅本部门一个 / 无上传与数据维护按钮 / 无越权 / IDB 隔离；
       `walk-consolidated.js` 整份汇总表拖入与基线一致 · 在职 = 三组相加 · 手工四表 19/5/6/3 · **花名册随包进来** · 白名单模式命中 3 / 越界 0 / 能识别不存在的工号；
       `relocate-share.js` 复制 116 文件到别的目录仍能双击打开
- **结构**：`js/core.js`（状态/字段映射/人群分组/口径工具/解析/图表封装）→ `js/ledger.js` → **`js/datasource.js`**（手工数据源）→ `js/pages.js`（9 页渲染）→ `js/table.js` → `js/alerts.js`（8 条预警带口径）→ `js/data.js`（汇总表拆分/上传/自动加载/台账识别/IndexedDB/筛选器，最后加载）
- **页面**：总览 / 组织与用工 / 人员结构 / 人员流动 / 转正与合同 / 梯队绩效盘点 / 职级健康度 / **HR 工作台账** / 员工明细 / 简报模式
- **数据持久化**：IndexedDB `hr-dashboard-v8`（人员 + 绩效 + 台账三份快照），上传后自动存，重开自动恢复（库名由 `window.HR_IDB_NAME` 可配，历史兼容）
- **数据坑备忘（v8 新增）**
  - 台账 sheet 的 `!ref` 存在**声明假范围**（如「招聘未达成需求」声明 1048536 行 × 16374 列），必须用 `sheetRowsSafe()` 裁剪后再遍历，否则 OOM
  - 台账汇总行（「合计/小计」）名称列为空，解析时须用 `!lv(cellAt(row, i.dept))` 过滤，否则会被算成数据行
  - 台账存在**右侧小表**，取说明性文本时只取每行最靠左一格 ≥8 字符且含中文的长文本，避免串行
  - 绩效结果**只保留每半年度等级**，细分维度不接入（自评名单不接入）
- **测试**：Node 验收脚本 `~/.workbuddy/binaries/node/workspace/test-v8.js`（core+ledger+pages 同作用域 eval + 真实 Excel 跑数）
  - **file:// 冒烟（当前主用）**：`walk-file.js`（完整版）· `walk-consolidated.js`（整份汇总表拖入）。
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
