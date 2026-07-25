/*
 * AnimeSuge discovery source (client port of scrapers/animesuge_scraper.py +
 * resolvers/animesuge.py, the ad-free direct-file variant).
 *
 * animesuge.buzz is a Kiranime WordPress site. We search the Kiranime REST API,
 * open the anime page, find the requested episode's watch URL, and decode its
 * `data-embed-id="b64(label):b64(url)"` server spans — keeping ONLY the direct
 * video files (mp4/m3u8 on the site's own CDN), never the third-party embed player
 * (the ad vector). Under the extension the raw file plays directly with the site
 * Referer injected as a media rule; no ad code is ever loaded.
 */
import { preparePlayback } from "../playback";
import { streamTypeOf } from "../resolvers/common";
import { b64DecodeText } from "../util/base64";
import { NO_FLAGS } from "../types";
import type { Fetcher, ResolvedStream, Source, SourceContext, UpstreamHeaders } from "../types";

const BASE = "https://animesuge.buzz";
const SEARCH_API = "https://animesuge.buzz/wp-json/kiranime/v1/anime/search";
const DIRECT_EXTS = [".mp4", ".m3u8", ".webm", ".mkv"];

const UPSTREAM: UpstreamHeaders = {
  referer: "https://animesuge.buzz/",
  origin: "https://animesuge.buzz",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};
const REFERER_HEADER = { Referer: "https://animesuge.buzz/" };

async function searchSlug(title: string, fetcher: Fetcher): Promise<string | null> {
  let resultHtml = "";
  try {
    const res = await fetcher.fetch(`${SEARCH_API}?query=${encodeURIComponent(title)}&lang=jp`, {
      headers: REFERER_HEADER,
    });
    if (!res.ok || res.bodyEncoding !== "text") return null;
    resultHtml = (JSON.parse(res.body)?.result as string) || "";
  } catch {
    return null;
  }
  const m = resultHtml.match(/href="https?:\/\/[^"/]+\/anime\/([^"/]+)\/?"/);
  return m ? m[1]! : null;
}

/** Locate the watch URL for `episode` on the anime page (regex parity with backend). */
function findWatchUrl(animeHtml: string, episode: number): string | null {
  // Primary: an <a href=…/watch/…> carrying title="… Episode N".
  const anchorRe = /<a\s+href="(https?:\/\/[^"]+\/watch\/[^"]+)"[^>]*\btitle="([^"]*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(animeHtml))) {
    const em = m[2]!.match(/Episode\s+(\d+)\b/i);
    if (em && parseInt(em[1]!, 10) === episode) return m[1]!;
  }

  const watchLinks = [...animeHtml.matchAll(/href="(https?:\/\/[^"]+\/watch\/[^"]+)"/g)].map((x) => x[1]!);
  if (watchLinks.length === 0) return null;

  // Fallback A: an href whose own episode-N number matches exactly.
  for (const href of watchLinks) {
    const em = href.match(/episode-(\d+)(?:-[^/"]*)?\/?$/);
    if (em && parseInt(em[1]!, 10) === episode) return href;
  }
  // Fallback B: build from a sibling's stem (long shows whose episode isn't rendered).
  for (const href of watchLinks) {
    const em = href.match(/^(.*\/watch\/.*?episode-)\d+(?:-[^/"]*)?\/?$/);
    if (em) return `${em[1]}${episode}/`;
  }
  return null;
}

/** Decode every `data-embed-id` server and keep only direct files. */
function extractDirectFiles(watchHtml: string): Array<{ label: string; url: string }> {
  const out: Array<{ label: string; url: string }> = [];
  const seen = new Set<string>();
  for (const m of watchHtml.matchAll(/data-embed-id="([^"]+)"/g)) {
    const token = m[1]!;
    const sep = token.indexOf(":");
    if (sep < 0) continue;
    const url = (b64DecodeText(token.slice(sep + 1)) ?? "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const path = url.split("?")[0]!.toLowerCase();
    if (!(url.startsWith("https://") && DIRECT_EXTS.some((e) => path.endsWith(e)))) continue;
    out.push({ label: (b64DecodeText(token.slice(0, sep)) ?? "").trim(), url });
  }
  return out;
}

async function resolve(sctx: SourceContext): Promise<ResolvedStream[]> {
  const { ctx, fetcher, env } = sctx;
  if (ctx.mediaType !== "tv" || ctx.episode == null) return [];
  const title = ctx.title;
  if (!title) return [];

  const slug = await searchSlug(title, fetcher);
  if (!slug) return [];

  let animeHtml: string;
  try {
    const res = await fetcher.fetch(`${BASE}/anime/${slug}/`, { headers: REFERER_HEADER, redirect: "follow" });
    if (!res.ok || res.bodyEncoding !== "text") return [];
    animeHtml = res.body;
  } catch {
    return [];
  }

  const watchUrl = findWatchUrl(animeHtml, ctx.episode);
  if (!watchUrl) return [];

  let watchHtml: string;
  try {
    const res = await fetcher.fetch(watchUrl, { headers: REFERER_HEADER, redirect: "follow" });
    if (!res.ok || res.bodyEncoding !== "text") return [];
    watchHtml = res.body;
  } catch {
    return [];
  }

  const out: ResolvedStream[] = [];
  for (const file of extractDirectFiles(watchHtml)) {
    const handle = await preparePlayback(env, file.url, UPSTREAM, streamTypeOf(file.url));
    if (!handle) continue;
    out.push({
      label: file.label ? `AnimeSuge · ${file.label}` : "AnimeSuge",
      streamType: handle.streamType,
      url: handle.url,
      mediaRules: handle.mediaRules,
    });
  }
  return out;
}

export const animesuge: Source = {
  id: "animesuge",
  label: "AnimeSuge",
  supportsMovies: false,
  // C1 (HLS CDN sends no CORS) + C2 (site Referer); no JA3, no secret.
  flags: { ...NO_FLAGS, needsCORSBypass: true, needsHeaderInjection: true },
  resolve,
};
