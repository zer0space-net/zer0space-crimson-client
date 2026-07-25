/*
 * PlayIMDb — ad-free extracted-stream source (client port of resolvers/playimdb.py).
 *
 * PlayIMDb is a "VidAPI" player chain whose HLS sources come from a JSON API that
 * keys off the TMDB id:
 *
 *     GET https://streamdata.vaplayer.ru/api.php?tmdb=…&type=tv&season=&episode=
 *     -> {"status_code":"200","data":{"stream_urls":["https://…/master.m3u8", …]}}
 *
 * The whole ecosystem (the API *and* the rotating HLS CDN hosts) is gated on
 * `Referer: https://nextgencloudfabric.com/` — it 403/404s anything else. So we
 * never load PlayIMDb's ad-carrying player; we hit the API and play the raw HLS,
 * with the Referer injected by the extension (E3) or the signed proxy (E2).
 *
 * CDN hosts rotate and individual links expire, so — like the backend — we probe
 * the candidate masters and surface the first that actually answers a playlist.
 */
import { upstreamHeaderObject } from "../fetchers";
import { preparePlayback } from "../playback";
import { NO_FLAGS } from "../types";
import type { ResolvedStream, Source, SourceContext } from "../types";

const STREAM_API_URL = "https://streamdata.vaplayer.ru/api.php";

const UPSTREAM = {
  referer: "https://nextgencloudfabric.com/",
  origin: "https://nextgencloudfabric.com",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

function apiUrl(ctx: SourceContext["ctx"]): string {
  const p = new URLSearchParams({ tmdb: String(ctx.tmdbId), type: ctx.mediaType });
  if (ctx.mediaType === "tv" && ctx.season != null && ctx.episode != null) {
    p.set("season", String(ctx.season));
    p.set("episode", String(ctx.episode));
  }
  return `${STREAM_API_URL}?${p.toString()}`;
}

async function fetchStreamUrls(sctx: SourceContext): Promise<string[]> {
  let res;
  try {
    res = await sctx.fetcher.fetch(apiUrl(sctx.ctx), {
      headers: upstreamHeaderObject(UPSTREAM),
    });
  } catch {
    return [];
  }
  if (!res.ok || res.bodyEncoding !== "text") return [];

  let data: any;
  try {
    data = JSON.parse(res.body);
  } catch {
    return [];
  }
  if (String(data?.status_code) !== "200") return [];

  const urls = data?.data?.stream_urls;
  if (!Array.isArray(urls)) return [];
  return urls.filter((u: unknown): u is string => typeof u === "string" && u.startsWith("https://"));
}

// How many candidate streams to surface per title. The API's stream_urls are NOT
// quality variants of one file — they are distinct releases (different encodes and,
// in practice, different muxed audio languages) that it ships with no language
// label. We used to play only the first reachable, which made the audio language
// effectively random (whichever link was up first).
const MAX_STREAMS = 5;

/** Probe candidate masters concurrently; keep the ones that answer a real
 *  `#EXTM3U` playlist (CDN links expire), preserving the API's order so the tile
 *  index is stable across reloads and matches the backend's "Server N" labels. */
async function reachableMasters(
  urls: string[],
  sctx: SourceContext,
): Promise<Array<{ index: number; url: string }>> {
  const results = await Promise.all(
    urls.map(async (url, index) => {
      try {
        const res = await sctx.fetcher.fetch(url, { headers: upstreamHeaderObject(UPSTREAM) });
        if (res.ok && res.bodyEncoding === "text" && res.body.trimStart().startsWith("#EXTM3U")) {
          return { index, url };
        }
      } catch {
        /* try the next candidate */
      }
      return null;
    }),
  );
  return results.filter((r): r is { index: number; url: string } => r !== null);
}

export const playimdb: Source = {
  id: "playimdb",
  label: "PlayIMDb",
  supportsMovies: true,
  // C1 (CORS bypass) + C2 (Referer injection); no JA3, no secret.
  flags: { ...NO_FLAGS, needsCORSBypass: true, needsHeaderInjection: true },

  async resolve(sctx: SourceContext): Promise<ResolvedStream[]> {
    const urls = (await fetchStreamUrls(sctx)).slice(0, MAX_STREAMS);
    if (urls.length === 0) return [];

    const reachable = await reachableMasters(urls, sctx);
    if (reachable.length === 0) return [];

    // One tile per reachable release (not just the first — they're different
    // audio/releases the API doesn't label). Bare "PlayIMDb" when there's a single
    // one (dedups with the backend tile); "PlayIMDb (Server N)" by stable API index
    // otherwise, so the frontend groups them under one card and the user can pick.
    const multi = reachable.length > 1;
    const out: ResolvedStream[] = [];
    for (const { index, url } of reachable) {
      const handle = await preparePlayback(sctx.env, url, UPSTREAM, "hls");
      if (!handle) continue;
      out.push({
        label: multi ? `PlayIMDb (Server ${index + 1})` : "PlayIMDb",
        streamType: handle.streamType,
        url: handle.url,
        mediaRules: handle.mediaRules,
      });
    }
    return out;
  },
};
