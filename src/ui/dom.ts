export function qs<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
}

export function qsa<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return [...root.querySelectorAll<T>(selector)];
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

export function basename(filePath: string): string {
  if (!filePath) return "";
  const normalized = filePath.replace(/\\/gu, "/").replace(/\/+$/u, "");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || filePath;
}

export function isHomePath(filePath: string, home: string): boolean {
  if (!filePath || !home) return false;
  const a = filePath.replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
  const b = home.replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
  return a === b;
}

export function truncateMiddle(text: string, max = 40): string {
  if (text.length <= max) return text;
  const keep = Math.max(6, Math.floor((max - 1) / 2));
  return `${text.slice(0, keep)}…${text.slice(-keep)}`;
}

export function formatClock(date = new Date()): string {
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hours = Math.floor(min / 60);
  return `${hours}h ${min % 60}m`;
}

export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, wait: number) {
  let timer: number | undefined;
  return (...args: Args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

export function platformIsMac(): boolean {
  return navigator.platform.toLowerCase().includes("mac");
}

export function isCjkText(text: string): boolean {
  return /[⺀-鿿豈-﫿＀-￯぀-ヿ]/u.test(text);
}
