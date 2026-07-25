/*
 * crimson-sources — core types.
 *
 * These mirror the contracts the backend already speaks so the client engine is
 * a drop-in *producer* of the same data, not a new shape the player has to learn:
 *
 *  - `StreamLine` is byte-compatible with one `{"type":"stream", …}` NDJSON line
 *    emitted by the backend's `stream_watch_response()` and consumed by
 *    crimson-client's `streamRank` / CrimsonPlayer. We keep it identical so a
 *    locally-resolved source is indistinguishable from a backend-resolved one.
 *
 *  - `SourceFlags` is the capability manifest from New_System.md §5.3. The fetcher
 *    router (`fetchers.ts`) uses it to place each source in the cheapest execution
 *    environment that can satisfy its constraints (E1 browser / E2 proxy /
 *    E3 extension), always with the backend (E0) as the floor.
 */

/** Playback container the player's hls.js / <video> / iframe path understands. */
export type StreamType = "hls" | "mp4" | "iframe";

/** External subtitle track (only some sources supply these; matches the backend). */
export interface SubtitleTrack {
  url: string;
  /** BCP-47-ish language tag, e.g. "en", "de". */
  lang: string;
  label?: string;
}

/**
 * One resolved source, in the exact shape the frontend appends to its source
 * list (see crimson-client `hooks.js` handleLine). Optional fields stay `null`
 * so the UI renders nothing for them, identical to backend-emitted lines.
 */
export interface StreamLine {
  type: "stream";
  /** User-facing label, e.g. "Cinema.bz (tcloud)". Shown in the source picker. */
  source: string;
  streamType: StreamType;
  url: string;
  language: string | null;
  subtitles: SubtitleTrack[] | null;
  /** Server-side cache ticket — an E0 concern, always null for client-resolved. */
  cacheTicket: string | null;
}

/**
 * What we know about the title being watched.
 *
 * TMDB-keyed sources (cinema.bz, PlayIMDb, ScreenScape) only need `tmdbId` +
 * `mediaType`. The title-matching *discovery* sources (aniworld / s.to /
 * stomirror / aniwatch / AnimeSuge) additionally search the target sites by
 * title, so they consume the AniList title set + synonyms exactly as the backend
 * scrapers do (`media_ctx["title_english"]`, …). Those fields can't be derived in
 * the browser — German synonyms come from TMDB /translations, which needs the
 * server-held TMDB key — so the host fetches them from the backend `/scrape-meta`
 * grant and merges them in here (see crimson-client `clientSources.js`).
 */
export interface MediaCtx {
  tmdbId: string | number;
  mediaType: "tv" | "movie";
  /** TV only. */
  season?: number | null;
  /** TV only. */
  episode?: number | null;
  /** Release year — disambiguates title-only searches (e.g. hdrezka matches the
   *  `(English Title, YEAR)` it lists per result). Host fills it from TMDB. */
  releaseYear?: number | null;
  /** Primary display title (AniList `title` or the TMDB fallback). */
  title?: string;
  titleEnglish?: string | null;
  titleRomaji?: string | null;
  titleNative?: string | null;
  /** Extra search candidates: AniList synonyms + German broadcast titles. */
  synonyms?: string[] | null;
  anilistId?: number | string;
  /** MyAnimeList id, for MAL-keyed sources (kissanime.ing -> megaplay). Host fills
   *  it from the backend /scrape-meta grant (AniList `idMal`, via Fribb); absent =>
   *  those sources skip themselves. Anime/TV only — movies carry no MAL id. */
  malId?: number | string | null;
  /** IMDb id ("tt…"), for IMDb-keyed sources (insertunit). Host fills from TMDB
   *  external_ids; absent => those sources skip themselves. */
  imdbId?: string | null;
}

/**
 * Capability manifest — the constraint set a source imposes (New_System.md §3/§5.3).
 * The router reads this to choose a fetcher; a source whose constraints no
 * available fetcher can meet falls back to the backend (E0).
 */
export interface SourceFlags {
  /** C3 — needs a real Chrome TLS/JA3 fingerprint → E1 or E3 only, never the edge. */
  needsJA3: boolean;
  /** C4 — token bound to the resolving ASN (VOE) → E1 or E3 (viewer's residential IP). */
  needsResidentialIP: boolean;
  /** C2 — must set forbidden headers (Referer/Origin/UA/Sec-Fetch-*) → E2 or E3. */
  needsHeaderInjection: boolean;
  /** C1 — must read a cross-origin response lacking ACAO → E2 or E3. */
  needsCORSBypass: boolean;
  /** C5 — needs a server-held secret → pinned to the backend (E0). */
  needsServerSecret: boolean;
  /**
   * The secret lives on the crimson-proxy EDGE, injected per-request there (e.g.
   * the Jellyfin token). The companion extension can't hold/inject it, so such a
   * source is **E2-only** (proxied fetcher), with the backend (E0) as the floor —
   * never E1/E3. See crimson-proxy/utils/inject.ts + sources/jellyfin.ts.
   */
  needsEdgeSecret: boolean;
}

