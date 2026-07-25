/*
 * ScreenScape source (client port of resolvers/screenscape.py + its scraper).
 *
 * screenscape.me aggregates ~15 TMDB-keyed stream "servers". Most are gated behind
 * a per-session HMAC handshake (crypto/screenscape.ts): a one-time bootstrap mints
 * a responseKey + apiToken, every request path/param is HMAC-signed, and the JSON
 * body returns as an AES envelope we decrypt. Each server can expose several
 * quality/language variants; we drop fallback mirrors, dedupe, cap per server, and
 * surface each as its own tile. The per-stream Origin/Referer the API hands us are
 * injected by the extension's media rules (no same-origin proxy — that was the
 * backend's job).
 */
import { preparePlayback } from "../playback";
import {
  newBootstrapNonce,
  tokenRouteCode,
  serverRouteRequestId,
  serverRequestId,
  tmdbRequestId,
  buildCipherContext,
  isEncryptedEnvelope,
  decryptEnvelope,
} from "../crypto/screenscape";
import { NO_FLAGS } from "../types";
import type { Fetcher, ResolvedEnv, ResolvedStream, Source, SourceContext } from "../types";

const ORIGIN = "https://screenscape.me";
const REFERER = "https://screenscape.me/";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const BASE_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Origin: ORIGIN,
  Referer: REFERER,
  Accept: "application/json",
  "x-screenscape-client": "web-player",
};

const SERVER_LABELS: Record<string, string> = {
  moviebox: "MovieBox",
  rivestream: "RiveStream",
  qsply: "AwaitPly",
  elips: "Elips",
  hindibox: "HindiBox",
  vidnestfun: "VidNest",
  als: "ALS",
  vidrock: "VidRock",
  cinemaos: "CinemaOS",
  showbox: "ShowBox",
  fun: "Fun",
  toustream: "TouStream",
  streamflix: "StreamFlix",
  hdhub: "HDHub",
  vidlink: "VidLink",
};
const OPEN_SERVERS = new Set(["nxsha"]);
const MAX_PER_SERVER = 12;
const SESSION_TTL_MS = 240_000;

interface RawStream {
  url?: string;
  name?: string;
  quality?: string;
  language?: string;
  type?: string;
  headers?: Record<string, string>;
}

// --- per-session handshake (module-level, shared across a fan-out) -----------

interface Session {
  responseKey: string;
  apiToken: string;
  exp: number;
}
let session: Session | null = null;
let bootstrapping: Promise<Session> | null = null;

async function bootstrap(fetcher: Fetcher): Promise<Session> {
  const nonce = newBootstrapNonce();
  const path = `/api/${await tokenRouteCode(nonce)}`;
  const res = await fetcher.fetch(ORIGIN + path, {
    method: "POST",
    headers: { ...BASE_HEADERS, "Content-Type": "application/json", "x-screenscape-bootstrap": nonce },
  });
  if (!res.ok || res.bodyEncoding !== "text") throw new Error("bootstrap fetch failed");
  const env = JSON.parse(res.body);
  if (!isEncryptedEnvelope(env)) throw new Error("bootstrap not an envelope");
  const dec = await decryptEnvelope(env, nonce, buildCipherContext(path, "", "POST"));
  if (!dec?.responseKey || !dec?.apiToken) throw new Error("bootstrap missing keys");
  return { responseKey: dec.responseKey, apiToken: dec.apiToken, exp: Date.now() + SESSION_TTL_MS };
}

async function ensureSession(fetcher: Fetcher, force = false): Promise<Session> {
  if (!force && session && Date.now() < session.exp) return session;
  if (!bootstrapping) {
    bootstrapping = bootstrap(fetcher)
      .then((s) => {
        session = s;
        return s;
      })
      .finally(() => {
        bootstrapping = null;
      });
  }
  return bootstrapping;
}

// --- server queries ----------------------------------------------------------

function mediaParams(ctx: SourceContext["ctx"]): string {
  if (ctx.mediaType === "tv" && ctx.season != null && ctx.episode != null) {
    return `&type=tv&season=${ctx.season}&episode=${ctx.episode}`;
  }
  return "&type=movie";
}

async function fetchOpen(server: string, ctx: SourceContext["ctx"], fetcher: Fetcher): Promise<RawStream[]> {
  let path: string;
  if (server === "nxsha") {
    path = `/api/servers/nxsha?kind=sources&tmdbId=${ctx.tmdbId}`;
    path += ctx.mediaType === "tv" && ctx.season != null && ctx.episode != null
      ? `&type=tv&season=${ctx.season}&episode=${ctx.episode}`
      : "&type=movie";
  } else {
    path = `/api/servers/${server}?tmdb=${ctx.tmdbId}` + mediaParams(ctx);
  }
  const res = await fetcher.fetch(ORIGIN + path, { headers: BASE_HEADERS });
  if (!res.ok || res.bodyEncoding !== "text") return [];
  const data = JSON.parse(res.body);
  return data && typeof data === "object" ? data.streams || [] : [];
}

