/*
 * kissanime.com.cv discovery source.
 *
 * A WordPress "animestream" anime site, structurally a sibling of aniwatch.co.at:
 * a `?s=` title search finds the show, whose per-season page lists episodes; each
 * episode page carries one `server-item` per language (SUB / DUB) whose base64
 * `data-hash` decodes to a gogoanime `streaming.php` embed. That gogo page in turn
 * iframes a `megaplay.buzz/stream/...` URL — the exact CDN the shared VidSrc
 * resolver handles — so we normalise the embed to its megaplay URL (one extra hop,
 * `megaplayUrlFromEmbed`) and resolve it there, surfacing any soft-subtitle tracks
 * megaplay exposes.
 *
 * The megaplay delivery CDN (cdn.mewstream.buzz) sits behind Cloudflare's bot WAF
 * and needs a real Chrome JA3 (C3) on top of Referer + the Sec-Fetch-* set (C2),
 * so — like aniwatch — this is E3-only (the extension fetches from a real browser),
 * with the backend (E0) as the floor (New_System §6).
 */
import { preparePlayback } from "../playback";
import { resolveVidsrc, megaplayUrlFromEmbed, MEGAPLAY_MEDIA_HEADERS } from "../resolvers/vidsrc";
import { parseHtml, attr, elText } from "../util/dom";
import { b64DecodeText } from "../util/base64";
import { candidateTitles, normalizeTitle, searchKeywords } from "../util/text";
import { dlog, dwarn } from "../util/debug";
import { NO_FLAGS } from "../types";
import type { Fetcher, ResolvedStream, Source, SourceContext } from "../types";

const BASE = "https://kissanime.com.cv";
const LANG_LABELS: Record<string, string> = { sub: "English Sub", dub: "English Dub" };
const LANG_PREFERENCE = ["sub", "dub"];

// The megaplay CDN gates its segments on the Sec-Fetch/Accept set (beyond
// Referer/Origin/UA); installed as media rules for the player's own fetches.
const SEC_FETCH_HEADERS = {
  Accept: MEGAPLAY_MEDIA_HEADERS["Accept"]!,
  "Accept-Language": MEGAPLAY_MEDIA_HEADERS["Accept-Language"]!,
  "Sec-Fetch-Dest": MEGAPLAY_MEDIA_HEADERS["Sec-Fetch-Dest"]!,
  "Sec-Fetch-Mode": MEGAPLAY_MEDIA_HEADERS["Sec-Fetch-Mode"]!,
  "Sec-Fetch-Site": MEGAPLAY_MEDIA_HEADERS["Sec-Fetch-Site"]!,
};

/** Season number implied by a result title ("… Season 2", "… 2nd Season", roman
 *  "… II"); defaults to 1 when the title carries no season marker. */
function seasonOfTitle(title: string): number {
  const t = title.toLowerCase();
  const m =
    t.match(/\bseason\s+(\d+)\b/) ||
    t.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/) ||
    t.match(/\bpart\s+(\d+)\b/);
  if (m) {
    const n = parseInt(m[1]!, 10);
    if (!Number.isNaN(n)) return n;
  }
  const roman: Record<string, number> = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6 };
  const rm = t.match(/\b(ii|iii|iv|v|vi)\b\s*$/);
  if (rm && roman[rm[1]!]) return roman[rm[1]!]!;
  return 1;
}

/** Search the site and return the best-matching show's `/anime/{slug}/` URL. */
async function findAnimePage(ctx: SourceContext["ctx"], fetcher: Fetcher): Promise<string | null> {
  const candidates = candidateTitles(ctx);
  if (candidates.length === 0) return null;
  const normCandidates = new Set(candidates.map(normalizeTitle).filter(Boolean));
  const season = ctx.season || 1;

  for (const keyword of searchKeywords(candidates, { limit: 5 })) {
    let html: string;
    try {
      const res = await fetcher.fetch(`${BASE}/?s=${encodeURIComponent(keyword)}`, { redirect: "follow" });
      if (!res.ok || res.bodyEncoding !== "text") continue;
      html = res.body;
    } catch {
      continue;
    }
    const doc = parseHtml(html);
    const seen = new Set<string>();
    const matches: Array<{ href: string; score: number; exact: boolean }> = [];
    for (const node of doc.all('a[href*="/anime/"]')) {
      const href = attr(node, "href");
      if (!href.includes("/anime/") || seen.has(href)) continue;
      const title = attr(node, "title") || elText(node);
      if (!title) continue;
      seen.add(href);
      const normTitle = normalizeTitle(title);
      const exact = normCandidates.has(normTitle);
      let loose = false;
      for (const c of normCandidates) {
        if (c.length >= 5 && (normTitle.startsWith(c) || c.startsWith(normTitle))) loose = true;
      }
      if (!exact && !loose) continue;
      // Prefer the entry whose season matches; exact-title wins ties.
      const score = (seasonOfTitle(title) === season ? 2 : 0) + (exact ? 1 : 0);
      matches.push({ href, score, exact });
    }
    if (matches.length) {
      matches.sort((a, b) => b.score - a.score || Number(b.exact) - Number(a.exact));
      return matches[0]!.href;
    }
  }
  return null;
}