export const NO_FLAGS: SourceFlags = {
  needsJA3: false,
  needsResidentialIP: false,
  needsHeaderInjection: false,
  needsCORSBypass: false,
  needsServerSecret: false,
  needsEdgeSecret: false,
};

/** Upstream headers a gated CDN requires, threaded through fetch + playback. */
export interface UpstreamHeaders {
  referer?: string;
  origin?: string;
  userAgent?: string;
}

// --- Fetcher abstraction (the E1/E2/E3 seam) -------------------------------

export interface FetchOptions {
  method?: string;
  /** Includes forbidden headers (Referer/Origin/UA); the fetcher decides how to apply them. */
  headers?: Record<string, string>;
  body?: string;
  redirect?: "follow" | "manual" | "error";
  responseType?: "text" | "arraybuffer";
  /**
   * Cookie behaviour for the underlying fetch. Defaults to "omit" everywhere
   * (the extension SW omits credentials). s.to's Turnstile prepare-POST wants the
   * session XSRF cookie, so its source opts into "include".
   */
  credentials?: "omit" | "include" | "same-origin";
}

export interface FetchResult {
  ok: boolean;
  status: number;
  statusText?: string;
  /** Final URL after any redirects the fetcher followed. */
  url: string;
  /** True when the fetch followed one or more redirects to reach `url`. */
  redirected?: boolean;
  headers: Record<string, string>;
  /** Text, or base64 when `responseType:"arraybuffer"`. */
  body: string;
  bodyEncoding: "text" | "base64";
}

export type FetcherId = "extension" | "proxied" | "direct" | "backend";

export interface Fetcher {
  readonly id: FetcherId;
  fetch(url: string, opts?: FetchOptions): Promise<FetchResult>;
  /** Can this fetcher satisfy a source's constraint set? */
  supports(flags: SourceFlags): boolean;
}

// --- Playback preparation (E3 media rules vs E2 signed proxy URL) ----------

/**
 * A media-header rule for the extension to inject on the player's own media
 * fetches (mirrors crimson-extension's installMediaRules contract).
 */
export interface MediaRule {
  requestDomains?: string[];
  urlFilter?: string;
  requestHeaders?: Record<string, string>;
  cors?: boolean;
}

/**
 * The final, player-ready handle for one stream. `url` is what the player loads;
 * `mediaRules`, when present (E3), must be installed before load so the CDN
 * fetches carry the right Referer/Origin and read cross-origin.
 */
export interface PlaybackHandle {
  url: string;
  streamType: StreamType;
  mediaRules?: MediaRule[];
}

// --- Source descriptor -----------------------------------------------------

export interface ResolvedStream {
  label: string;
  streamType: StreamType;
  url: string;
  language?: string | null;
  subtitles?: SubtitleTrack[] | null;
  /** Header rules to install before playback (E3 path only). */
  mediaRules?: MediaRule[];
}

export interface SourceContext {
  ctx: MediaCtx;
  /** Fetcher chosen by the router for this source's flags. */
  fetcher: Fetcher;
  /** Environment, for building the final playback URL (E3 raw+rules vs E2 signed). */
  env: ResolvedEnv;
}

export interface Source {
  id: string;
  label: string;
  flags: SourceFlags;
  supportsMovies: boolean;
  /** Resolve every playable stream this source has for the title (may be empty). */
  resolve(sctx: SourceContext): Promise<ResolvedStream[]>;
}

// --- Engine environment ----------------------------------------------------

// --- Backend resolve grant (cookie/secret-bound sources) -------------------
//
// Some sources can't run in the browser at all because the final hop needs a
// server-held secret (C5) — Febbox's `ui` cookie today, MovieBox/others later.
// But only the *resolve* needs the secret; the URL it yields is a direct CDN file
// the viewer can fetch themselves. So the host asks the backend `/resolve` grant to
// do the token-gated lookup and hand back the **raw** stream URL + the headers the
// CDN wants — and this engine then delivers the bytes via E3/E2 (`preparePlayback`),
// keeping the heavy mp4/HLS off the backend. The grant is the cookie-source twin of
// `signProxyUrl` (New System §8a): a host-supplied function, since only the host
// holds the session token + API base.

