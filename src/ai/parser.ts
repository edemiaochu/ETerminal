/**
 * Turns a slice of terminal buffer text into a small, readable chat transcript.
 *
 * Claude Code (and similar Ink/TUI based agents) draw their transcript as text
 * plus box-drawing chrome. We keep the prose, drop the chrome, recognise tool
 * calls, reconstruct wrapped lines and lightly rebuild markdown so the result
 * can be rendered as a document instead of a wall of monospace.
 *
 * This module is intentionally framework-free and has no DOM dependencies.
 */

export interface TerminalLineInput {
  text: string;
  /** True when xterm tells us this visual line is a soft-wrap of the previous one. */
  wrapped?: boolean;
}

export type RawLine = string | TerminalLineInput;

export type TurnRole = "user" | "assistant";

export interface ChatTurn {
  role: TurnRole;
  /** Cleaned, human-readable text (not markdown). */
  text: string;
  /** Lightweight markdown rebuilt from the cleaned text. */
  markdown: string;
  tools: string[];
}

export interface ParseResult {
  detected: boolean;
  working: boolean;
  turns: ChatTurn[];
  latest: ChatTurn | null;
  toolCount: number;
  sourceLines: number;
}

const ASSISTANT_MARKER = /^[⏺●]\s?(.*)$/u;
const USER_MARKER = /^[❯]\s?(.*)$/u;
const TOOL_RESULT = /^\s*⎿/u;
const BOX_ONLY =
  /^\s*[─━═╭╮╰╯┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬▔▁▂▃▄▅▆▇█▏▎▍▌▋▊▉=~_\-]{4,}\s*$/u;
const INPUT_BOX_EDGE = /^\s*[╭╰][─━═]{2,}/u;
const INPUT_BOX_PROMPT = /^\s*[│║]\s*[❯>]\s*/u;
const SPINNER_ONLY =
  /^\s*[✢✳✶✻✽·]\s+[A-Za-z][\w'’-]*(?:\s+[A-Za-z][\w'’-]*){0,3}(?:…|\.\.\.)(?:\s*\([^)]*\))?\s*$/u;
const TOKEN_LINE =
  /^\s*(?:[●○✻✽✢✳✶]\s*)?(?:\d+(?:\.\d+)?[kKmM]?\s+tokens?|ctx\s*[:·]|context\s+(?:left|usage)|[0-9]{1,3}%\s+(?:context|ctx))\b/iu;

const KNOWN_TOOLS = new Set([
  "Agent",
  "AskUserQuestion",
  "Bash",
  "BashOutput",
  "Create",
  "Delete",
  "Edit",
  "ExitPlanMode",
  "Glob",
  "Grep",
  "KillShell",
  "LS",
  "List",
  "Move",
  "MultiEdit",
  "NotebookEdit",
  "NotebookRead",
  "Read",
  "Run",
  "Search",
  "Skill",
  "SlashCommand",
  "Task",
  "TodoWrite",
  "Update",
  "View",
  "WebFetch",
  "WebSearch",
  "Write",
]);

const FOOTER_PATTERNS = [
  /^\s*\?\s+for shortcuts\b/iu,
  /^\s*(?:esc|ctrl\+c|ctrl\+b|shift\+tab)\b.{0,100}\b(?:interrupt|cycle|background|expand|stop|edit|toggle)\b/iu,
  /^\s*⏵⏵/u,
  /^\s*bypass(?:ing)? permissions\b/iu,
  /^\s*accept edits on\b/iu,
  /^\s*auto-accept edits?\b/iu,
  /^\s*(?:claude code v[\d.]+|welcome to claude code)\b/iu,
  /^\s*(?:tips for getting started|run \/init|run \/help)\b/iu,
  /^\s*press (?:ctrl|up|down)\b.{0,80}$/iu,
  /^\s*[⎿]/u,
  /^\s*[✻✽✢✳✶]\s+(?:Worked|Thought|Ran|Took|Finished|Elapsed)\b.*$/iu,
];

export function isAiTranscript(raw: string): boolean {
  return (
    /[⏺]/u.test(raw) ||
    /(?:^|\n)\s*[✻✽✢✳✶]\s+\w+/u.test(raw) ||
    /\bClaude Code\b/u.test(raw) ||
    /esc to interrupt/iu.test(raw)
  );
}

