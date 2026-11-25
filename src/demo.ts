const ESC = "\x1b";
const reset = `${ESC}[0m`;
const dim = `${ESC}[38;2;126;141;162m`;
const text = `${ESC}[38;2;216;226;240m`;
const mint = `${ESC}[38;2;124;240;215m`;
const amber = `${ESC}[38;2;242;178;121m`;
const violet = `${ESC}[38;2;184;160;255m`;
const cyan = `${ESC}[38;2;121;232;247m`;
const code = `${ESC}[38;2;166;206;190m`;
const bold = `${ESC}[1m`;

function fileUri(winPath: string): string {
  const normalized = winPath.replace(/\\/gu, "/");
  return normalized.startsWith("/") ? `file://${normalized}` : `file:///${normalized}`;
}

export function demoTranscript(appCwd: string): string {
  const project = appCwd.replace(/\\/gu, "/").split("/").pop() || "aurora-terminal";
  const lines = [
    `${ESC}[2J${ESC}[3J${ESC}[H`,
    `${ESC}]0;Claude Code · ${project}\x07`,
    `${ESC}]7;${fileUri(appCwd)}\x07`,
    "",
    `${dim}  ETerminal  ·  GPU terminal  ·  optical glass shell${reset}`,
    "",
    `${cyan}❯${reset} ${text}给这个终端加一层真的会折射的液态玻璃${reset}`,
    "",
    `${amber}⏺${reset} ${text}我先检查现有的渲染管线，再把终端放到玻璃之上。${reset}`,
    `${amber}⏺${reset} ${dim}Read(src/liquid-glass/renderer.ts)${reset}`,
    `${dim}  ⎿  Read 186 lines (ctrl+r to expand)${reset}`,
    "",
    `${amber}⏺${reset} ${text}方案确认：保持终端文字锐利，只让背景参与光学折射。${reset}`,
    "",
    `${text}  ${bold}实现要点${reset}`,
    "",
    `${mint}  •${reset} ${text}全屏 WebGL2 canvas 负责 Snell 折射、色散与 Fresnel${reset}`,
    `${violet}  •${reset} ${text}终端用 GPU 渲染，玻璃外壳限制在 42fps${reset}`,
    `${amber}  •${reset} ${text}AI 阅读器把 Claude Code 的回复重排成 Markdown${reset}`,
    "",
    `${text}  核心预算：${reset}`,
    "",
    `${dim}  ┌──────────────┬──────────┐${reset}`,
    `${text}  │ 模块         │ 预算     │${reset}`,
    `${dim}  ├──────────────┼──────────┤${reset}`,
    `${text}  │ WebGL 折射   │ 42 fps   │${reset}`,
    `${text}  │ AI 阅读器    │ 900 ms   │${reset}`,
    `${text}  │ 终端输入     │ < 1 帧   │${reset}`,
    `${dim}  └──────────────┴──────────┘${reset}`,
    "",
    `${text}  核心调用只有一行：${reset}`,
    "",
    `${code}  const glass = createLiquidGlass({${reset}`,
    `${code}    canvas, params: PRESETS.Liquid, theme: 'dark'${reset}`,
    `${code}  });${reset}`,
    "",
    `${text}  完成后边框会弯折背后的极光，而文字仍然保持清晰。${reset}`,
    "",
    `${dim}  ✻ Worked for 8s${reset}`,
    "",
    `${dim}────────────────────────────────────────────${reset}`,
    `${cyan}❯${reset} `,
    `${dim}────────────────────────────────────────────${reset}`,
    `${dim}  ? for shortcuts${reset}`,
  ];
  return lines.join("\r\n");
}
