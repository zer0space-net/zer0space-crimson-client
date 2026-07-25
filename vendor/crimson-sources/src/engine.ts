/*
 * The engine — the client-side counterpart of the backend's stream_watch_response().
 *
 * `streamEpisode` fans every runnable source out concurrently and yields a
 * `StreamLine` the instant each resolves, byte-compatible with the backend's
 * NDJSON `{"type":"stream", …}` lines. The host (crimson-client) feeds these into
 * the exact same `handleLine` it already uses, so a locally-resolved source is
 * indistinguishable from a backend-resolved one — no player rewrite (New_System §7).
 *
 * Routing (New_System §4): each source is placed by `selectFetcher` into the
 * cheapest environment that meets its constraints. A source no available fetcher
 * can run is skipped here and left to the backend (E0) — never a regression.
 *
 * When the extension resolves a stream we also install its DNR media rules so the
 * player can load the raw CDN URL directly. Rules are cleared at the start of
 * each episode and on `dispose()`.
 */
import { probeExtension } from "./extension";
import { selectFetcher } from "./fetchers";
import { SOURCES } from "./registry";
import { dlog, dwarn, setDebug } from "./util/debug";
import type {
  EngineEnv,
  MediaCtx,
  ResolvedEnv,
  ResolvedStream,
  Source,
  StreamLine,
} from "./types";

export interface EngineCapabilities {
  extensionEnabled: boolean;
  canProxy: boolean;
  /** Source ids this environment can run client-side right now. */
  runnableSources: string[];
}

/** Per-source outcome of one `streamEpisode` run — for anonymous host telemetry. */
export interface SourceResult {
  /** The source id (stable key, e.g. "cinemabz"), not the per-tile label. */
  source: string;
  /** The fetcher environment the source ran in (extension/proxied/direct). */
  env: string;
  /** True if the source produced at least one playable stream. */
  ok: boolean;
  /** How many streams it produced (0 on failure / no match). */
  count: number;
}

export interface StreamEpisodeOpts {
  signal?: AbortSignal;
  /**
   * Called once per runnable source as it settles, with its outcome. Lets the
   * host send an anonymous per-source success/failure beacon (it never sees the
   * source internals otherwise). Best-effort: throwing here is swallowed.
   */
  onResult?: (result: SourceResult) => void;
}

export interface Engine {
  capabilities(ctx?: Pick<MediaCtx, "mediaType">): EngineCapabilities;
  /** True if at least one source can run client-side (else the host should just use the backend). */
  canRunAny(ctx?: Pick<MediaCtx, "mediaType">): boolean;
  streamEpisode(ctx: MediaCtx, opts?: StreamEpisodeOpts): AsyncGenerator<StreamLine>;
  /** Tear down any installed extension media rules. */
  dispose(): Promise<void>;
}

function toStreamLine(s: ResolvedStream): StreamLine {
  return {
    type: "stream",
    source: s.label,
    streamType: s.streamType,
    url: s.url,
    language: s.language ?? null,
    subtitles: s.subtitles ?? null,
    cacheTicket: null, // caching stays an E0 concern (New_System §7)
  };
}

function runnableFor(env: ResolvedEnv, mediaType?: "tv" | "movie"): Source[] {
  return SOURCES.filter((src) => {
    if (mediaType === "movie" && !src.supportsMovies) return false;
    return selectFetcher(src.flags, env) !== null;
  });
}

