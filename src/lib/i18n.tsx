import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

// Runtime DE/EN switch, mirroring the zer0space dashboard's approach: two flat
// dictionaries kept at parity, a t() that interpolates {slots}, and the choice
// persisted per-browser in localStorage. Same-origin as the dashboard, so we use
// a distinct key (zsc-lang) to avoid clobbering the dashboard's own preference.

export type Lang = "de" | "en";

const LANG_KEY = "zsc-lang";

type Dict = Record<string, string>;

const de: Dict = {
  "nav.home": "Start",
  "nav.catalogue": "Katalog",
  "nav.settings": "Einstellungen",
  "search.placeholder": "Suchen …",
  "common.loading": "Lädt …",
  "common.anime": "Anime",
  "common.back": "Zurück",
  "common.play": "▶ Abspielen",

  "foot.runsOn": "läuft auf dem",
  "foot.engineBackend": "Streaming-Engine & Backend:",
  "foot.uiBy": "Oberfläche & Betrieb: zer0space. Gehostet hinter",

  "home.eyebrow": "zer0space ✕ Crimson",
  "home.title": "Was läuft gerade",
  "home.sub": "Angetrieben vom Crimson-Haven-Backend, im zer0space-Universum.",
  "home.continue": "Weiterschauen",
  "home.forYou": "Für dich",
  "home.trendingAnime": "Angesagte Anime",
  "home.shows": "Serien",
  "home.movies": "Filme",

  "nav.library": "Merkliste",
  "lib.title": "Meine Merkliste",
  "lib.empty": "Noch nichts gemerkt.",
  "lib.all": "Alle",
  "ov.similar": "Ähnliche Titel",

  "cat.title": "Katalog",
  "cat.count": "{n} Titel im lokalen Index.",
  "cat.filter": "Im Katalog filtern …",
  "cat.none": "Keine Treffer.",
  "cat.loading": "Lade Katalog …",

  "search.title": "Suche",
  "search.resultsFor": "Ergebnisse für",
  "search.prompt": "Tippe oben einen Titel ein.",
  "search.searching": "Suche …",
  "search.nothing": "Nichts gefunden für",

  "ov.loading": "Lade Titel …",
  "ov.degraded": "eingeschränkte Daten",
  "ov.episodes": "Episoden",
  "ov.season": "Staffel {n}",
  "ov.epLoading": "Lade Episoden …",
  "ov.noEpisodes": "Keine Episoden gefunden.",

  "watch.title": "Wiedergabe",
  "watch.resolving": "Quellen werden aufgelöst …",
  "watch.noSourceReachable": "Keine Quelle erreichbar.",
  "watch.noSourceFound": "Keine Quelle gefunden.",
  "watch.unaired": "Noch nicht ausgestrahlt",
  "watch.unairedFor": "geplant für",
  "watch.moreSources": "Weitere Quellen werden noch gesucht …",
  "watch.local": "lokal",
  "watch.skipIntro": "Intro überspringen",
  "watch.skipOutro": "Outro überspringen",

  "fav.saved": "★ Gemerkt",
  "fav.save": "☆ Merken",

  "err.accessTag": "Zugang",
  "err.errorTag": "Fehler",
  "err.unauth": "Nicht angemeldet. Crimson ist nur über deine zer0space-Sitzung erreichbar.",
  "err.generic": "Da ist etwas schiefgelaufen. Versuch es gleich noch einmal.",

  "nf.title": "Verloren im Raum",
  "nf.sub": "Diese Seite gibt es nicht.",
  "nf.home": "Zur Startseite",

  "set.title": "Einstellungen",
  "set.language": "Sprache",
  "set.appearance": "Darstellung",
  "set.accent": "Akzentfarbe",
  "set.accentHint": "Färbt die ganze Oberfläche. Crimson ist die Standardfarbe.",
  "set.langPref": "Bevorzugte Audio-/Sprachversion",
  "set.langPrefHint": "Beim Abspielen wird, wenn vorhanden, zuerst diese Sprache gewählt.",
  "set.langAny": "Keine Vorliebe",
};

const en: Dict = {
  "nav.home": "Home",
  "nav.catalogue": "Catalogue",
  "nav.settings": "Settings",
  "search.placeholder": "Search …",
  "common.loading": "Loading …",
  "common.anime": "Anime",
  "common.back": "Back",
  "common.play": "▶ Play",

  "foot.runsOn": "runs on the",
  "foot.engineBackend": "Streaming engine & backend:",
  "foot.uiBy": "UI & hosting: zer0space. Served behind",

  "home.eyebrow": "zer0space ✕ Crimson",
  "home.title": "What's on",
  "home.sub": "Powered by the Crimson Haven backend, in the zer0space universe.",
  "home.continue": "Continue watching",
  "home.forYou": "For you",
  "home.trendingAnime": "Trending anime",
  "home.shows": "Shows",
  "home.movies": "Movies",

  "nav.library": "Watchlist",
  "lib.title": "My watchlist",
  "lib.empty": "Nothing saved yet.",
  "lib.all": "All",
  "ov.similar": "Similar titles",

  "cat.title": "Catalogue",
  "cat.count": "{n} titles in the local index.",
  "cat.filter": "Filter the catalogue …",
  "cat.none": "No matches.",
  "cat.loading": "Loading catalogue …",

  "search.title": "Search",
  "search.resultsFor": "Results for",
  "search.prompt": "Type a title above.",
  "search.searching": "Searching …",
  "search.nothing": "Nothing found for",

  "ov.loading": "Loading title …",
  "ov.degraded": "limited data",
  "ov.episodes": "Episodes",
  "ov.season": "Season {n}",
  "ov.epLoading": "Loading episodes …",
  "ov.noEpisodes": "No episodes found.",

  "watch.title": "Playback",
  "watch.resolving": "Resolving sources …",
  "watch.noSourceReachable": "No source reachable.",
  "watch.noSourceFound": "No source found.",
  "watch.unaired": "Not yet aired",
  "watch.unairedFor": "scheduled for",
  "watch.moreSources": "Still searching for more sources …",
  "watch.local": "local",
  "watch.skipIntro": "Skip intro",
  "watch.skipOutro": "Skip outro",

  "fav.saved": "★ Saved",
  "fav.save": "☆ Save",

  "err.accessTag": "Access",
  "err.errorTag": "Error",
  "err.unauth": "Not signed in. Crimson is only reachable through your zer0space session.",
  "err.generic": "Something went wrong. Please try again in a moment.",

  "nf.title": "Lost in space",
  "nf.sub": "This page doesn't exist.",
  "nf.home": "Back to home",

  "set.title": "Settings",
  "set.language": "Language",
  "set.appearance": "Appearance",
  "set.accent": "Accent colour",
  "set.accentHint": "Tints the whole UI. Crimson is the default.",
  "set.langPref": "Preferred audio / language",
  "set.langPrefHint": "When available, this language is picked first on playback.",
  "set.langAny": "No preference",
};

const DICTS: Record<Lang, Dict> = { de, en };

function initialLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === "de" || v === "en") return v;
  } catch {
    /* ignore */
  }
  // Fall back to the browser preference, default German (the project's default).
  return typeof navigator !== "undefined" && navigator.language?.startsWith("en") ? "en" : "de";
}

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = l;
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      let s = DICTS[lang][key] ?? DICTS.de[key] ?? key;
      if (vars) for (const k in vars) s = s.replace(`{${k}}`, String(vars[k]));
      return s;
    },
    [lang],
  );

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useI18n outside provider");
  return c;
}
