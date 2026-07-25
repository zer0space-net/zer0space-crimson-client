/*
 * MangaDex — the client-side manga resolver (the reading counterpart of the video
 * sources). The public crimson-backend never talks to a manga host; discovery +
 * metadata come from AniList server-side, and THIS runs in the viewer's browser to
 * turn an AniList title into a chapter list and a chapter into its page images.
 *
 * MangaDex's API is free + key-less but does NOT answer ACAO for a third-party
 * origin, so the three JSON calls (search / chapter feed / @Home) need a CORS bypass
 * (C1) — handled by the extension (E3) or the signed crimson-proxy (E2), exactly
 * like the header-only video sources. The page IMAGES need no proxy at all: they're
 * dropped straight into an `<img>` (image loads aren't subject to CORS), so we hand
 * back the raw `*.mangadex.network` URLs and keep the bytes entirely off our backend.
 *
 * Ported from the (now private) backend resolver: same search → feed → @Home stages,
 * same chapter de-dup, same external-chapter drop — so a client-resolved chapter list
 * is identical to what the server-side provider produces.
 */
import type { Fetcher, SourceFlags } from "../types";
import { NO_FLAGS } from "../types";

const API_BASE = "https://api.mangadex.org";

/** C1 only: MangaDex needs a CORS bypass but no forbidden headers / JA3 / secret.
 *  → routes to the extension (E3) or the signed proxy (E2); never plain E1. */
export const MANGA_FLAGS: SourceFlags = { ...NO_FLAGS, needsCORSBypass: true };

export interface MangaChapter {
  id: string;
  chapter: string | null;
  volume: string | null;
  title: string | null;
  pages: number;
  language: string;
  published_at: string | null;
}

function qs(pairs: Array<[string, string]>): string {
  // URLSearchParams keeps repeated keys (contentRating[], translatedLanguage[]),
  // which the MangaDex API relies on — a plain object would collapse them.
  const p = new URLSearchParams();
  for (const [k, v] of pairs) p.append(k, v);
  return p.toString();
}

async function apiGet(fetcher: Fetcher, path: string, pairs: Array<[string, string]>): Promise<unknown> {
  const url = `${API_BASE}${path}?${qs(pairs)}`;
  let res;
  try {
    res = await fetcher.fetch(url, { method: "GET", responseType: "text" });
  } catch {
    return null;
  }
  if (!res.ok || res.bodyEncoding !== "text") return null;
  try {
    return JSON.parse(res.body);
  } catch {
    return null;
  }
}

/**
 * Best-match MangaDex manga id for a list of candidate titles (romaji, english,
 * native, synonyms — in priority order). Returns the first title that yields any
 * result; null if nothing matches. `contentRating` mirrors the backend config.
 */
export async function resolveMangaId(
  fetcher: Fetcher,
  titles: string[],
  contentRating: string[],
): Promise<string | null> {
  const seen = new Set<string>();
  for (const raw of titles) {
    const t = (raw || "").trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    const pairs: Array<[string, string]> = [
      ["title", t],
      ["limit", "5"],
      ["order[relevance]", "desc"],
    ];
    for (const r of contentRating) pairs.push(["contentRating[]", r]);
    const data = (await apiGet(fetcher, "/manga", pairs)) as { data?: Array<{ id?: string }> } | null;
    const first = data?.data?.[0]?.id;
    if (first) return first;
  }
  return null;
}

/**
 * Ordered readable chapters for a manga in one language. Paginates the feed, drops
 * external-only chapters (hosted off MangaDex — no page images we can show), and
 * collapses duplicate chapter numbers to the first scanlation, identical to the
 * backend provider.
 */
export async function getChapters(
  fetcher: Fetcher,
  mangaId: string,
  language: string,
  contentRating: string[],
): Promise<MangaChapter[]> {
  if (!mangaId) return [];
  const out: MangaChapter[] = [];
  const seenNumbers = new Set<string>();
  const pageSize = 100;
  let offset = 0;
  // Hard cap: even long-running series rarely exceed a few thousand chapters.
  for (let i = 0; i < 50; i++) {
    const pairs: Array<[string, string]> = [
      ["translatedLanguage[]", language],
      ["order[volume]", "asc"],
      ["order[chapter]", "asc"],
      ["limit", String(pageSize)],
      ["offset", String(offset)],
      ["includes[]", "scanlation_group"],
    ];
    for (const r of contentRating) pairs.push(["contentRating[]", r]);
    const data = (await apiGet(fetcher, `/manga/${mangaId}/feed`, pairs)) as {
      data?: Array<{ id?: string; attributes?: Record<string, unknown> }>;
      total?: number;
    } | null;
    if (!data) break;
    const items = data.data || [];
    for (const ch of items) {
      const attrs = (ch.attributes || {}) as Record<string, unknown>;
      // External chapters carry an externalUrl and no pages we can relay — skip.
      if (attrs.externalUrl) continue;
      const pages = Number(attrs.pages) || 0;
      if (!pages) continue;
      const number = (attrs.chapter as string | null) ?? null;
      // Collapse duplicate chapter numbers (multiple scanlations) to the first.
      const dedupKey = number != null ? number : `__oneshot__${ch.id}`;
      if (seenNumbers.has(dedupKey)) continue;
      seenNumbers.add(dedupKey);
      out.push({
        id: String(ch.id),
        chapter: number,
        volume: (attrs.volume as string | null) ?? null,
        title: (attrs.title as string | null) || null,
        pages,
        language: (attrs.translatedLanguage as string) || language,
        published_at: (attrs.publishAt as string | null) ?? null,
      });
    }
    const total = data.total || 0;
    offset += pageSize;
    if (offset >= total || items.length === 0) break;
  }
  return out;
}

/**
 * Ordered RAW page-image URLs for one chapter, via the MangaDex @Home server. These
 * go straight into an `<img src>` — no proxy, no signing: image loads aren't subject
 * to CORS, so the bytes flow CDN → viewer, never through our backend.
 */
export async function getChapterPages(
  fetcher: Fetcher,
  chapterId: string,
  dataSaver = false,
): Promise<string[]> {
  if (!chapterId) return [];
  const data = (await apiGet(fetcher, `/at-home/server/${chapterId}`, [])) as {
    baseUrl?: string;
    chapter?: { hash?: string; data?: string[]; dataSaver?: string[] };
  } | null;
  if (!data) return [];
  const base = (data.baseUrl || "").replace(/\/+$/, "");
  const hash = data.chapter?.hash;
  const quality = dataSaver ? "data-saver" : "data";
  const files = (dataSaver ? data.chapter?.dataSaver : data.chapter?.data) || [];
  if (!base || !hash || files.length === 0) return [];
  return files.map((fname) => `${base}/${quality}/${hash}/${fname}`);
}
