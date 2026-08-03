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
  "news.title": "Neu & Angesagt",
  "news.new": "NEU",
  "news.all": "Alle",
  "news.anime": "Anime",
  "news.series": "Serien",
  "news.movies": "Filme",
  "browse.new": "Neu",
  "browse.popular": "Beliebt",
  "browse.filter": "Kategorie",
  "ov.available": "Verfügbar",
  "ov.audio": "Ton",
  "ov.subs": "Untertitel",

  "nav.library": "Merkliste",
  "nav.search": "Suche",
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
  "search.submit": "Suchen",
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
  "watch.nextEp": "Nächste Folge",
  "watch.prevEp": "Vorherige",

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
  "set.langPref": "Bevorzugte Sprache",
  "set.langPrefHint": "Quellen in dieser Sprache werden automatisch gewählt, wenn verfügbar.",
  "set.langAny": "Egal",
  "set.dubSub": "Synchro oder Untertitel",
  "set.dubSubHint": "Ob du lieber synchronisierten Ton oder untertitelte Originale möchtest.",
  "set.dubAny": "Egal",
  "set.dubbed": "Synchronisiert",
  "set.subbed": "Untertitelt",
  "set.subLangs": "Untertitel-Sprachen",
  "set.subLangsHint":
    "Passende Untertitel von OpenSubtitles ins Untertitel-Menü des Players holen — praktisch, wenn eine Quelle keine mitliefert. Beliebig viele wählen; alle aus = keine.",
  "set.savedAuto": "Automatisch gespeichert",
  "set.autoplayNote":
    "Quellen mit deiner bevorzugten Sprache werden automatisch gestartet, sobald eine verfügbar ist; sonst spielt die zuerst geladene Quelle.",

  "lib.search": "In der Merkliste suchen …",
  "lib.newList": "Neue Liste",
  "lib.newListPrompt": "Name der neuen Liste",
  "lib.create": "Erstellen",
  "lib.export": "Export",
  "lib.exportCsv": "CSV (Snapshot)",
  "lib.exportJson": "JSON (Backup)",
  "lib.import": "Importieren",
  "lib.importMerge": "Zusammenführen",
  "lib.importReplace": "Ersetzen",
  "lib.chooseFile": "Datei wählen …",
  "lib.mergeHint": "Fügt zu deinen bestehenden Listen hinzu.",
  "lib.replaceHint": "Löscht zuerst alle deine Listen und stellt dann die Datei wieder her.",
  "lib.imported": "{n} importiert.",
  "lib.importFail": "Import fehlgeschlagen — bitte eine Crimson-CSV/JSON-Datei wählen.",
  "lib.count": "{n} Titel",
  "lib.noMatch": "Keine Treffer.",
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
  "news.title": "New & Trending",
  "news.new": "NEW",
  "news.all": "All",
  "news.anime": "Anime",
  "news.series": "Series",
  "news.movies": "Movies",
  "browse.new": "New",
  "browse.popular": "Popular",
  "browse.filter": "Category",
  "ov.available": "Available",
  "ov.audio": "Audio",
  "ov.subs": "Subtitles",

  "nav.library": "Watchlist",
  "nav.search": "Search",
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
  "search.submit": "Search",
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
  "watch.nextEp": "Next episode",
  "watch.prevEp": "Previous",

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
  "set.langPref": "Preferred Language",
  "set.langPrefHint": "Sources in this language are auto-selected when available.",
  "set.langAny": "Any",
  "set.dubSub": "Dub or Sub",
  "set.dubSubHint": "Whether you prefer dubbed audio or subtitled originals.",
  "set.dubAny": "Any",
  "set.dubbed": "Dubbed",
  "set.subbed": "Subbed",
  "set.subLangs": "Subtitle Languages",
  "set.subLangsHint":
    "Pull matching subtitles from OpenSubtitles into the player's caption menu — handy when a source ships none. Pick any number; leave all off to skip them.",
  "set.savedAuto": "Saved automatically",
  "set.autoplayNote":
    "Sources matching your preferred language auto-play whenever one is available; otherwise the first source to load plays.",

  "lib.search": "Search your watchlist …",
  "lib.newList": "New list",
  "lib.newListPrompt": "Name for the new list",
  "lib.create": "Create",
  "lib.export": "Export",
  "lib.exportCsv": "CSV (snapshot)",
  "lib.exportJson": "JSON (backup)",
  "lib.import": "Import",
  "lib.importMerge": "Merge",
  "lib.importReplace": "Replace",
  "lib.chooseFile": "Choose file …",
  "lib.mergeHint": "Adds to your existing lists.",
  "lib.replaceHint": "Clears all your lists first, then restores the file.",
  "lib.imported": "{n} imported.",
  "lib.importFail": "Import failed — pick a Crimson CSV/JSON file.",
  "lib.count": "{n} titles",
  "lib.noMatch": "No matches.",
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
