---
name: current-state
description: ETerminal 当前完成度、已知问题与下一步
type: state
updated: 2026-11-25
---

# 当前状态

## 已完成

- 真实 PTY 终端：PowerShell 5.1 / PowerShell 7 / Git Bash / cmd / WSL profile；ConPTY 会话、中文、TUI 输入。
- 工作台 UI：58px 单行工具栏 + 两组玻璃胶囊、扁平标签栏、顶部宽路径胶囊、默认收起的会话侧栏、平面终端与 AI 面板。
- 8 套主题：极光/深海/森林/熔岩/紫罗兰/纯黑/黑灰/明亮；终端底色、路径胶囊、状态栏、AI 面板同步主题表面色。
- AI 阅读器：Claude Code 标记解析、工具调用摘要、Markdown、代码高亮、框线/ASCII/Markdown 表格转数据表、只读实时跟随。
- 常用命令：localStorage CRUD、点击运行/仅填入、编辑/删除、命令面板分组；预置 `claude --dangerously-skip-permissions`（不自动执行）。
- 设置面板：主题色板、壁纸、动效、玻璃参数、字体/字号/光标、侧栏开关、默认 Shell。
- 命令面板、搜索、右键菜单、标签重命名、退出/重启、路径与 Git 分支显示。
- 打包：electron-builder NSIS；原生 node-pty、PNG/ICO 与安装器图标；开发窗口图标已显式设置。

## 本次交付

- 全量代码、截图与项目记忆随本次交付提交。
- 真实中文输入法（系统候选框）仍需用户重启后进行人工回归；代码已加 focus/click/composition/rect 校正。

## 已知问题与限制

- 冷启动与内存高于原生终端；极光关闭不停止渲染循环，只是冻结 uTime 并降至 30/20fps。
- cmd/WSL 尚未实时同步 cwd；PowerShell/Git Bash 通过 OSC 7 正常。
- AI 解析为启发式；alternate-screen 或复杂 TUI 可能不完整。
- 安装包未做代码签名；Windows 可能缓存旧任务栏图标，需要取消固定/重装。
- 常用命令面板默认聚焦第一条命令，行会显示 focus-within 强调边框。

## 下一步

- [ ] 加“性能模式”：无交互时暂停玻璃 rAF，真正停止 GPU 绘制。
- [ ] 接入 cmd/WSL 的实时工作目录同步。
- [ ] 在真实 Windows IME（微软拼音）下回归候选框位置，若仍有偏移再按候选层/预编辑层区分修正。
- [ ] 进一步把工具栏/路径胶囊的键盘可达性做完整（快捷键或焦点顺序）。
- [ ] 为常用命令增加导入/导出或同步（localStorage 目前仅本机）。

## 最近变化

- 2026-11-25 — 从空仓库完成 ETerminal 全量实现、工作台重构、主题/路径/IME/表格/常用命令和打包；详见 [history/2026-11-25.md](history/2026-11-25.md)。