export async function createEngine(rawEnv: EngineEnv): Promise<Engine> {
  if (rawEnv.debug) setDebug(true);
  const probe = await probeExtension(rawEnv.extension ?? null);
  dlog(
    `createEngine: extension=${rawEnv.extension ? "present" : "absent"}, ` +
      `enabled=${probe.enabled}, proxySigner=${rawEnv.signProxyUrl ? "yes" : "no"}`,
  );
  const env: ResolvedEnv = {
    extension: probe.bridge,
    extensionEnabled: probe.enabled,
    proxyBases: rawEnv.proxyBases ?? [],
    signProxyUrl: rawEnv.signProxyUrl ?? null,
    resolveGrant: rawEnv.resolveGrant ?? null,
  };

  async function clearRules(): Promise<void> {
    if (env.extension && env.extensionEnabled) {
      try {
        await env.extension.clearMediaRules();
      } catch {
        /* best-effort */
      }
    }
  }

  async function installRules(s: ResolvedStream): Promise<void> {
    if (!s.mediaRules?.length || !env.extension || !env.extensionEnabled) return;
    try {
      // `replace:false` so each resolved stream's host-scoped rule *accumulates*
      // rather than clobbering the previous source's. The player loads one stream
      // at a time, and rules are keyed by request domain, so VOE's voe-CDN rule
      // and cinema.bz's cinema-CDN rule coexist without conflict — whichever
      // stream the viewer plays finds its matching header profile. Cleared
      // wholesale at the start of each episode and on dispose().
      await env.extension.installMediaRules(s.mediaRules, { replace: false });
    } catch {
      /* a missing rule just means the player may hit CORS/Referer gating */
    }
  }

  return {
    capabilities(ctx): EngineCapabilities {
      return {
        extensionEnabled: env.extensionEnabled,
        canProxy: env.signProxyUrl !== null,
        runnableSources: runnableFor(env, ctx?.mediaType).map((s) => s.id),
      };
    },

    canRunAny(ctx): boolean {
      return runnableFor(env, ctx?.mediaType).length > 0;
    },

    async *streamEpisode(ctx, opts): AsyncGenerator<StreamLine> {
      const signal = opts?.signal;
      const report = (r: SourceResult) => {
        try {
          opts?.onResult?.(r);
        } catch {
          /* telemetry must never break playback */
        }
      };
      await clearRules();

      const sources = runnableFor(env, ctx.mediaType);
      dlog(
        `streamEpisode: ${sources.length} runnable source(s) for ${ctx.mediaType} ` +
          `tmdb=${ctx.tmdbId}` +
          (ctx.season != null ? ` s${ctx.season}e${ctx.episode}` : "") +
          ` -> [${sources.map((s) => `${s.id}:${selectFetcher(s.flags, env)!.id}`).join(", ")}]`,
      );
      // Kick every source off concurrently; tag each promise so we can yield in
      // completion order (the progressive "race" UX, same as the backend).
      const pending = new Map<number, Promise<{ i: number; streams: ResolvedStream[] }>>();
      sources.forEach((src, i) => {
        const fetcher = selectFetcher(src.flags, env)!;
        pending.set(
          i,
          src
            .resolve({ ctx, fetcher, env })
            .then((streams) => {
              // Never silent again: every source reports what it found (or didn't).
              if (streams.length) {
                dlog(
                  `✓ ${src.id} resolved ${streams.length} stream(s): ` +
                    `[${streams.map((s) => `${s.label}/${s.language ?? "?"}`).join(", ")}]`,
                );
              } else {
                dlog(`· ${src.id} resolved 0 streams (no title match / all gated)`);
              }
              report({ source: src.id, env: fetcher.id, ok: streams.length > 0, count: streams.length });
              return { i, streams };
            })
            .catch((err) => {
              dwarn(`✗ ${src.id} threw during resolve:`, err);
              report({ source: src.id, env: fetcher.id, ok: false, count: 0 });
              return { i, streams: [] as ResolvedStream[] };
            }),
        );
      });

      while (pending.size > 0) {
        if (signal?.aborted) return;
        const { i, streams } = await Promise.race(pending.values());
        pending.delete(i);
        for (const s of streams) {
          if (signal?.aborted) return;
          await installRules(s);
          yield toStreamLine(s);
        }
      }
    },

    async dispose(): Promise<void> {
      await clearRules();
    },
  };
}
