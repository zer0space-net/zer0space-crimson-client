// Playback preferences, persisted per-browser:
//   * preferred audio language   (zsc-langpref)   — auto-selects a matching source
//   * dubbed vs subbed           (zsc-dubsub)     — refines the auto-selection
//   * subtitle languages         (zsc-sublangs)   — which OpenSubtitles tracks to pull
// Backend source labels look like "German Dub" / "English Sub", so we match the
// language word and the dub/sub word as case-insensitive substrings.

const LANGPREF_KEY = "zsc-langpref";
const DUBSUB_KEY = "zsc-dubsub";
const SUBLANGS_KEY = "zsc-sublangs";

export type DubSub = "any" | "dub" | "sub";

export interface PlaybackPrefs {
  lang: string; // "" (any) or a lowercase language word: german/english/…
  dubSub: DubSub;
  subLangs: string[]; // OpenSubtitles codes, e.g. ["en","de"]
}

// --- preferred audio language ----------------------------------------------
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

// --- dubbed / subbed --------------------------------------------------------
export function getDubSub(): DubSub {
  try {
    const v = localStorage.getItem(DUBSUB_KEY);
    return v === "dub" || v === "sub" ? v : "any";
  } catch {
    return "any";
  }
}
export function setDubSub(v: DubSub): void {
  try {
    if (v === "any") localStorage.removeItem(DUBSUB_KEY);
    else localStorage.setItem(DUBSUB_KEY, v);
  } catch {
    /* ignore */
  }
}

// --- subtitle languages -----------------------------------------------------
export function getSubLangs(): string[] {
  try {
    const raw = localStorage.getItem(SUBLANGS_KEY);
    return raw ? raw.split(",").filter(Boolean) : [];
  } catch {
    return [];
  }
}
export function setSubLangs(codes: string[]): void {
  try {
    if (codes.length) localStorage.setItem(SUBLANGS_KEY, codes.join(","));
    else localStorage.removeItem(SUBLANGS_KEY);
  } catch {
    /* ignore */
  }
}

// --- option lists (used by Settings) ---------------------------------------
// `value` is the lowercase substring tested against a source's language label.
export const LANG_PREFS: { value: string; label: string }[] = [
  { value: "", label: "—" }, // rendered as "Any" via i18n
  { value: "german", label: "Deutsch / German" },
  { value: "english", label: "English" },
  { value: "japanese", label: "日本語 / Japanese" },
  { value: "spanish", label: "Español / Spanish" },
  { value: "french", label: "Français / French" },
  { value: "italian", label: "Italiano / Italian" },
];

export const DUB_SUB_OPTS: { value: DubSub; key: string }[] = [
  { value: "any", key: "set.dubAny" },
  { value: "dub", key: "set.dubbed" },
  { value: "sub", key: "set.subbed" },
];

// OpenSubtitles language codes + display labels for the subtitle picker.
export const SUBTITLE_LANGS: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "de", label: "German" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "it", label: "Italian" },
  { code: "pt-br", label: "Portuguese (BR)" },
  { code: "ja", label: "Japanese" },
  { code: "ru", label: "Russian" },
  { code: "ar", label: "Arabic" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
  { code: "tr", label: "Turkish" },
];

/**
 * Index of the first source that satisfies the language + dub/sub preferences,
 * or -1 when none does (the caller then keeps the first-loaded source). A source
 * matches when its label contains the preferred language word AND the dub/sub
 * word ("any" is a wildcard). With no preferences set, returns -1.
 */
export function preferredIndex(
  sources: { language?: string | null }[],
  prefs: { lang?: string; dubSub?: DubSub } = { lang: getLangPref(), dubSub: getDubSub() },
): number {
  const lang = (prefs.lang ?? "").toLowerCase();
  const dubSub = prefs.dubSub ?? "any";
  if (!lang && dubSub === "any") return -1;
  return sources.findIndex((s) => {
    const l = (s.language || "").toLowerCase();
    const langOk = !lang || l.includes(lang);
    const dubOk = dubSub === "any" || l.includes(dubSub); // "dub" / "sub"
    return langOk && dubOk;
  });
}
