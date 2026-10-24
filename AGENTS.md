# AGENTS.md

Obsidian 插件「Oh My Plan Board」：侧边栏按天展示计划清单，支持多份计划、日历视图、进度环，数据是一份普通 JSON，插件与 `cli.mjs` 共用。

## 常用命令

```bash
npm install                 # 首次
npm run check               # tsc --noEmit，唯一的静态检查
npm run build               # check + esbuild production → main.js（根目录，勿手改）
node esbuild.config.mjs     # 开发期 watch（带 inline sourcemap，不压缩）
./install-to-vault.sh [vault]   # 先 build，再复制 main.js/manifest.json/styles.css 到 <vault>/.obsidian/plugins/oh-my-plan-board
```

`install-to-vault.sh` 默认 vault 为 `/Users/chou/obsidian_study_notes`。安装后需在 Obsidian「第三方插件」中启用（id `oh-my-plan-board`）。

CLI（无依赖，Node ESM）：

```bash
node cli.mjs --vault <vault> [--plan .plan-board/plan.json] <命令>
node cli.mjs --vault <vault> summary --json
```

命令：`summary` `show` `init` `add-day` `add-item` `update-item` `toggle` `check` `uncheck` `delete-item` `delete-day` `set-title` `reflow --start` `import --file [--merge]` `export` `help`。`--vault` 也可用环境变量 `OBSIDIAN_VAULT`；`--plan` 必须是 Vault 相对路径且不能跳出 Vault。`--day` 接受 id、1 起的序号或 `Day 1` 标签；`--item` 只接受 id 或 1 起的序号。

## 目录

| 路径 | 作用 |
| --- | --- |
| `src/main.ts` | 插件入口：注册视图/命令/设置页、`window.planBoard` API、多计划 store 缓存、Vault 文件监听 |
| `src/view.ts` | 唯一视图（`plan-board-view`），手写 DOM 渲染：头部、进度卡、月历、当日清单、保存链 |
| `src/model.ts` | 数据模型、进度计算、`normalisePlan`（容错入口）、日期/ID 工具 |
| `src/plans.ts` | 计划文件发现（legacy + `plans/` 目录）、标题转文件名、新建计划骨架 |
| `src/store.ts` | 单个计划文件的读写与缓存、自动建目录、串行化写入 |
| `src/calendar.ts` | 42 格月历（周一开头）、ISO 日期解析与增减，无 Svelte/moment |
| `src/new-plan-modal.ts` | 新建计划弹窗（标题 + 起止日期日历选择器） |
| `src/settings.ts` | 设置项只有 `planPath`；设置页含「初始化计划文件」 |
| `cli.mjs` | 独立 CLI，自带一份与 `model.ts` 平行的规范化逻辑（见「坑」） |
| `styles.css` | 全部样式，`pb-` 前缀，只用 Obsidian CSS 变量 |
| `main.js` | esbuild 产物，Obsidian 实际加载的文件，禁止手改 |
| `_ref/` | 上游参考项目完整 checkout（calendar-ui / checklist-plugin / progress-bar），只读，不参与构建或类型检查 |
| `seed-20day.json` | 导入用示例数据（`required`/`optional` 简写数组） |

## 数据契约

- 目录固定为 Vault 下的 `.plan-board/`。默认/legacy：`.plan-board/plan.json`；新计划：`.plan-board/plans/<标题>.json`（标题中的 `\ / : * ? " < > |` 替换为 `-`，截断 60 字符，重名加 `(2)` 后缀）。
- `settings.planPath` 指向「当前计划」；视图下拉框可在「全部计划」与单份计划间筛选，但列表始终来自 `listPlanOptions()`（legacy 文件 + `plans/` 下所有 `*.json` + 当前路径）。
- Plan：`{ version: 1, title, subtitle?, startDate?, createdAt, updatedAt, days[] }`；Day：`{ id, label, date?, title?, items[] }`；Item：`{ id, text, kind: "required"|"optional", done, doneAt? }`。
- `date` 为本地 `YYYY-MM-DD`（不是 UTC）；缺失时按 `startDate` 顺延；`doneAt`/`createdAt` 为 ISO 时间戳。
- `normalisePlan` 是容错层：补 id（重复则加后缀）、补 label、把字符串 item 升级为对象、`kind` 非 `optional` 一律 `required`。插件侧与 CLI 侧各有一份，改动时必须同步。
- 进度：`dayProgress` 同时算总数与「必做」子集；`planProgress` 汇总，`daysDone` 只统计有任务且全完成的 day。
- 新建计划天数 = 起止日期含首尾，`buildPlan` 夹在 1–366 天。

## 运行时机制

- `PlanStore` 按路径缓存；`load(force)` 决定是否重读。`main.ts` 用 `stores: Map` 为每份计划复用 store。
- 保存：`view.save()` 先 `plugin.markWrite()` 再走 `saveChain` 串行写入，失败弹 `Notice`；`store.save()` 统一写 2 空格缩进 + 末尾换行，并刷新 `updatedAt`。
- 外部改动：监听 vault `modify|create|delete`，只认 `.plan-board/` 下的 `.json`；180ms 防抖，且距本插件上次写入不足 800ms 时跳过，避免自写自读打架。
- `window.planBoard = { load, save, refresh, open, path }`，供 Templater / Advanced URI / 控制台调用；卸载时删除。
- `render()` 每次整体重建 DOM；选中日期、计划筛选、折叠集合都存在实例字段里，重建时据此还原，`pendingFocus` 通过 `data-day`/`data-path` 把焦点放回新增任务输入框。异步 `reload()` 用 `reloadToken` 丢弃过期结果，避免旧数据覆盖新状态。

## 风格与交互约定（改 UI 前必读 README「设计约定」）

- 用户可见文案一律中文；代码注释/标识符英文。
- 颜色只走 Obsidian 变量（`--interactive-accent`、`--text-normal`、`--background-primary`…）；accent 仅用于进度/选中/主操作，绿=完成、红=逾期，其余中性。
- 不用 emoji、彩色图标或装饰符号；对号、箭头、圆环都是 CSS/SVG 几何。
- 动效克制：中性 hover、按下位移、焦点描边、对号描边、圆环/进度条缓动；`prefers-reduced-motion` 下全部关闭（`scrollIntoView` 也按此切换 `behavior`）。
- 删除「计划」和「某一天」需二次点击确认（2.5s 内再次点击才执行）；删除单条任务单击即删，交互保持一致时注意这个差异。

## 坑

1. **`required`/`optional` 简写只有 CLI 认识**。`cli.mjs` 的 `normalisePlan` 会把它们合并进 `items`；`src/model.ts` 只读 `items`。直接把简写 JSON 放进 `.plan-board/` 会被插件读成空 day，且下次保存就永久丢失。走 `node cli.mjs import` 转换。
2. `main.js` 是构建产物，改 `src/` 后不重新 build 就不会生效；也不要提交手改的 `main.js`。
3. 版本号要同时改 `manifest.json` 和 `package.json`（Obsidian 读 manifest）。
4. 无测试、无 lint；`npm run check` 是唯一门禁，`strict` + `noUncheckedIndexedAccess` 已开。
5. 仓库目前不是 git 仓库，`git` 命令会失败。
6. 日期一律按本地时区处理，不要引入 `toISOString()` 去格式化日期（CLI/模型里都是手写 pad）。
7. 删计划会 `adapter.remove` 文件；若删的是当前计划，回落到剩余第一份或 `.plan-board/plan.json`。
8. `esbuild.config.mjs` 顶部 banner 仍写着旧的 `obsidian_study_notes` 仓库地址，仅注释用途，不要据此找源码。
