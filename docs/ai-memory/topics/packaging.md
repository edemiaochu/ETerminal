---
name: packaging
description: 构建、打包、原生 node-pty、图标、开发端口与截图隔离
type: topic
updated: 2026-11-25
related: [[terminal-pty]]
---

# 打包与运行环境

## 当前实现

- `npm run dev`：Vite 5273 + `electron . --dev`（concurrently/wait-on）。
- `npm run build`：`tsc --noEmit` + Vite 构建到 `dist/renderer`。
- `npm start`：未打包时加载 dist 文件（无 `--dev`）。
- `npm run dist`：electron-builder NSIS x64；产物 `release/ETerminal-0.1.0-x64.exe`（约 119MB，未签名）。
- 原生依赖：`@lydell/node-pty` 预编译 N-API，`npmRebuild: false`，`asarUnpack` 覆盖 `node_modules/@lydell/**`。
- 图标：`scripts/gen-icon.cjs` 用 Electron 离屏渲染 512 PNG + 7 尺寸 PNG-in-ICO；build/icon.ico/png 进仓库；`win.icon`、NSIS installer/uninstaller/header、`BrowserWindow.icon`、打包 extraResources 全部配置。
- 窗口状态保存在 userData JSON；PTY 捕获模式使用独立临时 userData（`eterminal-capture-<pid>`），不干扰正在运行的实例。
- 开发窗口图标：未打包时使用 `build/icon.ico`；打包时使用 `resources/icon.ico`。

## 关键文件

- `package.json` — scripts、electron-builder 配置、extraResources、native 依赖
- `electron/main.cjs` — `IS_DEV`、devUrl 5273、窗口 icon、capture 隔离
- `vite.config.mjs` — root src、base ./、port 5273
- `scripts/gen-icon.cjs` — 应用图标生成
- `build/icon.ico` / `build/icon.png` — 应用/安装包图标

## 约束与坑

- 必须用镜像下载 Electron 时设置 `ELECTRON_MIRROR`（README 有）。
- `@lydell/node-pty` 不要被 electron-builder rebuild；保留 `npmRebuild:false`。
- 开发端口与主进程 loadURL 必须同时是 5273；此前 5173 被其他项目占用曾导致 dev 加载错误。
- 打包图标、安装器图标、BrowserWindow 图标是三处独立配置；只改一处会出现“exe 图标变了但任务栏还是 Electron”。
- 截图/演示 env 只在 CAPTURE_PATH 下使用独立 userData；不要删除用户正在使用的 Local Storage。
- 安装包未签名，SmartScreen 可能提示；Windows 可能缓存旧任务栏图标，需取消固定/重装。

## 未决问题

- 代码签名、自动更新、CI 构建。
- macOS/Linux 打包与 shell 支持。
