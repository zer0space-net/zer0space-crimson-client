// Client-side source resolving — the E1–E3 half of the "New System".
//
// Crimson Haven's `crimson-sources` engine (vendored at vendor/crimson-sources)
// resolves many sources in the viewer's own browser, yielding the exact same
// StreamLine shape the backend's /watch NDJSON emits. We run it alongside the
// backend stream and merge the results, so the client adds sources without the
// backend having to resolve (or carry the bytes of) them. Anything the browser
// can't run is simply left to the backend (E0) — never a regression.
//
// The engine holds no secrets: PROXY_SECRET stays server-side and is reached only
// through the backend /sign grant; title enrichment comes from /scrape-meta. Both
// go through the same dashboard-proxied /crimson/api base as the rest of the app.

import {
  createEngine,
  getExtensionBridge,
  type Engine,
  type MediaCtx,
  type SignFields,
  type StreamLine,
} from "crimson-sources";
import { API_BASE } from "./config";
import { session } from "./api";
import type { Kind } from "./api";

function authHeaders(json = false): Headers {
  const h = new Headers();
  const t = session.get();
  if (t) h.set("Authorization", `Bearer ${t}`);
  if (json) h.set("Content-Type", "application/json");
  return h;
}

// E2: mint a signed crimson-proxy URL. The browser never holds PROXY_SECRET, so
// this asks the backend /sign grant. Backend returns { ok, signed: [url|null] }.
const signProxyUrl = async (fields: SignFields): Promise<string> => {
  const res = await fetch(`${API_BASE}/sign`, {
    method: "POST",
    headers: authHeaders(true),
    credentials: "include",
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(`sign ${res.status}`);
  const data = (await res.json()) as { ok?: boolean; signed?: (string | null)[] };
  const url = data.signed?.[0];
  if (!url) throw new Error("sign refused");
  return url;
};

interface ScrapeMeta {
  anilist_id?: number | null;
  mal_id?: number | null;
  title?: string | null;
  title_english?: string | null;
  title_romaji?: string | null;
  title_native?: string | null;
  synonyms?: string[] | null;
  release_year?: number | null;
  imdb_id?: string | null;
}

// Title/id enrichment the discovery sources need (German synonyms, IMDb id, …),
// derived from the server-held TMDB key. Best-effort: on failure we still run the
// id-keyed sources with the bare MediaCtx.
async function buildCtx(
  kind: Kind,
  tmdbId: number,
  season: number,
  episode: number,
  signal?: AbortSignal,
): Promise<MediaCtx> {
  const mediaType: "tv" | "movie" = kind === "movie" ? "movie" : "tv";
  const path =
    mediaType === "movie"
      ? `/scrape-meta/movie/${tmdbId}`
      : `/scrape-meta/${tmdbId}/${season}`;
  let meta: ScrapeMeta = {};
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: authHeaders(),
      credentials: "include",
      signal,
    });
    if (res.ok) meta = (await res.json()) as ScrapeMeta;
  } catch {
    /* enrichment is optional */
  }
  return {
    tmdbId,
    mediaType,
    season: mediaType === "tv" ? season : null,
    episode: mediaType === "tv" ? episode : null,
    title: meta.title ?? undefined,
    titleEnglish: meta.title_english ?? null,
    titleRomaji: meta.title_romaji ?? null,
    titleNative: meta.title_native ?? null,
    synonyms: meta.synonyms ?? null,
    releaseYear: meta.release_year ?? null,
    imdbId: meta.imdb_id ?? null,
    malId: meta.mal_id ?? null,
    anilistId: meta.anilist_id ?? undefined,
  };
}

// One engine per tab. createEngine probes for the companion extension (E3) and
// wires the E2 signer; both degrade to absent cleanly.
let enginePromise: Promise<Engine> | null = null;
function getEngine(): Promise<Engine> {
  if (!enginePromise) {
    enginePromise = createEngine({
      extension: getExtensionBridge(),
      signProxyUrl,
    });
  }
  return enginePromise;
}

// Yields client-resolved StreamLines (same shape as the backend's). The caller
// merges + dedupes them with the backend stream. Silent when nothing can run
// client-side, so the backend stays the floor.
export async function* clientStreams(
  kind: Kind,
  tmdbId: number,
  season: number,
  episode: number,
  signal?: AbortSignal,
): AsyncGenerator<StreamLine> {
  const engine = await getEngine();
  const ctx = await buildCtx(kind, tmdbId, season, episode, signal);
  if (!engine.canRunAny({ mediaType: ctx.mediaType })) return;
  // No dispose() here: the engine installs the extension's DNR media rules as it
  // resolves E3 streams, and the player needs them to stay for the whole episode.
  // streamEpisode() clears and reinstalls them at the start of the next episode,
  // so the rules are correct without a per-run teardown.
  for await (const line of engine.streamEpisode(ctx, { signal })) {
    yield line;
  }
}