async function fetchGated(
  server: string,
  ctx: SourceContext["ctx"],
  fetcher: Fetcher,
  retried = false,
): Promise<RawStream[]> {
  const sess = await ensureSession(fetcher);
  const isTv = ctx.mediaType === "tv" && ctx.season != null && ctx.episode != null;
  const mtype = isTv ? "tv" : "movie";
  const s = isTv ? (ctx.season ?? null) : null;
  const e = isTv ? (ctx.episode ?? null) : null;

  const rc = await serverRouteRequestId(sess.responseKey);
  const sc = await serverRequestId(server, sess.responseKey);
  const q = await tmdbRequestId(String(ctx.tmdbId), s, e, sess.responseKey);
  const query = `q=${q}&type=${mtype}`; // q < type alphabetically; matches the cipher context
  const path = `/api/${rc}/${sc}`;

  const res = await fetcher.fetch(`${ORIGIN}${path}?${query}`, {
    headers: { ...BASE_HEADERS, "x-api-token": sess.apiToken },
  });
  if (!res.ok || res.bodyEncoding !== "text") return [];
  const data = JSON.parse(res.body);

  if (isEncryptedEnvelope(data)) {
    const dec = await decryptEnvelope(data, sess.responseKey, buildCipherContext(path, query, "GET"));
    if (dec === null) {
      if (!retried) {
        await ensureSession(fetcher, true);
        return fetchGated(server, ctx, fetcher, true);
      }
      return [];
    }
    return dec.streams || [];
  }
  return data && typeof data === "object" ? data.streams || [] : [];
}

async function fetchServerStreams(server: string, ctx: SourceContext["ctx"], fetcher: Fetcher): Promise<RawStream[]> {
  try {
    return OPEN_SERVERS.has(server) ? await fetchOpen(server, ctx, fetcher) : await fetchGated(server, ctx, fetcher);
  } catch {
    return [];
  }
}

// --- variant selection / formatting ------------------------------------------

function qualityRank(q: string): number {
  const low = (q || "").toLowerCase();
  if (low.includes("4k") || low.includes("2160")) return 2160;
  const m = low.match(/(\d{3,4})/);
  return m ? parseInt(m[1]!, 10) : 0;
}

/** The underlying media URL behind a ScreenScape worker wrapper (?url=), to
 *  collapse mirror duplicates that only differ by fronting worker. */
function realTarget(url: string): string {
  try {
    const inner = new URL(url).searchParams.get("url");
    return inner ? decodeURIComponent(inner) : url;
  } catch {
    return url;
  }
}

async function formatStreams(
  server: string,
  raw: RawStream[],
  env: ResolvedEnv,
): Promise<ResolvedStream[]> {
  const label = SERVER_LABELS[server] ?? server;
  const sorted = [...raw].sort((a, b) => qualityRank(b.quality || "") - qualityRank(a.quality || ""));
  const out: ResolvedStream[] = [];
  const seen = new Set<string>();
  for (const st of sorted) {
    const url = st.url;
    if (typeof url !== "string" || !url.startsWith("http")) continue;
    const name = st.name || label;
    if (name.toLowerCase().includes("fallback")) continue;
    const quality = st.quality || "";
    const language = st.language || "";
    const key = `${language}|${quality}|${realTarget(url)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const hdrs = st.headers || {};
    const origin = hdrs["Origin"] || hdrs["origin"] || "";
    const referer = hdrs["Referer"] || hdrs["referer"] || "";
    const isHls = url.toLowerCase().includes(".m3u8") || ["hls", "m3u8"].includes((st.type || "").toLowerCase());

    let tile = `ScreenScape · ${name}`;
    if (quality && !name.toLowerCase().includes(quality.toLowerCase())) tile += ` (${quality})`;

    const handle = await preparePlayback(
      env,
      url,
      { origin: origin || undefined, referer: referer || undefined, userAgent: UA },
      isHls ? "hls" : "mp4",
    );
    if (!handle) continue;

    const stream: ResolvedStream = {
      label: tile,
      streamType: handle.streamType,
      url: handle.url,
      mediaRules: handle.mediaRules,
    };
    if (language && !["original", "unknown", ""].includes(language.toLowerCase())) {
      stream.language = language;
    }
    out.push(stream);
    if (out.length >= MAX_PER_SERVER) break;
  }
  return out;
}

async function resolve(sctx: SourceContext): Promise<ResolvedStream[]> {
  const { ctx, fetcher, env } = sctx;
  const servers = Object.keys(SERVER_LABELS);
  const perServer = await Promise.all(
    servers.map(async (server) => {
      const raw = await fetchServerStreams(server, ctx, fetcher);
      if (!raw.length) return [];
      try {
        return await formatStreams(server, raw, env);
      } catch {
        return [];
      }
    }),
  );
  return perServer.flat();
}

export const screenscape: Source = {
  id: "screenscape",
  label: "ScreenScape",
  supportsMovies: true,
  // C1 (CORS) + C2 (per-stream Origin/Referer + the API's custom headers); no JA3
  // (the API uses plain httpx), no server secret.
  flags: { ...NO_FLAGS, needsCORSBypass: true, needsHeaderInjection: true },
  resolve,
};
