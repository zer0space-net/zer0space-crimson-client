/*
 * WeebCentral — a second client-side manga resolver, sibling of mangadex.ts.
 *
 * Same three stages as MangaDex (find id → list chapters → fetch page images), but
 * WeebCentral is an HTMX site: every stage answers with an HTML *fragment*, not JSON,
 * so we scrape it with small regexes instead of `JSON.parse`. Like MangaDex the three
 * HTML calls hit a foreign origin that answers no ACAO, so they need a CORS bypass
 * (C1) — routed to the extension (E3) or the signed crimson-proxy (E2), never plain
 * E1. The page IMAGES need no proxy at all: WeebCentral's CDN (`scans.lastation.us`)
 * has no hotlink protection (verified: loads with no Referer / a foreign Referer), so
 * the raw URLs drop straight into an `<img>` and the bytes stay entirely off our
 * backend — identical posture to the MangaDex `@Home` URLs.
 *
 * Endpoints (all GET, all HTML fragments):
 *   search    /search/data?...&text={title}        → first `/series/{ULID}/…` href
 *   chapters  /series/{id}/full-chapter-list        → `/chapters/{ULID}` anchors
 *   pages     /chapters/{id}/images?...             → `<img src="…scans…">`
 *
 * IDs are ULIDs (`01J76XY…`) — opaque strings, the same shape the engine's tagged
 * chapter ids and the reader's `chapterId` route param already carry.
 */
import type { Fetcher, SourceFlags } from "../types";
import { NO_FLAGS } from "../types";
import type { MangaChapter } from "./mangadex";

const BASE = "https://weebcentral.com";

/** C1 only: the HTML fragments need a CORS bypass, nothing else (no forbidden
 *  headers / JA3 / secret) — routes to the extension (E3) or the signed proxy (E2),
 *  exactly like MANGA_FLAGS. */
export const WEEBCENTRAL_FLAGS: SourceFlags = { ...NO_FLAGS, needsCORSBypass: true };

/** Fetch one HTML fragment as text; null on any transport/non-200. */
async function htmlGet(fetcher: Fetcher, url: string): Promise<string | null> {
  let res;
  try {
    res = await fetcher.fetch(url, { method: "GET", responseType: "text" });
  } catch {
    return null;
  }
  if (!res.ok || res.bodyEncoding !== "text") return null;
  return res.body;
}

/**
 * Best-match WeebCentral series id for a list of candidate titles (romaji, english,
 * native, synonyms — in priority order). Returns the first title that yields any
 * result; null if nothing matches. `contentRating` is accepted for signature parity
 * with the MangaDex source but unused — WeebCentral's search has no rating facet.
 */
export async function resolveMangaId(
  fetcher: Fetcher,
  titles: string[],
  _contentRating: string[],
): Promise<string | null> {
  const seen = new Set<string>();
  for (const raw of titles) {
    const t = (raw || "").trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    // Fixed facets mirror the site's own "Best Match" search; URLSearchParams encodes
    // spaces as "+", so normalise to %20 to match the exact request WeebCentral serves.
    const params = new URLSearchParams({
      limit: "8",
      offset: "0",
      sort: "Best Match",
      order: "Descending",
      official: "Any",
      display_mode: "Full Display",
      text: t,
    }).toString().replace(/\+/g, "%20");
    const html = await htmlGet(fetcher, `${BASE}/search/data?${params}`);
    if (!html) continue;
    // First result's series link → its ULID. Both the cover and the title anchor
    // carry the same /series/{ID}/ href, so the first match is the top result.
    const m = html.match(/\/series\/([0-9A-Za-z]{20,})/);
    if (m && m[1]) return m[1];
  }
  return null;
}

/**
 * Ordered readable chapters for a WeebCentral series (oldest → newest, so index 0 is
 * chapter 1 and the reader's chapter ordinal == index + 1, matching MangaDex). The
 * full-chapter-list fragment lists newest-first, so we reverse it. `language` /
 * `contentRating` are accepted for parity but unused — WeebCentral scanlations are a
 * single (English) track with no rating facet.
 */
export async function getChapters(
  fetcher: Fetcher,
  mangaId: string,
  language: string,
  _contentRating: string[],
): Promise<MangaChapter[]> {
  if (!mangaId) return [];
  const html = await htmlGet(fetcher, `${BASE}/series/${mangaId}/full-chapter-list`);
  if (!html) return [];

  const out: MangaChapter[] = [];
  // Each chapter is an <a href=".../chapters/{ULID}" …> … </a> block carrying a
  // display-name span (`<span class="">Chapter 234</span>` / `Episode. 81`) and a
  // <time datetime="…">. Match each anchor block, then pull the pieces from it.
  const anchor = /<a\s+href="[^"]*\/chapters\/([0-9A-Za-z]{20,})"[^>]*>([\s\S]*?)<\/a>/g;
  let a: RegExpExecArray | null;
  while ((a = anchor.exec(html)) !== null) {
    const id = a[1];
    if (!id) continue;
    const block = a[2] ?? "";
    const nameMatch = block.match(/<span class="">([^<]+)<\/span>/);
    const label = nameMatch?.[1]?.trim() ?? "";
    const timeMatch = block.match(/<time[^>]*datetime="([^"]+)"/);
    // Chapter number = the last numeric token in the label ("Chapter 234" → 234,
    // "Episode. 81" → 81, "Vol.2 Chapter 5" → 5). Decimals kept ("10.5").
    const nums = label.match(/\d+(?:\.\d+)?/g);
    const number = nums && nums.length ? (nums[nums.length - 1] ?? null) : null;
    out.push({
      id,
      chapter: number,
      volume: null,
      // WeebCentral labels ARE the chapter number ("Chapter 234"), so a separate
      // title would just duplicate it — keep the raw label only when it has no number
      // (named oneshots/specials) so the reader still shows something meaningful.
      title: number == null && label ? label : null,
      pages: 0, // not known until the images fragment is fetched
      language: language || "en",
      published_at: timeMatch?.[1] ?? null,
    });
  }
  // Fragment is newest-first; reverse to ascending so ordinals line up with MangaDex.
  out.reverse();
  return out;
}

/**
 * Ordered RAW page-image URLs for one chapter, from the long-strip images fragment.
 * These go straight into an `<img src>` — no proxy, no signing (image loads aren't
 * subject to CORS), so the bytes flow CDN → viewer, never through our backend.
 * `dataSaver` is accepted for parity but unused — WeebCentral serves a single quality.
 */
export async function getChapterPages(
  fetcher: Fetcher,
  chapterId: string,
  _dataSaver = false,
): Promise<string[]> {
  if (!chapterId) return [];
  const html = await htmlGet(
    fetcher,
    `${BASE}/chapters/${chapterId}/images?is_prev=False&current_page=1&reading_style=long_strip`,
  );
  if (!html) return [];
  const pages: string[] = [];
  const img = /<img[^>]+src="(https?:\/\/[^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = img.exec(html)) !== null) {
    if (m[1]) pages.push(m[1]);
  }
  return pages;
}
