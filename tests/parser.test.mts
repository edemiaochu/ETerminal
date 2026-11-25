import assert from "node:assert/strict";
import test from "node:test";
import {
  assistantTextToMarkdown,
  detectCodeLanguage,
  extractBoxTables,
  isAiTranscript,
  parseTerminalOutput,
} from "../src/ai/parser.ts";

function claudeSample(): string[] {
  return [
    "╭──────────────────────────────────────────────╮",
    "│ > claude                                     │",
    "╰──────────────────────────────────────────────╯",
    "❯ 请检查一下项目结构",
    "⏺ 我先看看关键文件。",
    "⏺ Read(src/app.ts)",
    "  ⎿ Read 20 lines (ctrl+r to expand)",
    "⏺ 结论如下：",
    "",
    "  实现要点",
    "",
    "  • 第一项：保持终端清晰",
    "  • 第二项：玻璃只弯曲背景",
    "",
    "  示例：",
    "  ```ts",
    "  const x = 1;",
    "  ```",
    "",
    "  ✻ Worked for 8s",
    "",
    "  ? for shortcuts",
  ];
}

test("parses a Claude-style transcript into readable turns", () => {
  const result = parseTerminalOutput(claudeSample());
  assert.equal(result.detected, true);
  assert.equal(result.working, false);
  assert.equal(result.sourceLines > 0, true);
  assert.equal(result.turns.length, 2);
  assert.equal(result.turns[0].role, "user");
  assert.equal(result.turns[0].text, "请检查一下项目结构");
  assert.equal(result.turns[1].role, "assistant");
  assert.deepEqual(result.turns[1].tools, ["Read"]);
  assert.equal(result.toolCount, 1);
  assert.match(result.latest?.markdown || "", /### 实现要点/);
  assert.match(result.latest?.markdown || "", /```ts\nconst x = 1;\n```/);
  assert.doesNotMatch(result.latest?.markdown || "", /Worked for/);
  assert.doesNotMatch(result.latest?.markdown || "", /for shortcuts/);
  assert.doesNotMatch(result.latest?.text || "", /⎿/);
});

test("detects an active spinner and reports working state", () => {
  const lines = [
    "❯ 修复测试",
    "⏺ Bash(npm test)",
    "  ⎿ 3 tests failed",
    "✻ Reticulating… (esc to interrupt)",
  ];
  const result = parseTerminalOutput(lines);
  assert.equal(result.detected, true);
  assert.equal(result.working, true);
  assert.equal(result.turns[0].role, "user");
  assert.deepEqual(result.turns.at(-1)?.tools, ["Bash"]);
});

test("joins wrapped terminal lines before parsing", () => {
  const result = parseTerminalOutput([
    { text: "⏺ Hello ", wrapped: false },
    { text: "wrapped world", wrapped: true },
    { text: "", wrapped: false },
  ]);
  assert.equal(result.latest?.text, "Hello wrapped world");
});

test("force mode beautifies output without AI markers", () => {
  const result = parseTerminalOutput(["A plain paragraph", "with two lines"], { force: true });
  assert.equal(result.detected, false);
  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0].role, "assistant");
  assert.match(result.latest?.text || "", /plain paragraph/);
});

test("ignores ordinary shell output", () => {
  const result = parseTerminalOutput([
    "PS C:\\Users\\lk> Get-ChildItem",
    "Mode   LastWriteTime   Length Name",
    "d----  2026/01/01      Desktop",
  ]);
  assert.equal(result.detected, false);
  assert.equal(result.turns.length, 0);
});

test("escapes accidental markdown in prose", () => {
  const markdown = assistantTextToMarkdown(["Use foo_bar and [link] carefully"]);
  assert.match(markdown, /foo\\_bar/);
  assert.match(markdown, /\\\[link\\\]/);
});

test("infers a compact heading before a list", () => {
  const markdown = assistantTextToMarkdown(["实现要点", "", "• 第一项", "• 第二项"]);
  assert.match(markdown, /^### 实现要点/m);
  assert.match(markdown, /^- 第一项/m);
});

test("detects common code languages", () => {
  assert.equal(detectCodeLanguage("def hello():\n    print('hi')"), "python");
  assert.equal(detectCodeLanguage("$ npm install\n$ npm run dev"), "bash");
  assert.equal(detectCodeLanguage('{\n  "name": "eterminal"\n}'), "json");
  assert.equal(
    detectCodeLanguage("interface Props { name: string }\nconst props: Props = { name: 'x' };"),
    "typescript",
  );
});

test("isAiTranscript recognises markers but not plain logs", () => {
  assert.equal(isAiTranscript("⏺ 完成"), true);
  assert.equal(isAiTranscript("✻ Thinking… (esc to interrupt)"), true);
  assert.equal(isAiTranscript("npm ERR! code ELIFECYCLE"), false);
});


test("rebuilds box-drawing tables from Claude-style output", () => {
  const result = parseTerminalOutput([
    "❯ 对比一下数量",
    "⏺ 对比结果：",
    "",
    "  ┌────────┬──────┐",
    "  │ 名称   │ 数量 │",
    "  ├────────┼──────┤",
    "  │ 苹果   │ 12   │",
    "  │ 香蕉   │ 7    │",
    "  └────────┴──────┘",
    "",
    "  ? for shortcuts",
  ]);
  const markdown = result.latest?.markdown || "";
  assert.match(markdown, /\| 名称 \| 数量 \|/);
  assert.match(markdown, /\| --- \| --- \|/);
  assert.match(markdown, /\| 苹果 \| 12 \|/);
  assert.match(markdown, /\| 香蕉 \| 7 \|/);
  assert.doesNotMatch(markdown, /[┌│├└]/);
});

test("keeps Markdown table rows as separate lines", () => {
  const markdown = assistantTextToMarkdown([
    "结果如下：",
    "",
    "| 项目 | 状态 |",
    "| --- | --- |",
    "| 终端 | 就绪 |",
    "",
    "继续。",
  ]);
  assert.match(markdown, /\| 项目 \| 状态 \|\n\| --- \| --- \|\n\| 终端 \| 就绪 \|/);
});

test("rebuilds plain ASCII tables", () => {
  const markdown = assistantTextToMarkdown(extractBoxTables([
    " +------+------+",
    " | 名称 | 值   |",
    " +------+------+",
    " | A    | 1    |",
    " +------+------+",
  ]));
  assert.match(markdown, /\| 名称 \| 值 \|/);
  assert.match(markdown, /\| A \| 1 \|/);
});
