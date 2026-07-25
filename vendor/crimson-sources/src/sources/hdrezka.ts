/*
 * HDRezka — Western + Russian-dub movies/TV with direct quality-tagged files,
 * external subtitles, and MANY audio tracks per title (client port of
 * movie-web/providers `sources/hdrezka`, extended to surface every dub).
 *
 * Flow (proven live 2026-06-30, "Oppenheimer 2023"):
 *   1. GET /engine/ajax/search.php?q=<title>  (X-Hdrezka-Android-App headers make
 *      hdrezka return UN-obfuscated stream URLs, sparing us the clearTrash decoder)
 *      → results "<a href=URL><span class=enty>RU title</span> (EN title, YEAR)"
 *      → pick by (EN title, YEAR) against the MediaCtx.
 *   2. GET the title page → the `<li class=b-translator__item title="<dub name>"
 *      data-translator_id=N>` list = every audio track (dub studios + original+subs,
 *      id 238). Single-audio titles instead carry `sof.tv.initCDN…Events(id, N)`.
 *   3. POST /ajax/get_cdn_series/ per translator (action=get_movie | get_stream with
 *      season/episode) → JSON `{url:"[1080p]http…mp4,[720p]…", subtitle:"[English]…"}`.
 *      → one tile PER dub (the user wants language choice, not a random dub), best
 *      quality each, grouped under "HDRezka" with the dub name as the language.
 *
 * Why E3-only: the final CDN file is bound to the resolving IP (movie-web's
 * IP_LOCKED). A datacenter resolve returns `url:false`; only the viewer's residential
 * browser (the companion, E3) gets a playable URL — `needsResidentialIP` excludes the
 * E2 proxy. The scraping calls also lack ACAO (`needsCORSBypass`). No server secret
 * (the Android-app headers are public), so it never touches the backend — it's purely
 * a crimson-sources + extension source. With no extension it simply doesn't surface
 * (no backend E0 port — by design, this is a frontend-only revival).
 */
import { preparePlayback } from "../playback";
import { NO_FLAGS } from "../types";
import { parseHtml, attr, elText } from "../util/dom";
import { candidateTitles, normalizeTitle } from "../util/text";
import { dlog, dwarn } from "../util/debug";
import type { ResolvedStream, Source, SourceContext, SubtitleTrack } from "../types";

const REZKA_BASE = "https://hdrezka.ag"; // redirects to the live canonical host; fetchers follow it
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const ANDROID_HEADERS = {
  "X-Hdrezka-Android-App": "1",
  "X-Hdrezka-Android-App-Version": "2.2.0",
  "User-Agent": UA,
};

// Cap the dub tiles per title (Oppenheimer alone has ~12). Best-effort breadth
// without firing a dozen concurrent POSTs; original+subs is always kept.
const MAX_DUBS = 8;
// Quality preference, best first (we surface one tile per dub at its best file).
const QUALITY_ORDER = ["2160p", "1440p", "1080p", "720p", "480p", "360p", "240p"];

interface SearchResult {
  url: string;
  id: string;
  year: number | null;
}

interface Translator {
  id: string;
  /** Display name from the `title` attr ("Дубляж", "LostFilm", …); 238 = original+subs. */
  name: string;
}

/** Map of quality label -> direct file URL, parsed from the `url` field. */
type Qualities = Record<string, string>;

// --- helpers (ports of movie-web's hdrezka/utils.ts) -----------------------

/** A random UUID-shaped `favs` token the get_cdn_series endpoint requires. */
function randomFavs(): string {
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  const seg = (n: number) => Array.from({ length: n }, hex).join("");
  return `${seg(8)}-${seg(4)}-${seg(4)}-${seg(4)}-${seg(12)}`;
}

/** "Oppenheimer, 2023" -> {title, year}. */
function extractTitleAndYear(input: string): { title: string; year: number | null } | null {
  const m = input.match(/^(.*?),.*?(\d{4})/);
  if (!m) return null;
  return { title: m[1]!.trim(), year: m[2] ? parseInt(m[2], 10) : null };
}

/** `"[1080p]https://…mp4,[720p]https://…mp4 or https://…mp4"` -> {1080p: url, …}.
 *  The Android header yields plain URLs; we take the first file per quality. */
