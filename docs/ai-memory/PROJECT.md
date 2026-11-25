---
name: project-overview
description: ETerminal 的定位、技术栈、运行方式、架构与已知限制
type: project
updated: 2026-11-25
---

# ETerminal

## 是什么

一个把终端做成桌面工作台的 Windows 应用：真实 ConPTY 终端、WebGL2 光学液态玻璃工具栏、8 套主题、可收起会话侧栏，以及把 Claude Code 等 AI CLI 的终端输出转成文档的 AI 阅读器。

## 技术栈与命令

- 运行时：Electron 45（Chromium + Node 22）+ 原生 ConPTY
- 渲染：xterm.js 6 + WebGL addon；顶层 UI 为 vanilla TypeScript，无 React 运行时
- 玻璃：自维护的 `liquid-glass-optics` shader core（Snell、RGB 色散、Fresnel、极光背景）
- 解析：自研终端缓冲区解析器；marked + highlight.js + DOMPurify 渲染 AI Markdown
- 原生 PTY：`@lydell/node-pty`（N-API 预编译，Electron 可直接加载）
- 运行：`npm run dev`（Vite 5273 + Electron）、`npm run build && npm start`
- 测试：`npm test`（Node 22 strip-types，解析器 12/12）
- 打包：`npm run dist` → `release/ETerminal-0.1.0-x64.exe`（NSIS，未签名）
- 图标：`npm run icon`（Electron 离屏渲染生成 PNG/ICO）

## 目录地图

- `electron/main.cjs` — 窗口、IPC、PTY 生命周期、shell 检测、OSC 7 integration、打包/截图
- `electron/preload.cjs` — contextBridge 最小 API
- `src/main.ts` — 应用编排、工作台接线、快捷键、AI 轮询、命令面板、路径胶囊
- `src/terminal/manager.ts` — xterm 实例、标签、PTY 输出、cwd/分支、IME 锚点
- `src/terminal/theme.ts` — xterm ANSI 调色板与终端表面
- `src/ai/parser.ts` — 从终端缓冲区提取 Claude Code 对话、工具调用、表格、代码
- `src/ai/markdown.ts` — Markdown 安全渲染、代码高亮、表格/链接增强
- `src/commands.ts` — 常用命令 localStorage 存储与预置命令
- `src/themes.ts` — 8 套主题定义 + 终端/AI 表面色
- `src/liquid-glass/` — WebGL2 玻璃 renderer/registry/shaders/vanilla API
- `src/workbench.css` — 工具栏、标签栏、路径胶囊、侧栏、浮层
- `src/styles.css` — 设计 tokens、AI 阅读器、终端、通用浮层
- `docs/` — README 预览图
- `tests/parser.test.mts` — 终端 AI 解析与表格单测

## 架构与数据流

1. `main` 进程按 profile 启动 `node-pty`（Windows 使用 ConPTY），shell integration 向 profile 注入 OSC 7。
2. PTY 数据经 IPC 到 renderer，`TerminalManager.handleData` 直接写入 xterm；URL/OSC 7 解析由 xterm parser 完成。
3. 键盘/IME → xterm textarea → `onData` → IPC → PTY。Windows IME 锚点由 manager 私有 API + 实际 rect 校正。
4. 单 canvas 玻璃在 UI 后面；只有工具栏两组胶囊是常驻玻璃，终端/AI 面板为平面。
5. AI Reader 定时读取当前标签的 xterm buffer，解析为对话/表格/代码，再渲染成 Markdown；只读，不影响输入。
6. 设置、常用命令、主题表面色均保存在 renderer 的 localStorage；窗口 bounds 在 main 的 userData JSON。

## 约定与坑

- **终端画布必须不透明**：xterm `allowTransparency: false`；半透明 WebGL 背景会造成快速输入/删除残影。
- **不要给标题栏/shell 区域加覆盖整层的 `::after` 拖拽层**：Electron 会把按钮点击吞成窗口拖动。按钮和子节点需 `no-drag`。
- PTY 输出不要额外做 rAF 合批，直接写入 xterm 写队列，避免输入回显延迟。
- Windows IME 候选框依赖隐藏 textarea 的屏幕锚点；组合输入开始前要 `scrollToBottom` 并按真实 rect 重算位置。
- 开发端口固定 5273，避免与其他 Vite 项目冲突；截图模式使用独立临时 userData，避免碰到正在运行的实例。
- 主题切换不能改变布局几何；深色主题的终端底色保持足够深以保证对比度。
- 常用命令的预置 `claude --dangerously-skip-permissions` 只保存，不自动执行，并带危险标记。

## 关键入口

- `src/main.ts` — `applySettings`、`runDemo`、`openThemePopover`、`openSnippetsPopover`
- `src/terminal/manager.ts` — `createTab`、`syncImeAnchor`、`pinImeAnchorToCursor`
- `src/ai/parser.ts` — `parseTerminalOutput`、`extractBoxTables`
- `src/liquid-glass/renderer.ts` — 两 pass 玻璃、帧率/像素预算、`setMotion`
- `electron/main.cjs` — `buildProfiles`、`powershellBootstrap`、`writeBashIntegration`

## 已知限制

- 主要在 Windows 11 验证；macOS/Linux shell 检测未实现。
- cmd/WSL 的实时 cwd 同步未接入（PowerShell / Git Bash 已接入）。
- AI 解析是启发式；alternate-screen TUI、极端 ANSI 重绘可能读不到完整历史。
- IME 锚点修复依赖 xterm 私有 API（有 try/catch）；仍需真实用户输入法回归。
- 极光“动效关闭”只是冻结时间，渲染循环仍运行；尚无完全停帧的性能模式。
- 安装包未签名，Windows SmartScreen 可能提示。
