# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⭐ 当前版本：v8（`v8/` 目录）— HRBP 工作台 · 冷色调 · 三类人群分开

2026-09 在 v7 基础上做口径升级。**新需求一律改 `v8/`**。

- **目录结构**（2026-09-11 整理后）：`v8/`（当前版本）· `data/`（4 份数据 Excel：KPA 人员 / 台账 / 绩效 / 中绩效考评名单，**不入库**）· `CLAUDE.md` · `.git`。**v1~v7 已全部清理**；验收脚本 `walk-v84.js` 的数据路径已指向 `/data/`
- **入口**：`v8/index.html`，双击即用；Chart.js/SheetJS 已本地化到 `v8/vendor/`，断网可用
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
- **结构**：`js/core.js`（状态/字段映射/人群分组/口径工具/解析/图表封装）→ `js/ledger.js` → `js/pages.js`（9 页渲染）→ `js/table.js` → `js/alerts.js`（8 条预警带口径）→ `js/data.js`（上传/台账识别/IndexedDB/筛选器，最后加载）
- **页面**：总览 / 组织与用工 / 人员结构 / 人员流动 / 转正与合同 / 梯队绩效盘点 / 职级健康度 / **HR 工作台账** / 员工明细 / 简报模式
- **数据持久化**：IndexedDB `hr-dashboard-v8`（人员 + 绩效 + 台账三份快照），上传后自动存，重开自动恢复
- **数据坑备忘（v8 新增）**
  - 台账 sheet 的 `!ref` 存在**声明假范围**（如「招聘未达成需求」声明 1048536 行 × 16374 列），必须用 `sheetRowsSafe()` 裁剪后再遍历，否则 OOM
  - 台账汇总行（「合计/小计」）名称列为空，解析时须用 `!lv(cellAt(row, i.dept))` 过滤，否则会被算成数据行
  - 台账存在**右侧小表**，取说明性文本时只取每行最靠左一格 ≥8 字符且含中文的长文本，避免串行
  - 绩效结果**只保留每半年度等级**，细分维度不接入（自评名单不接入）
- **测试**：Node 验收脚本 `~/.workbuddy/binaries/node/workspace/test-v8.js`（core+ledger+pages 同作用域 eval + 真实 Excel 跑数）；浏览器冒烟 `walk-v8.js`（playwright-cli，单命令会话）
- **验收结论（2026-09）**：人群拆分后的在职数与手工台账逐项对齐（正式 + 实习 + 外协 = 在职合计）；9 页遍历零控制台错误；台账 9 sheet 解析 59ms（OOM 防护生效）

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
