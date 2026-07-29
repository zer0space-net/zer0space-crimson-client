// Accent theme, mirroring the dashboard's picker. The whole UI is color-mixed
// from --accent (see tokens.css), so setting that one variable recolours
// everything. Persisted per-browser; crimson is the default so the crossover
// identity stays unless the user picks another.

const ACCENT_KEY = "zsc-accent";

export interface AccentTheme {
  id: string;
  label: string;
  color: string;
}

// Crimson first (default); the rest match the dashboard's named themes so the
// two feel like one system.
export const ACCENTS: AccentTheme[] = [
  { id: "crimson", label: "Crimson", color: "#e5384d" },
  { id: "aurora", label: "Aurora", color: "#2f7dfb" },
  { id: "cyan", label: "Cyan", color: "#22c3d6" },
  { id: "violet", label: "Violet", color: "#8b5cf6" },
  { id: "ember", label: "Ember", color: "#f97316" },
  { id: "mint", label: "Mint", color: "#22c58b" },
  { id: "rose", label: "Rose", color: "#f43f7e" },
];

export function currentAccent(): string {
  try {
    return localStorage.getItem(ACCENT_KEY) || "#e5384d";
  } catch {
    return "#e5384d";
  }
}

export function applyAccent(color: string): void {
  document.documentElement.style.setProperty("--accent", color);
  try {
    localStorage.setItem(ACCENT_KEY, color);
  } catch {
    /* ignore */
  }
}

// Call once on boot so the stored accent is live before first paint work.
export function initAccent(): void {
  const c = currentAccent();
  if (c && c !== "#e5384d") document.documentElement.style.setProperty("--accent", c);
}