function parseVideoLinks(input?: string): Qualities {
  const out: Qualities = {};
  if (!input) return out;
  for (const part of input.split(",")) {
    const m = part.match(/\[([^\]]+)\](https?:\/\/[^\s,]+?\.(?:mp4|m3u8))/);
    if (!m) continue;
    const q = m[1]!.match(/(\d+p)/)?.[1] ?? "Unknown";
    if (!out[q]) out[q] = m[2]!; // first (best mirror) wins per quality
  }
  return out;
}

/** `"[English]https://…vtt,[Russian]https://…srt"` -> SubtitleTrack[]. */
function parseSubtitles(input?: string | boolean): SubtitleTrack[] {
  if (!input || typeof input === "boolean") return [];
  const out: SubtitleTrack[] = [];
  for (const link of input.split(",")) {
    const m = link.match(/\[([^\]]+)\](https?:\/\/\S+?)(?=,\[|$)/);
    if (!m) continue;
    const label = m[1]!.trim();
    out.push({ url: m[2]!, lang: label.slice(0, 2).toLowerCase(), label });
  }
  return out;
}

/** The best available quality URL from a parsed quality map. */
function bestQuality(q: Qualities): { url: string; quality: string } | null {
  for (const want of QUALITY_ORDER) {
    if (q[want]) return { url: q[want]!, quality: want };
  }
  const keys = Object.keys(q);
  return keys.length ? { url: q[keys[0]!]!, quality: keys[0]! } : null;
}

/** A clean dub label; map the special original+subtitles track (id 238). */
function dubLabel(t: Translator): string {
  if (t.id === "238") return "Original + Subs";
  return t.name || `Track ${t.id}`;
}

// --- scraping steps --------------------------------------------------------

async function findMedia(ctx: SourceContext): Promise<SearchResult | null> {
  const titles = candidateTitles(ctx.ctx);
  if (titles.length === 0 && ctx.ctx.title) titles.push(ctx.ctx.title);
  const wantYear = ctx.ctx.releaseYear ?? null;
  const wantType = ctx.ctx.mediaType; // "tv" | "movie"

  for (const title of titles.slice(0, 3)) {
    let res;
    try {
      res = await ctx.fetcher.fetch(
        `${REZKA_BASE}/engine/ajax/search.php?q=${encodeURIComponent(title)}`,
        { headers: ANDROID_HEADERS },
      );
    } catch (e) {
      dwarn(`hdrezka: search "${title}" threw`, e);
      continue;
    }
    if (!res.ok || res.bodyEncoding !== "text") continue;

    const itemRe =
      /<a href="([^"]+)"><span class="enty">([^<]+)<\/span> \(([^)]+)\)/g;
    const candidates: SearchResult[] = [];
    for (const m of res.body.matchAll(itemRe)) {
      const url = m[1]!;
      const ty = extractTitleAndYear(m[3]!);
      if (!ty) continue;
      const id = url.match(/\/(\d+)-[^/]+\.html$/)?.[1] ?? "";
      if (!id) continue;
      // hdrezka URLs encode type: /films|cartoons/ = movie, /series|animation/ = tv.
      const isShow = /\/(series|animation|tv-show)\//i.test(url);
      const matchesType = wantType === "tv" ? isShow : !isShow;
      candidates.push({ url, id, year: ty.year });
      // Prefer exact (type + year); fall back later.
      if (matchesType && (wantYear == null || ty.year === wantYear)) {
        dlog(`hdrezka: matched ${url} (${ty.title}, ${ty.year})`);
        return { url, id, year: ty.year };
      }
    }
    // No exact type+year hit this keyword: take a year match if we have one.
    if (wantYear != null) {
      const byYear = candidates.find((c) => c.year === wantYear);
      if (byYear) return byYear;
    }
    if (candidates.length) return candidates[0]!;
  }
  return null;
}

