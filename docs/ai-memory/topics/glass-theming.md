---
name: glass-theming
description: 8 套主题、终端表面色、WebGL 极光玻璃与性能限制
type: topic
updated: 2026-11-25
related: [[workbench-ui]]
---

# 玻璃与主题

## 当前实现

- 一个全屏 WebGL2 canvas 在 UI 后面，Pass 1 渲染极光环境到 mipmapped FBO，Pass 2 用圆角矩形 SDF + Snell 折射 + RGB 色散 + Fresnel + 指针高光绘制玻璃。
- 常驻玻璃已收敛到工具栏两组胶囊；终端/AI/侧栏/标签栏为平面。终端画布不透明，避免半透明 WebGL 残影。
- 极光背景是自维护 shader：极光带、宽色幕、点阵、星点、光轴、颗粒、主题色相/灰度由 CSS filter 调整。
- 8 套主题定义在 `src/themes.ts`，包括主题色 from/to、base、终端表面 `TERMINAL_SURFACES` 与 AI 表面。
- 终端底色：极光 #08060F、深海 #05121B、森林 #07130C、熔岩 #150B08、紫罗兰 #120A19、纯黑 #050505、黑灰 #151517、明亮 #FBFAF6；xterm theme 与 CSS `--term-bg` 同步。
- 主题切换：`applySettings` → data-theme、CSS 变量、glass.setTheme(immediate)、setParams、manager.updateSettings；终端底色/路径/状态/AI 一起变。
- 性能：玻璃默认 42fps（motion off 30、失焦 20），DPR 上限 1.75，总像素上限 360 万；隐藏 tab 不占 WebGL；最多同时 8 个 xterm WebGL 上下文。
- 动效开关：`setMotion(false)` 只冻结 `time`/`uTime`，仍逐帧重绘；没有完全停止 GPU。系统 prefers-reduced-motion 默认关闭。

## 关键文件

- `src/liquid-glass/renderer.ts` — 两 pass、形状 uniform、限帧/像素预算、refresh/setMotion
- `src/liquid-glass/shaders.ts` — 极光背景、玻璃折射/色散/Fresnel
- `src/liquid-glass/registry.ts` / `vanilla.ts` — DOM rect → glass shape、controller API
- `src/themes.ts` — 8 主题 + 终端/AI 表面色
- `src/terminal/theme.ts` — xterm 调色板、主题底色、光标/选区 accent

## 约束与坑

- 玻璃只绘制在 UI 后面；浮层用 CSS backdrop-filter，不能采样上层 DOM。
- 给玻璃表面加 CSS 背景/backdrop-filter 会破坏光学材质（fallback 除外）。
- 主题切换必须保持几何不变；只改 tokens/表面色/强调色。
- 改主题时 xterm 背景必须同步，两者不一致会露边。
- 全屏极光即使被平面内容遮住仍会渲染；性能模式可暂停 rAF。

## 未决问题

- 无交互时停帧的性能模式。
- 更细的主题表面调色（当前深色为手动精选的暗色）。
