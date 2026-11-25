import { THEMES, type ThemeName } from "../themes";

/** Shared swatch grid used by the toolbar theme popover and settings dialog. */
export function themeCardsMarkup(active: ThemeName): string {
  return THEMES.map(
    (theme) => `<button type="button" class="theme-card${theme.id === active ? " is-active" : ""}" data-theme-option="${theme.id}" aria-pressed="${theme.id === active ? "true" : "false"}">
      <span class="theme-swatch" style="--theme-from:${theme.from};--theme-to:${theme.to}" aria-hidden="true"></span>
      <span class="theme-card__name">${theme.name}</span>
    </button>`,
  ).join("");
}
