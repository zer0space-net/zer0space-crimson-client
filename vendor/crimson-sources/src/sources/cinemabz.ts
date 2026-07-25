/*
 * cinema.bz — TMDB-keyed HLS aggregator (client port of resolvers/cinemabz.py).
 *
 * cinema.bz's player keys directly off the TMDB id and aggregates three
 * independent providers (tcloud / ipcloud / ngcloud), each a separate endpoint
 * returning one master playlist:
 *
 *     GET https://cinema.bz/api/{provider}/tv/{tmdb}/{season}/{episode}
 *     GET https://cinema.bz/api/{provider}/movie/{tmdb}
 *     -> 200 {"stream": {"url": "https://…/master.m3u8"}}   (found)
 *     -> 404 {"error": …}                                   (provider lacks it)
 *
 * Both the API and the upstream HLS CDN are gated on `Referer: https://cinema.bz/`
 * and answer ACAO for cinema.bz's own origin (not `*`), so a browser on our
 * origin is blocked both ways → this source needs header injection + a CORS
 * bypass (C1 + C2), satisfied by the extension (E3) or the signed proxy (E2).
 *
 * Each provider becomes its own switchable "Cinema.bz (…)" tile; providers that
 * 404 are simply dropped, so no dead tiles surface — identical to the backend.
 */
import { upstreamHeaderObject } from "../fetchers";
import { preparePlayback } from "../playback";
import { NO_FLAGS } from "../types";
import type { ResolvedStream, Source, SourceContext } from "../types";

const API_BASE = "https://cinema.bz/api";
const PROVIDERS = ["tcloud", "ipcloud", "ngcloud"] as const;

const UPSTREAM = {
  referer: "https://cinema.bz/",
  origin: "https://cinema.bz",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

const LABELS: Record<(typeof PROVIDERS)[number], string> = {
  tcloud: "Cinema.bz (tcloud)",
  ipcloud: "Cinema.bz (ipcloud)",
  ngcloud: "Cinema.bz (ngcloud)",
};

function apiPath(
  provider: string,
  ctx: SourceContext["ctx"],
): string {
  if (ctx.mediaType === "tv" && ctx.season != null && ctx.episode != null) {
    return `${API_BASE}/${provider}/tv/${ctx.tmdbId}/${ctx.season}/${ctx.episode}`;
  }
  return `${API_BASE}/${provider}/movie/${ctx.tmdbId}`;
}

async function resolveProvider(
  provider: (typeof PROVIDERS)[number],
  sctx: SourceContext,
): Promise<ResolvedStream | null> {
  const url = apiPath(provider, sctx.ctx);
  let res;
  try {
    res = await sctx.fetcher.fetch(url, { headers: upstreamHeaderObject(UPSTREAM) });
  } catch {
    return null;
  }
  if (!res.ok || res.bodyEncoding !== "text") return null; // 404 = provider lacks title

  let master: unknown;
  try {
    master = (JSON.parse(res.body)?.stream ?? {}).url;
  } catch {
    return null;
  }
  if (typeof master !== "string" || !master.startsWith("https://")) return null;

  const handle = await preparePlayback(sctx.env, master, UPSTREAM, "hls");
  if (!handle) return null;

  return {
    label: LABELS[provider],
    streamType: handle.streamType,
    url: handle.url,
    mediaRules: handle.mediaRules,
  };
}

export const cinemabz: Source = {
  id: "cinemabz",
  label: "Cinema.bz",
  supportsMovies: true,
  // C1 (CORS bypass) + C2 (Referer/Origin injection); no JA3, no secret.
  flags: { ...NO_FLAGS, needsCORSBypass: true, needsHeaderInjection: true },

  async resolve(sctx: SourceContext): Promise<ResolvedStream[]> {
    const settled = await Promise.all(PROVIDERS.map((p) => resolveProvider(p, sctx)));
    return settled.filter((s): s is ResolvedStream => s !== null);
  },
};
