# Oh My Plan Board

Obsidian 侧边栏计划清单。按天展示任务，勾选完成，显示每天进度与总进度；数据是一份普通 JSON，插件和命令行工具共用。

## 数据文件

默认路径：`.plan-board/plan.json`（旧版单计划文件，仍然兼容）。新建计划会放到 `.plan-board/plans/<计划名>.json`，侧边栏顶部的下拉框可以切换当前计划；CLI 用 `--plan` 指定要操作哪一份。

```json
{
  "version": 1,
  "title": "20 天高数冲刺",
  "subtitle": "极限 · 中值 · 积分 · 级数",
  "startDate": "2026-10-25",
  "days": [
    {
      "id": "d-...",
      "label": "Day 1",
      "date": "2026-10-25",
      "title": "极限（一）· 等价无穷小体系",
      "items": [
        { "id": "i-...", "text": "利用等价无穷小", "kind": "required", "done": false }
      ]
    }
  ]
}
```

`kind` 取 `required`（必做）或 `optional`（学有余力）。`id` 缺失时会自动补，建议保留以便命令行精确定位。`date` 决定这一天落在日历的哪一格；缺失时按 `startDate` 顺延补齐。

## 命令行

```bash
# 进度总览（默认当前计划）
node cli.mjs --vault ~/obsidian_study_notes summary

# 指定另一份计划
node cli.mjs --vault ~/obsidian_study_notes \
  --plan .plan-board/plans/英语六级学习计划.json summary

# 某天明细
node cli.mjs --vault ~/obsidian_study_notes show --day 1

# 勾选 / 取消
node cli.mjs --vault ~/obsidian_study_notes toggle --day 1 --item 3
node cli.mjs --vault ~/obsidian_study_notes check   --day 1 --item 3
node cli.mjs --vault ~/obsidian_study_notes uncheck --day 1 --item 3

# 删除任务 / 删除某一天
node cli.mjs --vault ~/obsidian_study_notes delete-item --day 1 --item 3
node cli.mjs --vault ~/obsidian_study_notes delete-day  --day 3

# 加任务、加一天
node cli.mjs --vault ~/obsidian_study_notes add-item --day 1 --text "做 3 道极限题"
node cli.mjs --vault ~/obsidian_study_notes add-item --day 1 --text "整理错题" --kind optional
node cli.mjs --vault ~/obsidian_study_notes add-day  --label "Day 21" --title "回顾"

# 整份导入（结构见上；也接受 required / optional 简写数组）
node cli.mjs --vault ~/obsidian_study_notes import --file seed-20day.json
```

`--day` 与 `--item` 都接受 `id`、从 1 开始的序号，或 `Day 1` 这样的标签。

## 插件内操作

- 面板只有月历：周一开头，可上月 / 下月 / 回到今天；有计划的日期用浅色底和圆环进度标记，悬停可看标题。
- 点击日期，下方展开当天所有计划的清单，按计划分组；未点日期时只显示提示；空日期可分别添加到某份计划。
- 顶部进度卡集中展示总进度环、今日进度环，以及每份计划的迷你进度条和完成数。
- 日期格状态：完成显示绿色圆环和绿色对号；今天未完成显示淡蓝底和蓝色圆环；过去未完成显示红色圆环和红点；未来有任务先用一个小圆点，开始有进度后换成圆环。
- 顶部下拉框筛选计划，默认「全部计划」；「新建计划」填写名称，开始日期和结束日期都从弹出的月历里点选，生成这段日期的空清单。选中某份计划后会出现「删除计划」，连点两次确认。
- 勾选仍是方形复选框：完成后蓝底白勾，文字变淡并加删除线。
- 添加任务是一条下划线输入行，回车或点右侧「添加」；不再用带边框的输入框。
- 双击计划标题重命名；每天标题栏悬停出现「改」「删」，删除需连点两次确认。
- 外部改了 JSON（命令行或其他工具）后，插件会在文件变动时自动重载。

## 供其他工具调用

插件加载后会在页面上暴露：

```js
window.planBoard.load()        // 读取计划
window.planBoard.save(plan)    // 覆盖写入并刷新面板
window.planBoard.refresh()     // 重新读取并刷新
window.planBoard.open()        // 打开侧边栏面板
window.planBoard.path()        // 当前计划文件路径
```

命令行是首选入口；上面的对象主要给 Templater、Advanced URI 或开发者控制台用。

## 开发

```bash
npm install
npm run build          # tsc 类型检查 + esbuild 打包
./install-to-vault.sh  # 复制到 .obsidian/plugins/oh-my-plan-board
```

安装后需要在 Obsidian 的「第三方插件」里启用 Oh My Plan Board（或重启 Obsidian）。插件 id 为 `oh-my-plan-board`。

## 设计约定

- 颜色克制：accent 只用于进度、选中和主要操作，绿色只表示完成，红色只表示逾期，其余一律用主题的文本色和中性底色；浅色/深色自动适配。
- 不使用 emoji、彩色图标或装饰性符号；勾选对号、折叠箭头是 CSS/SVG 绘制的几何形状。
- 交互特效：中性悬停底色、按下位移、焦点描边、对号描边动画、进度环描边与进度条宽度缓动；`prefers-reduced-motion` 下关闭动画。
- 颜色全部走 Obsidian 变量（`--interactive-accent`、`--text-normal`、`--background-primary` 等），换主题或换强调色会跟着变。

## 来源说明

工程骨架（manifest、esbuild、tsconfig）参考 `profesr-chaos/obsidian-checklist-progress-bar`（0BSD）；侧边栏视图的注册与唤起方式参考 `delashum/obsidian-checklist-plugin`（MIT）；日历视图的 42 格月历布局参考 `liamcain/obsidian-calendar-ui`（MIT）的 `getMonth`，用原生 Date 重写，未引入 Svelte 或 moment。当前实现为独立重写，未包含这些项目的业务代码。
