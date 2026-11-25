/** Small hand-picked stroke icon set (24×24, Lucide-style geometry). */
export type IconName =
  | "terminal"
  | "plus"
  | "minus"
  | "square"
  | "x"
  | "chevron-down"
  | "chevron-right"
  | "chevron-left"
  | "chevron-up"
  | "search"
  | "sparkles"
  | "sliders"
  | "command"
  | "copy"
  | "check"
  | "refresh"
  | "trash"
  | "folder"
  | "git-branch"
  | "play"
  | "rotate"
  | "external"
  | "panel-right"
  | "panel-left"
  | "alert"
  | "info"
  | "arrow-down"
  | "bot"
  | "bolt"
  | "keyboard"
  | "clock"
  | "expand"
  | "layout"
  | "moon"
  | "sun"
  | "palette"
  | "wand"
  | "download"
  | "corner"
  | "maximize"
  | "minimize"
  | "restore"
  | "pencil";

const PATHS: Record<IconName, string> = {
  terminal:
    '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
  square: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  "chevron-down": '<polyline points="6 9 12 15 18 9"/>',
  "chevron-right": '<polyline points="9 18 15 12 9 6"/>',
  "chevron-left": '<polyline points="15 18 9 12 15 6"/>',
  "chevron-up": '<polyline points="18 15 12 9 6 15"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  sparkles:
    '<path d="M12 3l1.9 4.8L19 9.6l-4.2 3.5L15.9 18 12 15.4 8.1 18l1.1-4.9L5 9.6l5.1-1.8L12 3z"/><path d="M19 3v3M17.5 4.5h3"/>',
  sliders:
    '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="17" r="2"/>',
  command:
    '<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  refresh:
    '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/>',
  trash:
    '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  folder:
    '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>',
  "git-branch":
    '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  play: '<polygon points="7 4 20 12 7 20 7 4"/>',
  rotate:
    '<path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/>',
  external:
    '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  "panel-right":
    '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="15" y1="4" x2="15" y2="20"/>',
  "panel-left":
    '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/>',
  alert:
    '<path d="M12 3l10 18H2L12 3z"/><line x1="12" y1="9" x2="12" y2="14"/><circle cx="12" cy="17.5" r="0.8" fill="currentColor" stroke="none"/>',
  info: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="17"/><circle cx="12" cy="7.5" r="0.9" fill="currentColor" stroke="none"/>',
  "arrow-down": '<line x1="12" y1="4" x2="12" y2="19"/><polyline points="6 13 12 19 18 13"/>',
  bot:
    '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4"/><circle cx="9" cy="14" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="14" r="1" fill="currentColor" stroke="none"/><path d="M9 17h6"/>',
  bolt: '<polygon points="13 2 4 14 11 14 10 22 20 9 13 9 13 2"/>',
  keyboard:
    '<rect x="2" y="6" width="20" height="12" rx="2"/><line x1="6" y1="10" x2="6" y2="10"/><line x1="10" y1="10" x2="10" y2="10"/><line x1="14" y1="10" x2="14" y2="10"/><line x1="18" y1="10" x2="18" y2="10"/><line x1="7" y1="14" x2="17" y2="14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
  expand:
    '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>',
  layout:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="10" y1="10" x2="10" y2="20"/>',
  moon: '<path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  palette:
    '<path d="M12 3a9 9 0 0 0 0 18h1.5a2 2 0 0 0 0-4H13a2 2 0 0 1 0-4h4a4 4 0 0 0 4-4c0-3.3-4-6-9-6z"/><circle cx="7.5" cy="10" r="1"/><circle cx="11" cy="6.5" r="1"/><circle cx="15.5" cy="8" r="1"/>',
  wand:
    '<path d="M15 4V2M15 10V8M11 6H9M21 6h-2M18.4 3.6L17 5M18.4 8.4L17 7M12.6 3.6L14 5M12.6 8.4L14 7"/><path d="M3 21l9-9"/>',
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  corner: '<polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  minimize: '<path d="M8 3v3a2 2 0 0 1-2 2H3M16 3v3a2 2 0 0 0 2 2h3M8 21v-3a2 2 0 0 0-2-2H3M16 21v-3a2 2 0 0 1 2-2h3"/>',
  restore:
    '<rect x="3" y="8" width="13" height="13" rx="2"/><path d="M8 8V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-3"/>',
  pencil:
    '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
};

export function icon(name: IconName, size = 16, className = ""): string {
  const body = PATHS[name] || PATHS.terminal;
  return `<svg class="icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function appMark(size = 20): string {
  return `<svg class="app-mark-svg" width="${size}" height="${size}" viewBox="0 0 28 28" fill="none" aria-hidden="true">
    <rect x="1.2" y="1.2" width="25.6" height="25.6" rx="8.2" stroke="url(#et-mark-stroke)" stroke-width="1.2" opacity=".9"/>
    <path d="M8.2 10.1l3.5 3.7-3.5 3.7" stroke="url(#et-mark-stroke)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M14.3 18h5.1" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" opacity=".8"/>
    <defs>
      <linearGradient id="et-mark-stroke" x1="4" y1="4" x2="24" y2="24" gradientUnits="userSpaceOnUse">
        <stop stop-color="#C084FC"/>
        <stop offset=".55" stop-color="#22D3EE"/>
        <stop offset="1" stop-color="#7CF0D4"/>
      </linearGradient>
    </defs>
  </svg>`;
}
