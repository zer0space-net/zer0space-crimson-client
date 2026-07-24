// Typed client for the Crimson Haven backend.
//
// Crimson Haven (https://github.com/crimsonhaven-to) develops and owns this API;
// this is only a client for it. Shapes below are taken from the backend source
// (web/routes/discovery.py, web/routes/metadata.py, web/routes/watch.py and
// core/contracts.py) — not guessed. Everything goes to the same-origin, relative
// API_BASE (/crimson/api), which the zer0space dashboard proxies to the backend.

import { API_BASE } from "./config";
import { readNdjson } from "./ndjson";

// --- Session token -----------------------------------------------------------

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

// --- Domain types (as the backend actually serialises them) ------------------

// kind drives routing to the right overview: anime is AniList-keyed, show/movie
// are TMDB-keyed. The backend uses "kind"; discovery cards don't always carry it,
// so the client tags each card from the endpoint it came from.
export type Kind = "anime" | "show" | "movie";

export interface MediaCard {
  title: string;
  tmdb_id?: number | null;
  anilist_id?: number | null;
  poster?: string | null; // already a full image URL
  backdrop?: string | null;
  year?: string | number | null;
  vote_average?: number | null;
  kind?: Kind;
}

export interface EpisodeInfo {
  episode_number: number;
  title?: string | null;
  overview?: string | null;
  thumbnail?: string | null;
  air_date?: string | null;
}

export interface SeasonInfo {
  season_number: number;
  name?: string | null;
  poster?: string | null;
  summary?: string | null;
  episode_count?: number | null;
  air_date?: string | null;
  anilist_id?: number | null;
}

// Response of /overview, /show-overview, /movie-overview — one shared shape.
export interface Overview {
  success: boolean;
  kind?: Kind;
  tmdb_id: number;
  anilist_id?: number | null;
  title: string;
  poster?: string | null;
  backdrop?: string | null;
  banner?: string | null;
  description?: string | null; // may contain AniList HTML
  summary?: string | null; // plain TMDB overview
  status?: string | null;
  year?: string | null;
  genres?: string[];
  seasons: SeasonInfo[];
  total_seasons?: number;
  total_episodes?: number | null;
  runtime?: number | null;
  degraded?: boolean;
  notice?: string | null;
  play?: { tmdb_id: number; media_type: string };
}

// /info/{tmdb}?season=N — episodes for one season, fetched lazily.
export interface SeasonEpisodes {
  success: boolean;
  tmdb_id: number;
  current_season: number;
  available_seasons: number[];
  title?: string | null;
  description?: string | null;
  episodes_list: EpisodeInfo[];
}

// --- /watch NDJSON (contracts/watch_ndjson.schema.json) ----------------------
export type StreamType = "hls" | "mp4" | "iframe";
export interface SubtitleTrack {
  url: string;
  lang: string;
  label?: string;
}
export interface WatchMeta {
  type: "meta";
  success: boolean;
  tmdb_id: number;
  season_number: number | null;
  episode_number: number | null;
  anilist_id: number | null;
  title: string | null;
}
export interface WatchUnaired {
  type: "unaired";
  air_date: string | null;
  title: string | null;
  season_number: number | null;
  episode_number: number | null;
}
export interface StreamLine {
  type: "stream";
  source: string;
  streamType: StreamType;
  url: string;
  language: string | null;
  subtitles: SubtitleTrack[] | null;
  cacheTicket?: string | null;
  origin?: "backend" | "client"; // client annotation, not from the backend
}
export interface WatchDone {
  type: "done";
  count: number;
}
export type WatchLine = WatchMeta | WatchUnaired | StreamLine | WatchDone;

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

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: authHeaders({ Accept: "application/json" }),
    credentials: "include",
    signal,
  });
  if (res.status === 401) throw new ApiError(401, "unauthorised");
  if (!res.ok) throw new ApiError(res.status, `${res.status} on ${path}`);
  return (await res.json()) as T;
}

function tag(cards: MediaCard[] | undefined, kind: Kind): MediaCard[] {
  return (cards ?? []).map((c) => ({ ...c, kind: c.kind ?? kind }));
}

const q = encodeURIComponent;

// --- Public API surface ------------------------------------------------------

export const api = {
  me: (signal?: AbortSignal) =>
    getJson<{ id: string; is_admin?: boolean }>("/account/me", signal),

  // Trending: anime at /trending (key "animes"), plus /trending/shows|movies.
  async trending(kind: Kind, signal?: AbortSignal): Promise<MediaCard[]> {
    if (kind === "anime") {
      const r = await getJson<{ animes: MediaCard[] }>("/trending?limit=24", signal);
      return tag(r.animes, "anime");
    }
    const key = kind === "show" ? "shows" : "movies";
    const r = await getJson<Record<string, MediaCard[]>>(`/trending/${key}?limit=24`, signal);
    return tag(r[key], kind);
  },

  // /catalogue → { animes: [...] } (gzip json). Anime-keyed.
  async catalogue(signal?: AbortSignal): Promise<MediaCard[]> {
    const r = await getJson<{ animes: MediaCard[] }>("/catalogue", signal);
    return tag(r.animes, "anime");
  },

  // /search/{anime|shows|movies}?query_name= → { suggestions: [...] }.
  async search(kind: Kind, term: string, signal?: AbortSignal): Promise<MediaCard[]> {
    const seg = kind === "anime" ? "anime" : kind === "show" ? "shows" : "movies";
    const r = await getJson<{ suggestions: MediaCard[] }>(
      `/search/${seg}?query_name=${q(term)}`,
      signal,
    );
    return tag(r.suggestions, kind);
  },

  overview(kind: Kind, id: number, signal?: AbortSignal): Promise<Overview> {
    if (kind === "movie") return getJson<Overview>(`/movie-overview/${id}`, signal);
    if (kind === "anime") return getJson<Overview>(`/overview/${id}`, signal);
    return getJson<Overview>(`/show-overview/${id}`, signal);
  },

  // Episodes for one season, fetched lazily (overview carries no inline episodes).
  seasonEpisodes: (tmdbId: number, season: number, signal?: AbortSignal) =>
    getJson<SeasonEpisodes>(`/info/${tmdbId}?season=${season}`, signal),

  // Progressive NDJSON — yields meta → (unaired | stream*) → done as each
  // source resolves. Stream lines are tagged origin:"backend".
  async *watch(path: string, signal?: AbortSignal): AsyncGenerator<WatchLine> {
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
