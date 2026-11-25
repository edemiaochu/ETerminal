---
name: workbench-ui
description: 工作台布局、工具栏、路径胶囊、侧栏、命令面板与常用命令
type: topic
updated: 2026-11-25
related: [[glass-theming]], [[terminal-pty]], [[ai-reader]]
---

# 工作台 UI

## 当前实现

- 顶部 58px 单行工具栏：品牌左端、两组玻璃胶囊（会话 / 工具）、中间宽路径胶囊、窗口控制右端。
- 图标按钮统一 32×32，图标 18px；组内 2px、组间 10px；胶囊 41px/16px 圆角；控件均 no-drag。
- 标签栏为 40px 扁平条，没有整块玻璃；活动标签是主题渐变胶囊。
- 路径胶囊宽约 640px：弱化父级路径 + 强调最后一级目录 + Git 分支 + 复制图标；悬浮显示完整路径；点击复制；窗口窄时隐藏父级/分支/复制，保留目录名。
- 终端与 AI 面板直接铺满工作区，无外层玻璃卡、圆角、描边或阴影；二者之间只有一条竖分隔线。加载状态也无外框卡。
- 会话侧栏 188px，默认收起；打开后是平面栏（右侧分隔线），含会话列表、当前路径、分支、AI 入口、新建会话。
- 常用命令：工具栏闪电按钮打开 popover；localStorage CRUD；点击运行、corner 仅填入、编辑/删除；命令面板有“常用命令”分组；预置 `claude --dangerously-skip-permissions`，带危险标记且不自动执行。
- 主题面板：工具栏调色盘打开 8 套主题；设置面板也有主题 swatches；路径/终端/AI/状态栏同步表面色。
- 快捷键：Ctrl+Shift+T/W、Ctrl+Tab、Ctrl+1..9、Ctrl+Shift+A/F/B/P、Ctrl+,、Ctrl+=/-/0、F11。

## 关键文件

- `src/main.ts` — shell、快捷键、主题/命令 popover、命令面板、路径胶囊、演示模式
- `src/workbench.css` — 工具栏/路径/标签/侧栏/命令 popover/主题卡片
- `src/styles.css` — tokens、terminal、AI、通用 modal/toast
- `src/commands.ts` — 常用命令存储与 seed
- `src/ui/command-palette.ts` / `src/ui/settings-panel.ts` / `src/ui/theme-cards.ts`

## 约束与坑

- 拖拽区域上绝不能放覆盖整层的 pseudo-element；按钮及内部 SVG 必须 no-drag，否则 Electron 会吞点击。
- 终端/AI 面板已经去掉外层 glass 与 `lg-surface`；不要把卡片样式加回来，用户明确要求减少框。
- 路径胶囊是 CSS 半透明控件，不是 WebGL glass；tooltip 用 `:hover` / `:focus-visible`。
- 侧栏默认 must 是 hidden，避免启动瞬间闪开；applySettings 再按偏好恢复。
- 常用命令 seed 只写 localStorage，不自动运行；危险命令运行时不弹确认（用户主动点击）。

## 未决问题

- 路径胶囊/工具栏的完整键盘导航。
- 常用命令导入/导出、跨设备同步。
