/*
 * Title-matching text helpers — the TS counterpart of the `_normalize` /
 * `_slugify` / `_series_root` / keyword logic shared by the backend's discovery
 * scrapers (aniworld / s.to / aniwatch). Kept byte-for-byte equivalent so a slug
 * the backend would compute is the slug we compute, and a title the backend would
 * match we match too.
 */

/** Decode the handful of HTML entities the scraped markup actually carries. */
export function htmlUnescape(text: string): string {
  if (!text) return "";
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

/** NFKD de-accent + drop non-ASCII, mirroring Python's
 *  `unicodedata.normalize("NFKD", t).encode("ascii", "ignore")`. */
function deAccentAscii(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining marks
    .replace(/[^\x00-\x7f]/g, ""); // drop anything still non-ASCII
}

/**
 * Loose, comparable form of a title: HTML-unescaped, tag-stripped, de-accented,
 * lowercased, reduced to single-spaced alphanumerics. Equivalent to the backend
 * scrapers' `_normalize`.
 */
export function normalizeTitle(text: string | null | undefined): string {
  let t = htmlUnescape(text ?? "");
  t = t.replace(/<[^>]+>/g, ""); // drop <em>…</em> match highlights
  t = deAccentAscii(t);
  t = t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return t;
}

/**
 * Best-effort reproduction of the s.to-family slug convention, e.g.
 * "Frieren: Beyond Journey's End" -> "frieren-beyond-journeys-end". Equivalent to
 * the backend scrapers' `_slugify`.
 */
export function slugifyTitle(text: string | null | undefined): string {
  let t = htmlUnescape(text ?? "");
  t = deAccentAscii(t);
  t = t.toLowerCase().replace(/'/g, "").replace(/&/g, " ");
  t = t.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return t;
}

const STOPWORDS = new Set(["the", "a", "an"]);

const SEQUEL_MARKERS = new Set([
  "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x",
  "1st", "2nd", "3rd", "4th", "5th", "6th",
  "season", "part", "cour",
]);

/**
 * Strip trailing season/sequel markers off a normalized title, e.g.
 * "overlord iv" -> "overlord", "kaguya sama season 3" -> "kaguya sama". Returns ""
 * when nothing distinctive (>=3 chars) is left. Equivalent to `_series_root`.
 */
export function seriesRoot(normTitle: string): string {
  const words = normTitle.split(" ").filter(Boolean);
  while (words.length && (/^\d+$/.test(words[words.length - 1]!) || SEQUEL_MARKERS.has(words[words.length - 1]!))) {
    words.pop();
  }
  const root = words.join(" ");
  return root.length >= 3 ? root : "";
}

/**
 * Ordered, de-duplicated candidate titles from a MediaCtx-style title set,
 * English first, then the other AniList variants and synonyms — the exact order
 * the backend scrapers build (`title_english`, `title`, `title_romaji`,
 * `title_native`, …synonyms).
 */
export function candidateTitles(t: {
  titleEnglish?: string | null;
  title?: string | null;
  titleRomaji?: string | null;
  titleNative?: string | null;
  synonyms?: string[] | null;
}): string[] {
  const out: string[] = [];
  const push = (v: string | null | undefined) => {
    if (v && !out.includes(v)) out.push(v);
  };
  push(t.titleEnglish);
  push(t.title);
  push(t.titleRomaji);
  push(t.titleNative);
  for (const s of t.synonyms ?? []) push(s);
  return out;
}

/**
 * Ordered, de-duplicated search keywords from the candidate titles. The
 * s.to-family search returns nothing for long, punctuated queries, so for each
 * title we offer the subtitle-stripped base, a short leading-words form, the full
 * normalized title, and the bare series root. `minLen` gates short queries that
 * some endpoints (s.to suggest) reject. Equivalent to `_search_keywords`.
 */
export function searchKeywords(candidates: string[], opts?: { limit?: number; minLen?: number }): string[] {
  const limit = opts?.limit ?? 6;
  const minLen = opts?.minLen ?? 0;
  const keywords: string[] = [];
  const add = (v: string) => {
    if (v && v.length >= minLen && !keywords.includes(v)) keywords.push(v);
  };
  for (const title of candidates) {
    const base = title.split(":")[0]!; // drop trailing ": Subtitle"
    const normBase = normalizeTitle(base);
    const words = normBase.split(" ").filter((w) => w && !STOPWORDS.has(w));
    add(normBase);
    add(words.slice(0, 3).join(" "));
    add(normalizeTitle(title));
    add(seriesRoot(normBase));
  }
  return keywords.slice(0, limit);
}

/**
 * Pick the slug whose normalized title matches one of `normCandidates`: exact
 * match first, then a length-guarded prefix containment (for "X" vs "X: Subtitle"
 * differences). Shared by every discovery source's result picker.
 */
export function pickByTitle(
  shows: Array<{ normTitle: string; slug: string }>,
  normCandidates: Set<string>,
): string | null {
  for (const { normTitle, slug } of shows) {
    if (normCandidates.has(normTitle)) return slug;
  }
  for (const { normTitle, slug } of shows) {
    for (const cand of normCandidates) {
      if (cand.length >= 5 && (normTitle.startsWith(cand) || cand.startsWith(normTitle))) {
        return slug;
      }
    }
  }
  return null;
}

/**
 * Pick the slug whose *series root* (season/sequel markers stripped) equals one of
 * `rootCandidates`. This is the safe match for sources that host every season under
 * ONE slug with the season in the URL path (the s.to family: `/serie/<slug>/staffel-N`,
 * `/anime/stream/<slug>/staffel-N`) — a base-series search hit ("Arifureta …") is the
 * right show for a "Season 3" request; the caller applies `/staffel-3/` afterwards.
 *
 * Only ever call this for those season-agnostic-slug sources: for a source whose slug
 * is season-specific it would wrongly collapse "… Season 3" onto season 1. The root
 * length floor guards against short, collision-prone roots ("ai", "go").
 */
export function pickByRoot(
  shows: Array<{ normTitle: string; slug: string }>,
  rootCandidates: Set<string>,
): string | null {
  if (rootCandidates.size === 0) return null;
  for (const { normTitle, slug } of shows) {
    const root = seriesRoot(normTitle);
    if (root.length >= 6 && rootCandidates.has(root)) return slug;
  }
  return null;
}
