---
name: terminal-pty
description: 真实 PTY 终端、shell 检测、cwd/分支、加载与 IME 输入链路
type: topic
updated: 2026-11-25
related: [[workbench-ui]], [[glass-theming]]
---

# 终端与 PTY

## 当前实现

- `@lydell/node-pty` 在 Electron main 进程启动 ConPTY；renderer 只通过 preload IPC 交互。
- Profile 检测：Windows PowerShell 5.1、`pwsh.exe`、Git for Windows `bash.exe`、cmd、wsl。
- PowerShell：`-EncodedCommand` 注入 bootstrap；保存原 `prompt` 后包装，每次 prompt 发 OSC 7，输出 API 用 UTF-8。
- Git Bash：生成的 `bash-rc.sh`（userData）先加载 `/etc/profile` + 用户 profile，再注入 `PROMPT_COMMAND` 发 OSC 7；spawn 参数为 `--rcfile <file> -i`（长选项必须在前）。
- 新标签默认继承当前 cwd（可兼容的 Windows/POSIX 路径）；`git branch` 由 main 读取 `.git/HEAD`，不跑 subprocess。
- PTY 数据在 `handleData` 中直接 `term.write`，不再额外 rAF 合批；`clientId` 在 spawn 前就确定，避免首个 prompt 丢失。
- 加载层在首条数据到达时隐藏；spawn 成功只设置 fallback 2.4s，避免 loading 永远不消失或过早消失。
- IME：focus/pointerdown/compositionstart/update/fit 时调用 xterm 私有 `_syncTextArea` / `updateCompositionElements`，并用 `.xterm-screen` 与 `.xterm-helpers` 真实 rect 重新钉住 textarea 和 `.composition-view`；compositionstart 先滚到底部。
- 标签状态：starting/running/exited/error；退出显示浮层，可重启或新建；关闭最后一个标签会自动建默认标签。

## 关键文件

- `electron/main.cjs` — shell 检测、spawn、integration、IPC、PTY 生命周期
- `src/terminal/manager.ts` — xterm、标签、cwd、输出、退出、IME 锚点
- `src/terminal/theme.ts` — xterm 主题/字体/光标
- `src/demo.ts` — 文档截图用的 Claude Code 风格演示缓冲区

## 约束与坑

- 终端画布必须 `allowTransparency: false`；半透明背景会在快速编辑时残留旧字形/光标。
- `handleData` 要无条件隐藏 loading，并用 fallback，否则会出现“数据已到但 loading 常驻”的竞态。
- IME 私有 API 有 try/catch；修改 xterm 版本后要复核 `_syncTextArea`、`updateCompositionElements` 是否存在。
- Git Bash 的 `--rcfile` 必须放在 `-i` 前，否则 Bash 报 invalid option。
- cmd/WSL 暂无实时 OSC 7；不要假设 cwd 会自动更新。

## 未决问题

- 真实微软拼音候选框仍待用户人工回归。
- cmd/WSL cwd 同步；性能模式下的输出/滚动压力测试。