/** From a show's `/anime/{slug}/` page, the episode URL for `episode` (its slug is
 *  independent of the show slug, so it must be read from the listing, not built). */
async function episodeUrl(
  animeUrl: string,
  episode: number,
  fetcher: Fetcher,
): Promise<string | null> {
  let html: string;
  try {
    const res = await fetcher.fetch(animeUrl, { redirect: "follow" });
    if (!res.ok || res.bodyEncoding !== "text") return null;
    html = res.body;
  } catch {
    return null;
  }
  const doc = parseHtml(html);
  for (const node of doc.all("a.ep-item[data-number], .episodes-ul a[data-number]")) {
    if (parseInt(attr(node, "data-number"), 10) !== episode) continue;
    const href = attr(node, "href");
    if (href) return href.startsWith("http") ? href : new URL(href, BASE).toString();
  }

  // Fallback: the listing is paginated, so a high episode may not be in the first
  // page's HTML. Derive the episode slug from the show slug (dropping a trailing
  // release year, e.g. "black-torch-2026" -> "black-torch") and probe it.
  const slug = animeUrl.replace(/\/+$/, "").split("/").pop();
  if (slug) {
    const probe = `${BASE}/${slug.replace(/-(?:19|20)\d\d$/, "")}-episode-${episode}/`;
    try {
      const res = await fetcher.fetch(probe, { redirect: "follow" });
      if (res.ok && res.bodyEncoding === "text" && res.body.includes("server-item")) return probe;
    } catch {
      /* fall through */
    }
  }
  return null;
}

/** Decode each `server-item`'s base64 `data-hash` into its embed URL + language. */
function parseServers(html: string): Array<{ embedUrl: string; type: string }> {
  const doc = parseHtml(html);
  const out: Array<{ embedUrl: string; type: string }> = [];
  for (const node of doc.all("div.server-item a[data-hash], .player-servers a[data-hash]")) {
    const decoded = (b64DecodeText(attr(node, "data-hash")) ?? "").trim();
    const src = decoded.match(/src="([^"]+)"/i)?.[1] ?? (decoded.startsWith("http") ? decoded : "");
    if (!src.startsWith("http")) continue;
    // Language: the embed's own type/category param is authoritative; fall back to
    // the button label ("SUB" / "DUB").
    const q = src.match(/[?&](?:type|category)=([a-z]+)/i)?.[1];
    const type = (q || elText(node) || "sub").toLowerCase();
    out.push({ embedUrl: src, type: type === "dub" ? "dub" : "sub" });
  }
  return out;
}

async function resolve(sctx: SourceContext): Promise<ResolvedStream[]> {
  const { ctx, fetcher, env } = sctx;
  if (ctx.mediaType !== "tv" || ctx.episode == null) return []; // anime episodes only

  const animeUrl = await findAnimePage(ctx, fetcher);
  if (!animeUrl) {
    dlog(`kissanime: no show match for tmdb=${ctx.tmdbId} "${ctx.titleEnglish ?? ctx.title ?? ""}"`);
    return [];
  }
  const epUrl = await episodeUrl(animeUrl, ctx.episode, fetcher);
  if (!epUrl) {
    dlog(`kissanime: show ${animeUrl} has no episode ${ctx.episode}`);
    return [];
  }

  let html: string;
  try {
    const res = await fetcher.fetch(epUrl, { redirect: "follow" });
    if (!res.ok || res.bodyEncoding !== "text") return [];
    html = res.body;
  } catch {
    return [];
  }

  const servers = parseServers(html).sort(
    (a, b) =>
      (LANG_PREFERENCE.indexOf(a.type) + 1 || 99) - (LANG_PREFERENCE.indexOf(b.type) + 1 || 99),
  );

  const out: ResolvedStream[] = [];
  const seen = new Set<string>();
  for (const server of servers) {
    if (seen.has(server.embedUrl)) continue;
    seen.add(server.embedUrl);

    const megaplayUrl = await megaplayUrlFromEmbed(server.embedUrl, fetcher);
    if (!megaplayUrl) continue;
    const upstream = await resolveVidsrc(megaplayUrl, fetcher);
    if (!upstream) continue;
    const handle = await preparePlayback(env, upstream.url, upstream.headers, upstream.streamType, {
      extraHeaders: SEC_FETCH_HEADERS,
    });
    if (!handle) continue;
    out.push({
      label: "KissAnime",
      streamType: handle.streamType,
      url: handle.url,
      language: LANG_LABELS[server.type] ?? null,
      subtitles: upstream.subtitles ?? null,
      mediaRules: handle.mediaRules,
    });
  }
  if (!out.length) dwarn(`kissanime: found ${epUrl} but no server resolved to a stream`);
  return out;
}

export const kissanime: Source = {
  id: "kissanime",
  label: "KissAnime",
  supportsMovies: false,
  // C1 + C2 (Referer + Sec-Fetch) + C3 (the megaplay CDN's Cloudflare JA3 gate) =>
  // extension-only (E3); the edge proxy can't supply a Chrome fingerprint.
  flags: { ...NO_FLAGS, needsCORSBypass: true, needsHeaderInjection: true, needsJA3: true },
  resolve,
};