async function getTranslators(pageUrl: string, id: string, ctx: SourceContext): Promise<Translator[]> {
  let res;
  try {
    res = await ctx.fetcher.fetch(pageUrl, { headers: ANDROID_HEADERS });
  } catch (e) {
    dwarn("hdrezka: title page threw", e);
    return [];
  }
  if (!res.ok || res.bodyEncoding !== "text") return [];
  const html = res.body;

  const doc = parseHtml(html);
  const items = doc.all(".b-translator__item");
  const out: Translator[] = [];
  for (const el of items) {
    const tid = attr(el, "data-translator_id");
    if (!tid) continue;
    // Skip cam-quality rips — they're the worst tier and clutter the dub list.
    if (attr(el, "data-camrip") === "1") continue;
    const name = (el.getAttribute("title") || elText(el)).trim();
    out.push({ id: tid, name });
  }
  if (out.length > 0) {
    // Float the original+subtitles track to the front (most-wanted in a West/EN ctx).
    out.sort((a, b) => (a.id === "238" ? -1 : b.id === "238" ? 1 : 0));
    return out;
  }

  // Single-audio title: no translator list — pull the one id from the CDN init call.
  const fn = ctx.ctx.mediaType === "movie" ? "initCDNMoviesEvents" : "initCDNSeriesEvents";
  const m = html.match(new RegExp(`sof\\.tv\\.${fn}\\(${id}, ([0-9]+)`, "i"));
  if (m) return [{ id: m[1]!, name: "Original" }];
  // Last resort: the original+subs translator is present on most titles.
  if (html.includes('data-translator_id="238"')) return [{ id: "238", name: "Original + Subs" }];
  return [];
}

async function resolveTranslator(
  sr: SearchResult,
  t: Translator,
  ctx: SourceContext,
): Promise<ResolvedStream | null> {
  const params = new URLSearchParams();
  params.append("id", sr.id);
  params.append("translator_id", t.id);
  if (ctx.ctx.mediaType === "tv") {
    params.append("season", String(ctx.ctx.season ?? 1));
    params.append("episode", String(ctx.ctx.episode ?? 1));
    params.append("action", "get_stream");
  } else {
    params.append("is_camprip", "0");
    params.append("is_ads", "0");
    params.append("is_director", "0");
    params.append("action", "get_movie");
  }
  params.append("favs", randomFavs());

  let res;
  try {
    res = await ctx.fetcher.fetch(`${REZKA_BASE}/ajax/get_cdn_series/`, {
      method: "POST",
      headers: { ...ANDROID_HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
  } catch (e) {
    dwarn(`hdrezka: get_cdn_series (tr ${t.id}) threw`, e);
    return null;
  }
  if (!res.ok || res.bodyEncoding !== "text") return null;

  let data: { url?: string | false; subtitle?: string | boolean };
  try {
    data = JSON.parse(res.body);
  } catch {
    return null;
  }
  if (!data.url || typeof data.url !== "string") return null; // url:false = IP-gated / no track

  const best = bestQuality(parseVideoLinks(data.url));
  if (!best) return null;

  // The CDN file is IP-locked to this (residential) resolve; deliver via E3 DNR
  // rules carrying the hdrezka referer/UA. mp4 (occasionally m3u8) per quality.
  const streamType = best.url.includes(".m3u8") ? "hls" : "mp4";
  const handle = await preparePlayback(
    ctx.env,
    best.url,
    { referer: `${REZKA_BASE}/`, userAgent: UA },
    streamType,
  );
  if (!handle) return null;

  const subtitles = parseSubtitles(data.subtitle);
  return {
    label: `HDRezka (${dubLabel(t)})`,
    streamType: handle.streamType,
    url: handle.url,
    language: dubLabel(t),
    subtitles: subtitles.length ? subtitles : null,
    mediaRules: handle.mediaRules,
  };
}

export const hdrezka: Source = {
  id: "hdrezka",
  label: "HDRezka",
  supportsMovies: true,
  // Final file is IP-locked (C4) -> E3/residential only (excludes the E2 datacenter
  // proxy); scraping responses lack ACAO (C1). No secret. Routes E3-only.
  flags: { ...NO_FLAGS, needsCORSBypass: true, needsHeaderInjection: true, needsResidentialIP: true },

  async resolve(ctx: SourceContext): Promise<ResolvedStream[]> {
    const media = await findMedia(ctx);
    if (!media) {
      dlog("hdrezka: no title match");
      return [];
    }

    const translators = await getTranslators(media.url, media.id, ctx);
    if (translators.length === 0) {
      dlog("hdrezka: no translators found");
      return [];
    }
    dlog(`hdrezka: ${translators.length} dub track(s), resolving up to ${MAX_DUBS}`);

    const picked = translators.slice(0, MAX_DUBS);
    const results = await Promise.all(picked.map((t) => resolveTranslator(media, t, ctx)));
    return results.filter((s): s is ResolvedStream => s !== null);
  },
};