/** One raw stream from the backend `/resolve` grant (pre-delivery, raw CDN URL). */
export interface GrantStream {
  /** Display label; must match the backend /watch tile so dedup supersedes it. */
  label: string;
  streamType: StreamType;
  /** Raw CDN URL — NOT a backend proxy path. Delivered via E3/E2 by the engine. */
  url: string;
  /** Headers the CDN gates on (Referer/Origin/UA), injected at delivery. */
  headers?: UpstreamHeaders;
  language?: string | null;
  /** External subtitle tracks (already absolute URLs the player can load). */
  subtitles?: SubtitleTrack[] | null;
  /** Extra hosts the media rule should cover (segments on a sibling CDN). */
  extraDomains?: string[];
}

export interface GrantRequest {
  /** Source key the backend grant registry dispatches on (e.g. "febbox"). */
  source: string;
  ctx: MediaCtx;
}

/** Fields the crimson-proxy signer covers (byte-identical to the backend). */
export interface SignFields {
  url: string;
  referer: string;
  origin: string;
  userAgent: string;
}

/** Minimal typed view of the crimson-extension page API we depend on. */
export interface ExtensionBridge {
  available: boolean;
  version: string;
  hello(): Promise<{ ok: boolean; protocol: number; version: string; enabled: boolean }>;
  status(): Promise<boolean>;
  fetch(url: string, opts?: FetchOptions): Promise<FetchResult>;
  installMediaRules(
    rules: MediaRule[],
    opts?: { replace?: boolean },
  ): Promise<{ ok: boolean; ruleIds: number[] }>;
  clearMediaRules(ruleIds?: number[]): Promise<boolean>;
  /**
   * Run an embed in a hidden background tab and capture the first media URL it
   * fetches (companion v1.0.4+, protocol 2). For SPA/PoW/anti-devtools hosters a
   * static fetch can't crack — the page does its own work; we just watch the
   * network. Optional: absent on older companions, so callers must feature-detect.
   */
  resolveInPage?(
    url: string,
    opts?: {
      timeoutMs?: number;
      mustInclude?: string[];
      /**
       * Open the throwaway tab *focused* (companion v1.1.2+; restored to the user's
       * previous tab when done) instead of backgrounded. Needed for SPA players that
       * only autoplay — and thus only fetch their `.m3u8` — while their tab is visible
       * (Vidking); a background tab is `document.hidden`, so they never start. Older
       * companions ignore the field and open backgrounded (so such a source just
       * keeps timing out — no worse than before). Default: background.
       */
      active?: boolean;
      /**
       * Load the embed inside an `<iframe>` on the companion's wrapper page instead of
       * navigating the tab straight to it (companion v1.1.3+). Needed for players that
       * are built to run *framed* and self-destruct — close/redirect — when they detect
       * they're the top-level window (Vidking). The tab-scoped capture still sees the
       * framed player's `.m3u8`. Older companions ignore the field and navigate directly
       * (so such a source keeps failing — no worse than before). Default: direct navigation.
       */
      frame?: boolean;
    },
  ): Promise<{
    ok: boolean;
    url?: string;
    streamType?: StreamType;
    headers?: UpstreamHeaders;
    error?: string;
  }>;
}

/** Host-supplied configuration. */
export interface EngineEnv {
  /** The crimson-extension bridge when present+enabled (E3), else null. */
  extension?: ExtensionBridge | null;
  /** crimson-proxy origins for the E2 fallback (segment relay). */
  proxyBases?: string[];
  /**
   * Mints a signed crimson-proxy URL via the backend `/sign` grant (New_System §8a).
   * The browser never holds PROXY_SECRET, so without this E2 is unavailable.
   */
  signProxyUrl?: (fields: SignFields) => Promise<string>;
  /**
   * Runs the backend `/resolve` grant for a cookie/secret-bound source and returns
   * its raw streams (the engine then delivers the bytes via E3/E2). Host-supplied
   * because only the host has the session token + API base. Absent => those sources
   * stay on the backend /watch line.
   */
  resolveGrant?: (req: GrantRequest) => Promise<GrantStream[]>;
  /**
   * Verbose engine trace to the console (per-source start/result + the discovery
   * and resolver step trace). Also enabled per-browser by localStorage
   * 'crimson:sources:debug'='1'. Source *failures* are logged regardless of this.
   */
  debug?: boolean;
}

/** Same as EngineEnv but with `enabled` resolved for the extension. */
export interface ResolvedEnv {
  extension: ExtensionBridge | null;
  extensionEnabled: boolean;
  proxyBases: string[];
  signProxyUrl: ((fields: SignFields) => Promise<string>) | null;
  resolveGrant: ((req: GrantRequest) => Promise<GrantStream[]>) | null;
}
