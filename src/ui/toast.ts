import { icon, type IconName } from "./icons";

export type ToastTone = "info" | "success" | "warning" | "error" | "ai";

const TONE_ICON: Record<ToastTone, IconName> = {
  info: "info",
  success: "check",
  warning: "alert",
  error: "alert",
  ai: "sparkles",
};

let host: HTMLElement | null = null;

function ensureHost(): HTMLElement {
  if (host && host.isConnected) return host;
  host = document.createElement("div");
  host.className = "toast-host";
  host.setAttribute("aria-live", "polite");
  document.getElementById("app-ui")?.append(host);
  return host;
}

export function toast(
  message: string,
  options: { tone?: ToastTone; detail?: string; duration?: number } = {},
): void {
  const { tone = "info", detail, duration = 3200 } = options;
  const container = ensureHost();
  const node = document.createElement("div");
  node.className = `toast toast--${tone}`;
  node.innerHTML = `<span class="toast__icon">${icon(TONE_ICON[tone], 15)}</span>
    <span class="toast__body"><span class="toast__message"></span>${
      detail ? `<span class="toast__detail"></span>` : ""
    }</span>`;
  const messageNode = node.querySelector(".toast__message");
  if (messageNode) messageNode.textContent = message;
  const detailNode = node.querySelector(".toast__detail");
  if (detailNode && detail) detailNode.textContent = detail;

  container.append(node);
  requestAnimationFrame(() => node.classList.add("is-visible"));

  const remove = () => {
    node.classList.remove("is-visible");
    node.classList.add("is-leaving");
    window.setTimeout(() => node.remove(), 260);
  };
  const timer = window.setTimeout(remove, duration);
  node.addEventListener("click", () => {
    window.clearTimeout(timer);
    remove();
  });
}
