---
name: ai-reader
description: 从终端缓冲区提取 Claude Code 输出并渲染成可读文档
type: topic
updated: 2026-11-25
related: [[workbench-ui]], [[terminal-pty]]
---

# AI 阅读器

## 当前实现

- 定时读取 active tab 的 xterm scrollback+viewport，拼成逻辑行（使用 xterm `isWrapped` 还原软换行）。
- 识别 `❯` 用户输入、`⏺/●` 助手标记、工具调用（Read/Bash/Edit…），过滤 spinner、token 状态、输入框、分隔线、工具结果 `⎿`。
- 恢复 Markdown：标题推断、项目符号、软换行合并、代码块/语言检测、Unicode 自定义术语转义。
- 表格：
  - Unicode 框线表（`┌ ┬ ┐ / │`）、ASCII `+---+` 表由 `extractBoxTables` 转成 Markdown 管道表；
  - 原生 Markdown 管道表保持在 `assistantTextToMarkdown` 中逐行输出，不再被段落合并；
  - 前端用平面表格样式（表头 tint、细线、斑马纹、hover），不套外层卡片。
- 渲染：marked + highlight.js + DOMPurify；代码块带复制；链接仅允许 http(s)/mailto 经主进程打开。
- 面板：点击工具栏 sparkles 或 `Ctrl+Shift+A`；打开后每 900ms 刷新；内容签名不变不重建 DOM；空闲跳过解析。
- 选择/整个屏幕模式：空状态可“渲染整个屏幕”；右键“美化选中内容”会 pin 住选区。
- 自动检测：面板关闭时扫描最后 ~220 行；`aiNotified` 控制 toast 只提示一次。

## 关键文件

- `src/ai/parser.ts` — 清理、分段、表格、Markdown 重建、working 状态
- `src/ai/markdown.ts` — marked/DOMPurify/hljs、代码卡/表格/链接增强
- `src/ui/ai-reader.ts` — 面板、布局、跟随/复制/刷新/选区模式
- `tests/parser.test.mts` — 12 个解析与表格测试

## 约束与坑

- 解析目标是 Claude Code 的 Ink 文本格式，不是通用 ANSI 还原器；颜色/粗体信息在 xterm buffer 中已丢失。
- alternate screen 或高度重绘的 TUI 可能读不到完整历史。
- 表格提取必须在噪声过滤之前进行，否则边框行会被当成分隔线删掉。
- Markdown 表格行不能参与普通段落合并，否则会变成一行。
- AI Reader 是只读镜像，绝不向 PTY 写入。

## 未决问题

- 真实 Claude Code 不同版本的 UI 行格式需继续回归。
- 富文本/ANSI 样式还原、Mermaid/数学公式不渲染。
