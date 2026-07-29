// Accent theme — SHARED with the zer0space dashboard. Both apps are same-origin
// (zer0space.com), so they read/write the same localStorage key, `zs-theme`. Pick
// a colour in either and the other matches on its next load. The dashboard stores
// a preset *name* (aurora/…) or a custom hex; we mirror that exactly, and resolve
// it to a colour for our --accent (the dashboard has :root[data-theme] rules for
// the names; we don't, so we map here).

const THEME_KEY = "zs-theme"; // same key the dashboard's boot.js uses

const CRIMSON = "#e5384d";

// Preset name → colour, matching the dashboard's :root[data-theme=…] palette,
// plus Crimson (stored as a custom hex, since the dashboard has no crimson preset).
const PRESET_COLORS: Record<string, string> = {
  aurora: "#2f7dfb",
  cyan: "#22c3d6",
  violet: "#8b5cf6",
  ember: "#f97316",
  mint: "#22c58b",
  rose: "#f43f7e",
};

export interface AccentTheme {
  id: string;
  label: string;
  stored: string; // what goes into zs-theme (a preset name, or a hex for crimson)
  color: string; // the swatch colour
}

export const ACCENTS: AccentTheme[] = [
  { id: "crimson", label: "Crimson", stored: CRIMSON, color: CRIMSON },
  { id: "aurora", label: "Aurora", stored: "aurora", color: PRESET_COLORS.aurora },
  { id: "cyan", label: "Cyan", stored: "cyan", color: PRESET_COLORS.cyan },
  { id: "violet", label: "Violet", stored: "violet", color: PRESET_COLORS.violet },
  { id: "ember", label: "Ember", stored: "ember", color: PRESET_COLORS.ember },
  { id: "mint", label: "Mint", stored: "mint", color: PRESET_COLORS.mint },
  { id: "rose", label: "Rose", stored: "rose", color: PRESET_COLORS.rose },
];

function resolveColor(stored: string | null): string {
  if (!stored) return CRIMSON;
  if (/^#[0-9a-f]{6}$/i.test(stored)) return stored;
  return PRESET_COLORS[stored] || CRIMSON;
}

// The current stored value (preset name or hex) — used by the picker to show the
// active swatch. Defaults to the dashboard's value, or crimson when unset.
export function currentStored(): string {
  try {
    return localStorage.getItem(THEME_KEY) || CRIMSON;
  } catch {
    return CRIMSON;
  }
}

// Persist to the shared key and recolour immediately. `stored` is a preset name
// or a hex — same format the dashboard writes.
export function setAccent(stored: string): void {
  try {
    localStorage.setItem(THEME_KEY, stored);
  } catch {
    /* ignore */
  }
  document.documentElement.style.setProperty("--accent", resolveColor(stored));
}

// Apply the shared accent before first paint (no flash of the default colour).
export function initAccent(): void {
  try {
    document.documentElement.style.setProperty(
      "--accent",
      resolveColor(localStorage.getItem(THEME_KEY)),
    );
  } catch {
    /* ignore */
  }
}
