// Typed client for the Crimson Haven backend.
//
// Crimson Haven (https://github.com/crimsonhaven-to) develops and owns this API;
// this is only a client for it. Everything goes to the same-origin, relative
// API_BASE (/crimson/api), which the zer0space dashboard proxies to the backend.

import { API_BASE } from "./config";
import { readNdjson } from "./ndjson";

// --- Session token -----------------------------------------------------------
// In the gated model the zer0space dashboard supplies the identity, but the
// backend still speaks Bearer tokens; we keep whatever token we are handed and
// attach it. Absent token is fine when the gate itself authorises the request.

const TOKEN_KEY = "zsc.session";

export const session = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage blocked */
    }
  },
};

// --- Domain types (the subset the UI relies on) ------------------------------

export type MediaType = "anime" | "tv" | "movie";

export interface MediaSummary {
  tmdb_id?: number;
  anilist_id?: number;
  title: string;
  poster?: string | null;
  backdrop?: string | null;
  year?: number | string | null;
  mediaType?: MediaType;
  rating?: number | null;
}

export interface EpisodeInfo {
  number: number;
  title?: string | null;
  overview?: string | null;
  still?: string | null;
}

export interface SeasonInfo {
  number: number;
  name?: string | null;
  episodes: EpisodeInfo[];
}

export interface Overview extends MediaSummary {
  synopsis?: string | null;
  genres?: string[];
  seasons?: SeasonInfo[];
  status?: string | null;
}

// One NDJSON line from /watch — identical shape whether the backend (E0) or the
// client engine (E1–E3) produced it.
export type StreamType = "hls" | "mp4" | "iframe";
export interface WatchMeta {
  type: "meta";
  success: boolean;
  tmdb_id?: number;
  anilist_id?: number;
  season_number?: number;
  episode_number?: number;
  title?: string;
}
export interface StreamLine {
  type: "stream";
  source: string;
  streamType: StreamType;
  url: string;
  language?: string | null;
  quality?: string | null;
  subtitles?: { url: string; label?: string; lang?: string }[];
  headers?: Record<string, string>;
  origin?: "backend" | "client"; // set by us, not the backend
}
export interface WatchDone {
  type: "done";
  count: number;
}
export type WatchLine = WatchMeta | StreamLine | WatchDone;

// --- HTTP core ---------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function authHeaders(extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  const t = session.get();
  if (t) h.set("Authorization", `Bearer ${t}`);
  return h;
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: authHeaders({ Accept: "application/json" }),
    credentials: "include",
    signal,
  });
  if (res.status === 401) throw new ApiError(401, "unauthorised");
  if (!res.ok) throw new ApiError(res.status, `${res.status} on ${path}`);
  return (await res.json()) as T;
}

// --- Public API surface ------------------------------------------------------

export const api = {
  me: (signal?: AbortSignal) =>
    get<{ id: string; is_admin?: boolean; favorites?: number; progress?: number }>(
      "/account/me",
      signal,
    ),

  trending: (kind: "" | "shows" | "movies" = "", signal?: AbortSignal) =>
    get<MediaSummary[]>(`/trending${kind ? "/" + kind : ""}`, signal),

  catalogue: (signal?: AbortSignal) => get<MediaSummary[]>("/catalogue", signal),

  search: (kind: "anime" | "shows" | "movies", q: string, signal?: AbortSignal) =>
    get<MediaSummary[]>(`/search/${kind}?title=${encodeURIComponent(q)}`, signal),

  showOverview: (tmdbId: number, signal?: AbortSignal) =>
    get<Overview>(`/show-overview/${tmdbId}`, signal),

  movieOverview: (tmdbId: number, signal?: AbortSignal) =>
    get<Overview>(`/movie-overview/${tmdbId}`, signal),

  animeOverview: (anilistId: number, signal?: AbortSignal) =>
    get<Overview>(`/overview/${anilistId}`, signal),

  continueWatching: (signal?: AbortSignal) =>
    get<MediaSummary[]>("/account/continue-watching", signal),

  // Progressive NDJSON — yields meta → stream* → done as each source resolves.
  async *watch(
    path: string,
    signal?: AbortSignal,
  ): AsyncGenerator<WatchLine> {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: authHeaders({ Accept: "application/x-ndjson" }),
      credentials: "include",
      signal,
    });
    if (res.status === 401) throw new ApiError(401, "unauthorised");
    if (!res.ok) throw new ApiError(res.status, `${res.status} on ${path}`);
    for await (const line of readNdjson<WatchLine>(res, signal)) {
      if (line && (line as StreamLine).type === "stream") {
        (line as StreamLine).origin = "backend";
      }
      yield line;
    }
  },

  watchEpisode: (tmdbId: number, season: number, episode: number) =>
    `/watch/${tmdbId}/${season}/${episode}`,
  watchMovie: (tmdbId: number) => `/watch/movie/${tmdbId}`,
};
