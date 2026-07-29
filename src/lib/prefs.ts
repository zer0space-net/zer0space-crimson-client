// Playback preferences, persisted per-browser. Currently the preferred
// audio/language: when a source with a matching `language` label is available,
// the watch page auto-selects it instead of just the first tile.

const LANGPREF_KEY = "zsc-langpref";

// Value is a lowercase substring matched against a source's language label
// (e.g. "german", "english", "ja"). Empty = no preference.
export function getLangPref(): string {
  try {
    return localStorage.getItem(LANGPREF_KEY) || "";
  } catch {
    return "";
  }
}

export function setLangPref(v: string): void {
  try {
    if (v) localStorage.setItem(LANGPREF_KEY, v);
    else localStorage.removeItem(LANGPREF_KEY);
  } catch {
    /* ignore */
  }
}

// Common choices offered in Settings. `match` is the substring tested against
// the source's language string (case-insensitive).
export const LANG_PREFS: { value: string; label: string }[] = [
  { value: "", label: "—" },
  { value: "german", label: "Deutsch / German" },
  { value: "english", label: "English" },
  { value: "japanese", label: "日本語 / Japanese" },
];

/** Index of the first source whose language matches the pref, or -1. */
export function preferredIndex(
  sources: { language?: string | null }[],
  pref = getLangPref(),
): number {
  if (!pref) return -1;
  const p = pref.toLowerCase();
  return sources.findIndex((s) => (s.language || "").toLowerCase().includes(p));
}
