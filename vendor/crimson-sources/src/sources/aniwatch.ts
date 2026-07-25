/*
 * aniwatch.co.at discovery source (client port of scrapers/aniwatch_scraper.py).
 *
 * WordPress "Zoro-Tv" anime site. Its `?s=` search returns episode-page links
 * whose slug already encodes the season; we pick the best season match, swap in the
 * requested episode number, and read each `server-item`'s base64 `data-hash` into a
 * megaplay embed URL — resolved by the shared VidSrc resolver. The megaplay CDN
 * needs a real Chrome JA3 (C3) on top of Referer+Sec-Fetch (C2), so this is
 * E3-only (extension), with the backend (E0) as the floor — New_System §6.
 */
import { preparePlayback } from "../playback";
import { resolveVidsrc, MEGAPLAY_MEDIA_HEADERS } from "../resolvers/vidsrc";
import { parseHtml, attr, elText } from "../util/dom";
import { b64DecodeText } from "../util/base64";
import { candidateTitles, normalizeTitle, slugifyTitle, searchKeywords } from "../util/text";
import { NO_FLAGS } from "../types";
import type { Fetcher, ResolvedStream, Source, SourceContext } from "../types";

const BASE = "https://aniwatch.co.at";
const LANG_LABELS: Record<string, string> = { sub: "English Sub", dub: "English Dub" };
const LANG_PREFERENCE = ["sub", "dub"];
const SUPPORTED_SERVERS = new Set(["vidsrc"]);

// The Sec-Fetch/Accept set the megaplay CDN gates on, beyond Referer/Origin/UA.
const SEC_FETCH_HEADERS = {
  Accept: MEGAPLAY_MEDIA_HEADERS["Accept"]!,
  "Accept-Language": MEGAPLAY_MEDIA_HEADERS["Accept-Language"]!,
  "Sec-Fetch-Dest": MEGAPLAY_MEDIA_HEADERS["Sec-Fetch-Dest"]!,
  "Sec-Fetch-Mode": MEGAPLAY_MEDIA_HEADERS["Sec-Fetch-Mode"]!,
  "Sec-Fetch-Site": MEGAPLAY_MEDIA_HEADERS["Sec-Fetch-Site"]!,
};

function seasonOf(href: string, title: string): number {
  const blob = `${href} ${title}`.toLowerCase();
  const m =
    href.toLowerCase().match(/-season-(\d+)-/) ||
    blob.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/) ||
    blob.match(/\bseason\s+(\d+)\b/);
  if (m) {
    const n = parseInt(m[1]!, 10);
    if (!Number.isNaN(n)) return n;
  }
  return 1;
}

/** Find the show's episode-URL template (the search result encodes the season). */
async function searchTemplate(ctx: SourceContext["ctx"], fetcher: Fetcher): Promise<string | null> {
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
    const matches: Array<{ href: string; score: number; exact: boolean }> = [];
    for (const node of doc.all("h3.film-name a[href], .film-name a[href]")) {
      const href = attr(node, "href");
      if (!href.includes("-episode-")) continue;
      const title = attr(node, "title") || elText(node);
      const jname = attr(node, "data-jname");
      const normTitle = normalizeTitle(title);
      const normJname = normalizeTitle(jname);
      const exact = normCandidates.has(normTitle) || normCandidates.has(normJname);
      let loose = false;
      for (const c of normCandidates) {
        if (c.length >= 5 && (normTitle.startsWith(c) || c.startsWith(normTitle))) loose = true;
      }
      if (!exact && !loose) continue;
      const hrefSeason = seasonOf(href, title);
      const score = hrefSeason === season ? 2 : exact ? 1 : 0;
      matches.push({ href, score, exact });
    }
    if (matches.length) {
      matches.sort((a, b) => b.score - a.score || Number(b.exact) - Number(a.exact));
      return matches[0]!.href;
    }
  }

  // Fallback: build a season-1 episode-1 URL from the title and probe it.
  for (const candidate of candidates) {
    const slug = slugifyTitle(candidate);
    if (!slug) continue;
    const probe = `${BASE}/${slug}-episode-1-english-subbed/`;
    try {
      const res = await fetcher.fetch(probe, { redirect: "follow" });
      if (res.ok && res.bodyEncoding === "text" && res.body.includes("server-item")) return probe;
    } catch {
      /* try next */
    }
  }
  return null;
}

function episodeUrl(template: string, episode: number): string | null {
  if (template.includes("-episode-")) {
    return template.replace(/-episode-\d+-/, `-episode-${episode}-`);
  }
  const slug = template.replace(/\/+$/, "").split("/").pop();
  if (!slug) return null;
  return `${BASE}/${slug}-episode-${episode}-english-subbed/`;
}

function parseServers(html: string): Array<{ url: string; type: string }> {
  const doc = parseHtml(html);
  const out: Array<{ url: string; type: string }> = [];
  for (const div of doc.all("div.server-item[data-hash]")) {
    const name = attr(div, "data-server-name").trim().toLowerCase();
    if (!SUPPORTED_SERVERS.has(name)) continue;
    const type = (attr(div, "data-type") || "sub").trim().toLowerCase();
    const decoded = (b64DecodeText(attr(div, "data-hash")) ?? "").trim();
    if (decoded.startsWith("http://") || decoded.startsWith("https://")) out.push({ url: decoded, type });
  }
  return out;
}

async function resolve(sctx: SourceContext): Promise<ResolvedStream[]> {
  const { ctx, fetcher, env } = sctx;
  if (ctx.mediaType !== "tv" || ctx.episode == null) return [];

  const template = await searchTemplate(ctx, fetcher);
  if (!template) return [];
  const url = episodeUrl(template, ctx.episode);
  if (!url) return [];

  let html: string;
  try {
    const res = await fetcher.fetch(url, { redirect: "follow" });
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
    if (seen.has(server.url)) continue;
    seen.add(server.url);

    const upstream = await resolveVidsrc(server.url, fetcher);
    if (!upstream) continue;
    const handle = await preparePlayback(env, upstream.url, upstream.headers, upstream.streamType, {
      extraHeaders: SEC_FETCH_HEADERS,
    });
    if (!handle) continue;
    out.push({
      label: "VidSrc",
      streamType: handle.streamType,
      url: handle.url,
      language: LANG_LABELS[server.type] ?? null,
      subtitles: upstream.subtitles ?? null,
      mediaRules: handle.mediaRules,
    });
  }
  return out;
}

export const aniwatch: Source = {
  id: "aniwatch",
  label: "AniWatch",
  supportsMovies: false,
  // C1 + C2 (Referer+Sec-Fetch) + C3 (the megaplay CDN's Cloudflare JA3 gate) =>
  // extension-only (E3); the edge proxy can't supply a Chrome fingerprint.
  flags: { ...NO_FLAGS, needsCORSBypass: true, needsHeaderInjection: true, needsJA3: true },
  resolve,
};
