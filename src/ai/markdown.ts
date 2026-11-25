import { Marked } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";

import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const LANGUAGES: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  dockerfile,
  go,
  ini,
  java,
  javascript,
  json,
  kotlin,
  markdown,
  php,
  plaintext,
  powershell,
  python,
  ruby,
  rust,
  sql,
  swift,
  typescript,
  xml,
  yaml,
};

const ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  ps1: "powershell",
  pwsh: "powershell",
  html: "xml",
  svg: "xml",
  yml: "yaml",
  rs: "rust",
  cs: "csharp",
  "c++": "cpp",
  golang: "go",
  md: "markdown",
  text: "plaintext",
  txt: "plaintext",
  log: "plaintext",
  toml: "ini",
  bat: "bash",
  cmd: "bash",
};

for (const [name, language] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, language);
}

const LABELS: Record<string, string> = {
  javascript: "JS",
  typescript: "TS",
  python: "PY",
  bash: "SH",
  powershell: "PS",
  json: "JSON",
  xml: "HTML",
  css: "CSS",
  sql: "SQL",
  go: "GO",
  rust: "RS",
  yaml: "YAML",
  markdown: "MD",
  plaintext: "TXT",
  dockerfile: "DOCKER",
  csharp: "C#",
};

const marked = new Marked({
  gfm: true,
  breaks: false,
  async: false,
});

const URL_RE = /\bhttps?:\/\/[^\s<>"'`)\]]+[^\s<>"'`)\].,;:!?]/gu;

function normalizeLanguage(raw: string): string {
  const lower = raw.toLowerCase().trim();
  return ALIASES[lower] || lower;
}

function highlightCode(raw: string, language: string): string {
  if (!language || !LANGUAGES[language] || raw.length > 80_000) {
    return escapeCode(raw);
  }
  try {
    return hljs.highlight(raw, { language, ignoreIllegals: true }).value;
  } catch {
    return escapeCode(raw);
  }
}

function escapeCode(raw: string): string {
  return raw.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

function linkifyTextNodes(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("a, code, pre, .code-card")) return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue || !URL_RE.test(node.nodeValue)) {
        URL_RE.lastIndex = 0;
        return NodeFilter.FILTER_REJECT;
      }
      URL_RE.lastIndex = 0;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const targets: Text[] = [];
  while (walker.nextNode()) {
    if (targets.length > 120) break;
    targets.push(walker.currentNode as Text);
  }

  for (const node of targets) {
    const text = node.nodeValue || "";
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    URL_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = URL_RE.exec(text))) {
      if (match.index > cursor) fragment.append(document.createTextNode(text.slice(cursor, match.index)));
      const anchor = document.createElement("a");
      anchor.href = match[0];
      anchor.textContent = match[0];
      anchor.target = "_blank";
      anchor.rel = "noreferrer noopener";
      anchor.className = "md-link";
      fragment.append(anchor);
      cursor = match.index + match[0].length;
    }
    if (cursor === 0) continue;
    if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
    node.replaceWith(fragment);
  }
}

function enhanceLinks(root: HTMLElement): void {
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>("a")) {
    const href = anchor.getAttribute("href") || "";
    if (!/^(https?:|mailto:)/iu.test(href)) {
      anchor.removeAttribute("href");
      continue;
    }
    anchor.target = "_blank";
    anchor.rel = "noreferrer noopener";
    anchor.title = href;
    anchor.classList.add("md-link");
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      void window.eterm.openExternal(href);
    });
  }
  linkifyTextNodes(root);
}

function enhanceCodeBlocks(root: HTMLElement): void {
  const blocks = [...root.querySelectorAll<HTMLPreElement>("pre")];
  for (const pre of blocks) {
    if (pre.parentElement?.classList.contains("code-card")) continue;
    const code = pre.querySelector("code");
    const raw = code?.textContent || pre.textContent || "";
    const langClass = code?.className.match(/language-([\w+#.-]+)/u)?.[1] || "";
    const language = normalizeLanguage(langClass);
    code?.classList.add("hljs");

    if (code) {
      if (language && LANGUAGES[language]) {
        code.innerHTML = highlightCode(raw, language);
      } else if (code.childNodes.length === 0) {
        code.textContent = raw;
      }
    }

    const card = document.createElement("div");
    card.className = "code-card";
    const head = document.createElement("div");
    head.className = "code-card__head";
    const label = document.createElement("span");
    label.className = "code-card__lang";
    label.textContent = LABELS[language] || (language ? language.toUpperCase() : "CODE");
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "code-card__copy";
    copy.setAttribute("aria-label", "复制代码");
    copy.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg><span>复制</span>`;
    copy.addEventListener("click", async () => {
      await window.eterm.clipboardWrite(raw);
      copy.classList.add("is-copied");
      const text = copy.querySelector("span");
      if (text) text.textContent = "已复制";
      window.setTimeout(() => {
        copy.classList.remove("is-copied");
        if (text) text.textContent = "复制";
      }, 1600);
    });
    head.append(label, copy);

    pre.replaceWith(card);
    card.append(head, pre);
  }
}

function enhanceTables(root: HTMLElement): void {
  for (const table of root.querySelectorAll("table")) {
    if (table.parentElement?.classList.contains("table-scroll")) continue;
    const wrapper = document.createElement("div");
    wrapper.className = "table-scroll";
    table.replaceWith(wrapper);
    wrapper.append(table);
  }
}

function enhance(root: HTMLElement): void {
  enhanceLinks(root);
  enhanceCodeBlocks(root);
  enhanceTables(root);
}

export function renderMarkdown(markdown: string): string {
  if (!markdown.trim()) return "";
  let html = "";
  try {
    html = marked.parse(markdown) as string;
  } catch {
    html = `<p>${escapeCode(markdown)}</p>`;
  }
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["img", "iframe", "frame", "video", "audio", "form", "input", "textarea", "button", "style", "link", "meta", "object", "embed"],
    FORBID_ATTR: ["style", "srcset", "ping"],
  });
}

export function mountMarkdown(host: HTMLElement, markdown: string): void {
  host.innerHTML = renderMarkdown(markdown);
  enhance(host);
}

export function markdownToPlainText(markdown: string): string {
  try {
    const html = marked.parse(markdown) as string;
    const temp = document.createElement("div");
    temp.innerHTML = html;
    return temp.textContent || "";
  } catch {
    return markdown;
  }
}