function joinWrapped(previous: string, next: string): string {
  if (!previous || !next) return previous + next;
  const a = previous[previous.length - 1];
  const b = next[0];
  if (/\s/u.test(a) || /\s/u.test(b)) return previous + next;
  if (isCjk(a) || isCjk(b)) return previous + next;
  if (/^[.,;:!?%)\]}>，。；：！？、]/u.test(next)) return previous + next;
  if (/[([{<（【《]$/u.test(previous)) return previous + next;
  if (/[A-Za-z0-9]$/u.test(previous) && /^[A-Za-z0-9]/u.test(next)) {
    return `${previous} ${next}`;
  }
  return previous + next;
}

function normalizeInput(input: RawLine[]): string[] {
  const logical: string[] = [];
  for (const entry of input) {
    const text = typeof entry === "string" ? entry : entry.text;
    const wrapped = typeof entry === "string" ? false : Boolean(entry.wrapped);
    const clean = text.replace(/\r$/u, "").replace(/\s+$/u, "");
    if (wrapped && logical.length > 0) {
      logical[logical.length - 1] = joinWrapped(logical[logical.length - 1], clean);
    } else {
      logical.push(clean);
    }
  }
  return logical;
}

function isNoiseLine(line: string): boolean {
  if (BOX_ONLY.test(line)) return true;
  if (INPUT_BOX_EDGE.test(line)) return true;
  if (INPUT_BOX_PROMPT.test(line)) return true;
  if (TOKEN_LINE.test(line)) return true;
  if (/^\s*[│║]\s*$/u.test(line)) return true;
  if (/^\s*[╭╮╰╯┌┐└┘]\s*$/u.test(line)) return true;
  if (FOOTER_PATTERNS.some((pattern) => pattern.test(line))) return true;
  if (/^\s*(?:Bypassing|Permissions|tokens?)\s*$/iu.test(line)) return true;
  return false;
}

function cleanLines(logical: string[]): string[] {
  const out: string[] = [];
  for (const line of logical) {
    if (isNoiseLine(line)) {
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (SPINNER_ONLY.test(line)) {
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (line.trim() === "" && (out.length === 0 || out[out.length - 1] === "")) continue;
    if (/^\s*[│║]\s*[─━═]+\s*[│║]?\s*$/u.test(line)) continue;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}

function detectTool(content: string): { name: string; args: string } | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  const call = /^([A-Z][A-Za-z0-9_]{1,32})\s*\((.*)\)\s*(?:\([^)]*\))?$/u.exec(trimmed);
  if (call && (KNOWN_TOOLS.has(call[1]) || call[2].length > 0)) {
    return { name: call[1], args: call[2] };
  }
  const bare = /^([A-Z][A-Za-z0-9_]{1,32})\s*[·:]\s*(.*)$/u.exec(trimmed);
  if (bare && KNOWN_TOOLS.has(bare[1])) {
    return { name: bare[1], args: bare[2] };
  }
  return null;
}

function isCjk(char: string | undefined): boolean {
  if (!char) return false;
  return /[⺀-鿿豈-﫿＀-￯぀-ヿ]/u.test(char);
}

function joinProse(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  if (/[（【⺀-鿿]$/u.test(left) || /^[）】⺀-鿿]/u.test(right)) {
    return left + right;
  }
  if (/[-–—/]$/u.test(left)) return left + right;
  return `${left} ${right}`;
}

function stripMarker(text: string): string {
  return text.replace(/^[⏺●]\s?/u, "").replace(/\s+$/u, "");
}

function dedentAssistant(lines: string[]): string[] {
  const continuation = lines.slice(1).filter((line) => line.trim() !== "");
  const indents = continuation
    .map((line) => {
      const match = /^[ \t]*/u.exec(line);
      if (!match) return 0;
      return match[0].replace(/\t/gu, "  ").length;
    })
    .filter((indent) => indent > 0);
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0;
  const removal = Math.min(minIndent, 8);

  return lines.map((line, index) => {
    if (index === 0) return line.replace(/^\s+/u, "");
    let removed = 0;
    let cursor = 0;
    while (cursor < line.length && removed < removal && (line[cursor] === " " || line[cursor] === "\t")) {
      removed += line[cursor] === "\t" ? 2 : 1;
      cursor += 1;
    }
    return line.slice(cursor).replace(/\s+$/u, "");
  });
}

function convertBullets(lines: string[]): string[] {
  return lines.map((line) => {
    const match = /^([ \t]*)(?:[•·▪◦‣])\s+(.*)$/u.exec(line);
    if (!match) return line;
    const spaces = match[1].replace(/\t/gu, "  ").length;
    const level = Math.min(4, Math.floor(spaces / 2));
    return `${"  ".repeat(level)}- ${match[2]}`;
  });
}

function trimAssistantText(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start += 1;
  while (end > start && lines[end - 1].trim() === "") end -= 1;
  return lines.slice(start, end);
}

/* ------------------------------------------------------------------ */
/* Markdown reconstruction                                             */
/* ------------------------------------------------------------------ */

const LANGUAGE_TAGS = new Set([
  "bash",
  "sh",
  "shell",
  "zsh",
  "powershell",
  "ps1",
  "pwsh",
  "cmd",
  "bat",
  "js",
  "jsx",
  "javascript",
  "ts",
  "tsx",
  "typescript",
  "json",
  "jsonc",
  "python",
  "py",
  "html",
  "xml",
  "css",
  "scss",
  "sql",
  "go",
  "golang",
  "rust",
  "rs",
  "java",
  "c",
  "cpp",
  "c++",
  "csharp",
  "cs",
  "yaml",
  "yml",
  "toml",
  "diff",
  "patch",
  "markdown",
  "md",
  "text",
  "txt",
  "log",
  "ini",
  "dockerfile",
  "docker",
  "kotlin",
  "swift",
  "ruby",
  "php",
]);

const COMMAND_START =
  /^\s*(?:\$|>|PS>|npm|pnpm|yarn|bun|git|cd|ls|dir|cat|curl|wget|docker|docker-compose|kubectl|helm|python|python3|node|deno|cargo|rustc|go|dotnet|powershell|pwsh|bash|sh|chmod|chown|mkdir|rmdir|rm|cp|mv|touch|echo|export|source|sudo|apt|apt-get|brew|pip|pip3|uv|wsl|winget|choco|npx|tar|zip|unzip|ssh|scp|make|cmake|gradle|mvn)\b/u;

const CODE_KEYWORD =
  /^\s*(?:const|let|var|function|class|interface|type|enum|import|export|from|default|extends|implements|def|async|await|return|yield|if|elif|else|for|while|do|try|catch|except|finally|raise|throw|new|public|private|protected|static|readonly|void|int|float|double|string|bool|package|func|struct|impl|trait|use|mod|match|using|namespace|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|FROM|WHERE|JOIN|GROUP|ORDER|LIMIT|WITH|BEGIN|END|log|print|console|printf|fmt|cout|std)\b/u;

export function detectCodeLanguage(code: string): string {
  const sample = code.slice(0, 4000);
  if (/^\s*(?:\$ |PS>|npm |pnpm |yarn |git |cd |ls |cat |curl |docker |kubectl |python |node |cargo )/mu.test(sample)) {
    return "bash";
  }
  if (/<[a-zA-Z][^>]*>|<\/[a-zA-Z][^>]*>/u.test(sample)) {
    return "xml";
  }
  if (/^\s*[{[]/u.test(sample) && /"[^"]+"\s*:/u.test(sample)) return "json";
  if (/\b(?:def|class)\s+\w+.*:|^\s*(?:from\s+\w+\s+import|import\s+\w+)/mu.test(sample)) return "python";
  if (/\b(?:interface|type)\s+\w+|:\s*(?:string|number|boolean)\b|=>/u.test(sample) && /\b(?:const|let|function|import|export)\b/u.test(sample)) {
    return "typescript";
  }
  if (/\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE TABLE)\b/iu.test(sample)) return "sql";
  if (/\bfunc\s+\w+\s*\(|^\s*package\s+\w+/mu.test(sample)) return "go";
  if (/\bfn\s+\w+\s*\(|^\s*use\s+\w+::/mu.test(sample)) return "rust";
  if (/\b(?:const|let|var|function)\b/u.test(sample) && /[;{}]/u.test(sample)) return "javascript";
  if (/^\s*[\w-]+\s*:\s*\S+$/mu.test(sample) && !/[;{}]/u.test(sample)) return "yaml";
  if (/^\s*[.#][\w-]+\s*\{/mu.test(sample)) return "css";
  return "text";
}

function isListLine(line: string): boolean {
  return /^\s*(?:[-*+•·▪◦‣]|\d+\.)\s+\S/u.test(line);
}

function isExplicitHeading(line: string): boolean {
  return /^\s*#{1,6}\s+\S/u.test(line);
}

function isFence(line: string): boolean {
  return /^\s*(```+|~~~+)/u.test(line);
}

function isQuote(line: string): boolean {
  return /^\s*>\s+\S/u.test(line);
}

function codeScore(line: string): number {
  const trimmed = line.trim();
  if (!trimmed) return 0;
  let score = 0;
  const indentMatch = /^[ \t]*/u.exec(line);
  const indent = indentMatch ? indentMatch[0].replace(/\t/gu, "  ").length : 0;

  if (indent >= 2) score += 1;
  if (indent >= 4) score += 2;
  if (/[{};]/u.test(line)) score += 1;
  if (/=>|\(\)|\([^)]*\)\s*[;{]|==|!=|:=|\|\||&&|\+\+|--/u.test(line)) score += 2;
  if (/^\s*(?:\/\/|\/\*|\*|#(?!\s*\w+\s*$)|--)\s?/u.test(line)) score += 1;
  if (CODE_KEYWORD.test(line)) score += 3;
  if (/^\s*[\w.$]+\([^)]*\)\s*[;{]?\s*$/u.test(line)) score += 2;
  if (/^\s*"[^"]+"\s*:/u.test(line)) score += 3;
  if (/<[a-zA-Z][^>]*>|<\/[a-zA-Z][^>]*>/u.test(line)) score += 3;
  if (/^\s*[}\])\]];?,?\s*$/u.test(line)) score += 2;
  if (/^\s*(?:import|export|from|require)\b/u.test(line)) score += 3;
  if (/^\s*(?:\/\/|#)\s*\S/u.test(line) && !isCjk(trimmed[0])) score += 1;
  if (COMMAND_START.test(line) && !/[。！？]/u.test(line)) score += 2;
  if (/^\s*---+\s*$/u.test(line)) score -= 4;
  if (isListLine(line)) score -= 4;
  if (isExplicitHeading(line)) score -= 4;
  if (/[|]\s*[^|]+\s*[|]/u.test(trimmed)) score -= 1;
  const cjkCount = [...trimmed].filter(isCjk).length;
  if (cjkCount >= 4) score -= 4;
  else if (cjkCount >= 2) score -= 2;
  if (/[。！？；]/u.test(trimmed)) score -= 2;
  if (/^[A-Z][a-z]+(?:\s+[a-z]+){2,}[.!?]?$/u.test(trimmed)) score -= 2;
  return score;
}

function isCodeish(line: string): boolean {
  if (!line.trim()) return false;
  if (isListLine(line) || isExplicitHeading(line) || isQuote(line)) return false;
  return codeScore(line) >= 2;
}

function stripFenceInfo(line: string): { fence: string; lang: string } | null {
  const match = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/u.exec(line);
  if (!match) return null;
  return { fence: match[1], lang: (match[2] || "").toLowerCase() };
}

function languageTagFromLine(line: string | undefined): string | null {
  if (!line) return null;
  const tag = line.trim().toLowerCase();
  if (!tag || !LANGUAGE_TAGS.has(tag)) return null;
  return tag === "py" ? "python" : tag === "ts" ? "typescript" : tag === "js" ? "javascript" : tag;
}

function escapeProse(text: string): string {
  // Protect inline code spans first, then neutralise accidental markdown.
  const spans: string[] = [];
  let result = text.replace(/`([^`\n]+)`/gu, (_match, code: string) => {
    spans.push(code);
    return `\u0000${spans.length - 1}\u0000`;
  });
  result = result
    .replace(/\\/gu, "\\\\")
    .replace(/\*/gu, "\\*")
    .replace(/_/gu, "\\_")
    .replace(/\[/gu, "\\[")
    .replace(/\]/gu, "\\]")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
  result = result.replace(/\u0000(\d+)\u0000/gu, (_match, index: string) => {
    return `\`${spans[Number(index)] ?? ""}\``;
  });
  return result;
}

function proseMarkdown(lines: string[], markdownish: boolean): string {
  const paragraph: string[] = [];
  const out: string[] = [];

  const flush = () => {
    if (paragraph.length === 0) return;
    const merged = paragraph.reduce((acc, line) => joinProse(acc, line.trim()), "");
    if (merged) out.push(markdownish ? merged : escapeProse(merged));
    paragraph.length = 0;
  };

  for (const line of lines) {
    if (!line.trim()) {
      flush();
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (isListLine(line)) {
      flush();
      const match = /^([ \t]*)([-*+]|\d+\.)\s+(.*)$/u.exec(line);
      if (match) {
        const indent = match[1].replace(/\t/gu, "  ").length;
        const level = Math.min(4, Math.floor(indent / 2));
        const content = markdownish ? match[3] : escapeProse(match[3]);
        out.push(`${"  ".repeat(level)}${match[2]} ${content}`);
      }
      continue;
    }
    if (isQuote(line)) {
      flush();
      const content = line.replace(/^\s*>\s?/u, "");
      out.push(`> ${markdownish ? content : escapeProse(content)}`);
      continue;
    }
    if (isExplicitHeading(line)) {
      flush();
      out.push(line);
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return out.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
}

function isLikelyHeading(lines: string[], index: number): boolean {
  const line = lines[index];
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 2 || trimmed.length > 30) return false;
  if (isListLine(line) || isQuote(line) || isExplicitHeading(line) || isFence(line)) return false;
  if (/[。！？；，、：,.!?;:]$/u.test(trimmed)) return false;
  if (/[`*_[\]|]/u.test(trimmed)) return false;
  if (codeScore(line) >= 2) return false;
  const previous = index === 0 ? "" : lines[index - 1];
  if (previous.trim()) return false;
  let nextIndex = index + 1;
  while (nextIndex < lines.length && !lines[nextIndex].trim()) nextIndex += 1;
  if (nextIndex >= lines.length) return false;
  const next = lines[nextIndex];
  return isListLine(next) || codeScore(next) >= 3 || /^\s*[•·▪◦‣]/u.test(next);
}

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

const BOX_TOP_LEFT = new Set([..."┌╭┏╔╒╓"]);
const BOX_TOP_RIGHT = new Set([..."┐╮┓╗╕╖"]);
const BOX_BOTTOM_LEFT = new Set([..."└╰┗╚╘╙"]);
const BOX_BOTTOM_RIGHT = new Set([..."┘╯┛╝╛╜"]);
const BOX_MID_LEFT = new Set([..."├╞┝┠╟╠"]);
const BOX_MID_RIGHT = new Set([..."┤╡┥┨╢╣"]);
const BOX_VERTICAL = /[│┃║]/u;

function isBoxTopBorder(line: string): boolean {
  const t = line.trim();
  if (t.length < 5) return false;
  return BOX_TOP_LEFT.has(t[0]) && BOX_TOP_RIGHT.has(t[t.length - 1]) && /[─━═┄┈╌╍]{3,}/u.test(t);
}

function isBoxBottomBorder(line: string): boolean {
  const t = line.trim();
  if (t.length < 5) return false;
  return BOX_BOTTOM_LEFT.has(t[0]) && BOX_BOTTOM_RIGHT.has(t[t.length - 1]) && /[─━═┄┈╌╍]{3,}/u.test(t);
}

function isBoxMiddleBorder(line: string): boolean {
  const t = line.trim();
  if (t.length < 5) return false;
  return BOX_MID_LEFT.has(t[0]) && BOX_MID_RIGHT.has(t[t.length - 1]) && /[─━═┄┈╌╍]/u.test(t);
}

function isAsciiTableBorder(line: string): boolean {
  return /^\s*\+(?:[-=]+\+)+\s*$/u.test(line);
}

function splitBoxRow(line: string): string[] | null {
  const t = line.trim();
  if (!t) return null;
  if (/^[│┃║]/u.test(t)) {
    const inner = t.replace(/^[│┃║]/u, "").replace(/[│┃║]$/u, "");
    const cells = inner.split(BOX_VERTICAL).map((cell) => cell.trim());
    return cells.length >= 2 ? cells : null;
  }
  if (t.startsWith("|")) {
    const inner = t.replace(/^\|/u, "").replace(/\|$/u, "");
    const cells = inner.split("|").map((cell) => cell.trim());
    return cells.length >= 2 ? cells : null;
  }
  return null;
}

function markdownTableFromRows(rows: string[][], prefix: string): string[] {
  const columns = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) =>
    Array.from({ length: columns }, (_, i) => (row[i] ?? "").replace(/\|/gu, "\\|").trim()),
  );
  const header = normalized[0];
  const body = normalized.slice(1);
  const lines = [
    `${prefix}| ${header.join(" | ")} |`,
    `${prefix}| ${header.map(() => "---").join(" | ")} |`,
  ];
  for (const row of body) {
    lines.push(`${prefix}| ${row.join(" | ")} |`);
  }
  return lines;
}

/**
 * Claude Code renders markdown tables as box-drawing tables inside the
 * terminal. Convert those (plus ASCII +---+ tables) back to Markdown before
 * the noise filter strips their borders.
 */
export function extractBoxTables(lines: string[]): string[] {
  const out: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const asciiTop = isAsciiTableBorder(line);
    const boxTop = isBoxTopBorder(line);

    if (!asciiTop && !boxTop) {
      out.push(line);
      index += 1;
      continue;
    }

    const prefix = line.match(/^\s*/u)?.[0] ?? "";
    const rows: string[][] = [];
    let cursor = index + 1;
    let sawBottom = false;

    while (cursor < lines.length) {
      const candidate = lines[cursor];
      if (!candidate.trim()) break;
      if (boxTop && isBoxBottomBorder(candidate)) {
        sawBottom = true;
        cursor += 1;
        break;
      }
      if (boxTop && isBoxMiddleBorder(candidate)) {
        cursor += 1;
        continue;
      }
      if (asciiTop && isAsciiTableBorder(candidate)) {
        // Top / middle / bottom border in a plain ASCII table.
        cursor += 1;
        continue;
      }
      const cells = splitBoxRow(candidate);
      if (!cells) break;
      rows.push(cells);
      cursor += 1;
    }

    if (rows.length > 0 && Math.max(...rows.map((row) => row.length)) >= 2) {
      out.push("", ...markdownTableFromRows(rows, prefix), "");
      index = cursor;
      continue;
    }

    // Not a usable table; preserve the original line so it can be filtered
    // normally by the transcript cleaner.
    out.push(line);
    index += 1;
  }

  return out;
}

function delimiterBalance(line: string): number {
  let balance = 0;
  let quote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") balance += 1;
    else if (ch === "}" || ch === ")" || ch === "]") balance -= 1;
  }
  return balance;
}

export function assistantTextToMarkdown(rawLines: string[]): string {
  const lines = convertBullets(rawLines.slice());
  if (lines.length === 0) return "";

  const joined = lines.join("\n");
  const markdownish =
    /```|~~~|^#{1,6}\s+\S|\*\*[^*\n]+\*\*|\[[^\]]+\]\([^)]+\)|^\s*\|.+\|\s*$/mu.test(joined);

  const out: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      index += 1;
      continue;
    }

    const fence = stripFenceInfo(line);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !new RegExp(`^\\s*${fence.fence[0]}{${fence.fence.length},}\\s*$`, "u").test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += 1;
      const lang = fence.lang || detectCodeLanguage(codeLines.join("\n"));
      out.push(`\`\`\`${lang === "text" ? "" : lang}`.trimEnd());
      out.push(...codeLines);
      out.push("```");
      continue;
    }

    if (/^\s*\|.*\|\s*$/u.test(line)) {
      const table: string[] = [];
      while (index < lines.length && /^\s*\|.*\|\s*$/u.test(lines[index])) {
        table.push(lines[index].trim());
        index += 1;
      }
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      out.push(...table);
      if (index < lines.length && lines[index].trim()) out.push("");
      continue;
    }

    if (isListLine(line) || isQuote(line) || isExplicitHeading(line)) {
      const markdown = proseMarkdown([line], markdownish);
      if (markdown) out.push(markdown);
      index += 1;
      continue;
    }

    if (isLikelyHeading(lines, index)) {
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      out.push(`### ${markdownish ? line.trim() : escapeProse(line.trim())}`);
      index += 1;
      continue;
    }

    const score = codeScore(line);
    const next = lines[index + 1];
    const nextCode = next !== undefined && isCodeish(next);
    const startsCommand = COMMAND_START.test(line) && !/[。！？]/u.test(line);
    const strongSingleLine = score >= 4 && line.trim().length > 0;
    const opensCode = delimiterBalance(line) > 0 && score >= 3;
    const startCode =
      startsCommand ||
      opensCode ||
      strongSingleLine ||
      (score >= 2 && (nextCode || (next !== undefined && isCodeish(next))));

    if (startCode) {
      const codeLines: string[] = [line];
      let cursor = index + 1;
      let blanks = 0;
      let balance = delimiterBalance(line);
      while (cursor < lines.length) {
        const candidate = lines[cursor];
        if (!candidate.trim()) {
          blanks += 1;
          cursor += 1;
          if (blanks > 1) break;
          continue;
        }
        const nextScore = codeScore(candidate);
        const allow =
          balance > 0 ||
          nextScore >= 1 ||
          /^\s{2,}\S/u.test(candidate) ||
          (cursor === index + 1 && LANGUAGE_TAGS.has(candidate.trim().toLowerCase()));
        if (!allow) break;
        if (blanks > 0) {
          for (let b = 0; b < blanks; b += 1) codeLines.push("");
          blanks = 0;
        }
        codeLines.push(candidate);
        balance += delimiterBalance(candidate);
        cursor += 1;
      }
      while (codeLines.length > 1 && !codeLines[codeLines.length - 1].trim()) codeLines.pop();

      let lang = "";
      const trailingTag = languageTagFromLine(codeLines[codeLines.length - 1]);
      if (trailingTag && codeLines.length > 2) {
        lang = trailingTag;
        codeLines.pop();
      }
      if (!lang) {
        const leadingTag = languageTagFromLine(codeLines[0]);
        if (leadingTag && codeLines.length > 2) {
          lang = leadingTag;
          codeLines.shift();
        }
      }
      if (!lang) lang = detectCodeLanguage(codeLines.join("\n"));

      const fence = codeLines.some((l) => /```/u.test(l)) ? "````" : "```";
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      out.push(`${fence}${lang === "text" ? "" : lang}`);
      out.push(...codeLines);
      out.push(fence);
      if (cursor < lines.length && lines[cursor].trim()) out.push("");
      index = cursor;
      continue;
    }

    const paraLine = markdownish ? line.trim() : escapeProse(line.trim());
    if (out.length > 0 && out[out.length - 1] !== "" && !/^```/u.test(out[out.length - 1] || "")) {
      // Join with the previous plain paragraph line when possible.
      const previous = out[out.length - 1];
      if (!/^(\s*[-*+]\s|#{1,6}\s|>|```)/u.test(previous)) {
        out[out.length - 1] = joinProse(previous, paraLine);
        index += 1;
        continue;
      }
    }
    out.push(paraLine);
    index += 1;
  }

  return out.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
}

/* ------------------------------------------------------------------ */
/* Main parse                                                          */
/* ------------------------------------------------------------------ */

function cleanAssistantContent(lines: string[]): string[] {
  let out = lines.map((line) => (TOOL_RESULT.test(line) ? "" : line));
  out = dedentAssistant(out);
  out = convertBullets(out);
  out = trimAssistantText(out);

  // Drop a few UI leftovers that can sit at the very end of a streamed block.
  while (out.length > 0) {
    const last = out[out.length - 1].trim();
    if (
      !last ||
      SPINNER_ONLY.test(last) ||
      /^\(?\s*(?:esc|ctrl\+c)\b.*(?:interrupt|stop)/iu.test(last) ||
      /^⏵⏵/u.test(last)
    ) {
      out.pop();
      continue;
    }
    break;
  }
  return out;
}

export function parseTerminalOutput(input: RawLine[], options: { force?: boolean } = {}): ParseResult {
  const rawLogical = normalizeInput(input);
  const rawJoined = rawLogical.join("\n");
  const detected = isAiTranscript(rawJoined);
  const tail = rawLogical.slice(-12).join("\n");
  const logical = extractBoxTables(rawLogical);
  const spinnerActive =
    /esc to interrupt|ctrl\+c to (?:stop|interrupt)|[✻✽✢✳✶]\s+\w+.*(?:…|\.\.\.)/iu.test(tail);

  const lines = cleanLines(logical);
  const turns: ChatTurn[] = [];
  let mode: "none" | "user" | "assistant" | "tool" = "none";

  const pushTurn = (role: TurnRole, text: string, tools: string[] = []) => {
    turns.push({ role, text, markdown: role === "assistant" ? "" : text, tools });
    return turns[turns.length - 1];
  };

  const lastTurn = () => turns[turns.length - 1];

  for (const line of lines) {
    const userMatch = USER_MARKER.exec(line);
    if (userMatch) {
      const content = userMatch[1].trim();
      if (content) {
        const last = lastTurn();
        if (last && last.role === "user" && mode === "user") {
          last.text = joinProse(last.text, content);
        } else {
          pushTurn("user", content);
          mode = "user";
        }
      } else {
        // An empty prompt is the active input box; it marks the end of an answer.
        if (mode !== "none") mode = "none";
      }
      continue;
    }

    const assistantMatch = ASSISTANT_MARKER.exec(line);
    if (assistantMatch) {
      const content = stripMarker(assistantMatch[0]);
      if (!content) {
        mode = "assistant";
        continue;
      }
      const tool = detectTool(content);
      if (tool) {
        let target = lastTurn();
        if (!target || target.role !== "assistant") target = pushTurn("assistant", "");
        target.tools.push(tool.name);
        mode = "tool";
        continue;
      }
      if (SPINNER_ONLY.test(content) || /^(?:esc|ctrl\+c)\b/iu.test(content)) {
        mode = "none";
        continue;
      }

      let target = lastTurn();
      if (target && target.role === "assistant" && mode !== "user") {
        target.text = target.text ? `${target.text}\n${content}` : content;
      } else {
        target = pushTurn("assistant", content);
      }
      mode = "assistant";
      continue;
    }

    if (mode === "tool") continue;
    if (mode === "assistant" && lastTurn()) {
      lastTurn().text = joinProse(lastTurn().text, line.trim()) === "" ? lastTurn().text : `${lastTurn().text}\n${line}`;
      continue;
    }
    if (mode === "user" && lastTurn()) {
      if (line.trim()) lastTurn().text = joinProse(lastTurn().text, line.trim());
      continue;
    }
    if (mode === "none" && line.trim()) {
      const afterUser = turns.length > 0 && turns[turns.length - 1].role === "user";
      if (options.force || (detected && afterUser)) {
        pushTurn("assistant", line);
        mode = "assistant";
      }
    }
  }

  // Rebuild clean prose + markdown for each turn.
  for (const turn of turns) {
    if (turn.role === "assistant") {
      const content = cleanAssistantContent(turn.text.split("\n"));
      turn.text = content.join("\n").trim();
      turn.markdown = assistantTextToMarkdown(content);
    } else {
      turn.text = turn.text.trim();
    }
  }

  let cleanedTurns = turns.filter((turn) => turn.role === "user" || turn.text || turn.tools.length > 0);

  // Coalesce assistant turns that were split by consecutive markers or tools.
  const merged: ChatTurn[] = [];
  for (const turn of cleanedTurns) {
    const previous = merged[merged.length - 1];
    if (turn.role === "assistant" && previous?.role === "assistant") {
      previous.text = [previous.text, turn.text].filter(Boolean).join("\n");
      previous.markdown = assistantTextToMarkdown(previous.text.split("\n"));
      previous.tools.push(...turn.tools);
    } else {
      merged.push(turn);
    }
  }
  cleanedTurns = merged;

  const toolCount = cleanedTurns.reduce((count, turn) => count + turn.tools.length, 0);
  const last = cleanedTurns[cleanedTurns.length - 1];
  const working = spinnerActive || (last?.role === "user" && detected);

  let latest: ChatTurn | null = null;
  for (let i = cleanedTurns.length - 1; i >= 0; i -= 1) {
    const turn = cleanedTurns[i];
    if (turn.role === "assistant" && (turn.text || turn.markdown)) {
      latest = turn;
      break;
    }
  }

  const visibleTurns = cleanedTurns.slice(-8);
  return {
    detected,
    working,
    turns: visibleTurns,
    latest,
    toolCount,
    sourceLines: logical.length,
  };
}
