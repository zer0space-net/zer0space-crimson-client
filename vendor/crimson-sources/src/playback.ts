/*
 * Playback preparation — turn a resolved upstream stream URL into a player-ready
 * handle, choosing the delivery shape per environment:
 *
 *   E3 (extension): hand the player the *raw* CDN URL and install DNR media rules
 *                   so its hls.js/<video> fetches carry the gated Referer/Origin
 *                   and read cross-origin. Bytes go CDN → viewer, nothing between.
 *   E2 (proxy):     hand the player a *signed crimson-proxy* URL; the edge injects
 *                   the headers and relays + rewrites the HLS. Bytes go CDN → edge
 *                   → viewer (still off the backend).
 *
 * If neither is available there's no client-side playback path → the source is
 * left to the backend (E0).
 */
import type { PlaybackHandle, ResolvedEnv, StreamType, UpstreamHeaders } from "./types";

/** Registrable-ish host of a URL, for scoping extension media rules. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export interface PlaybackOpts {
  /** Extra request headers to inject on the player's media fetches (e.g. the
   *  megaplay CDN's Sec-Fetch-* set), merged after the referer/origin/UA. */
  extraHeaders?: Record<string, string>;
  /** Extra request domains the media rule should also cover, for sources whose
   *  segments live on a different host than the master playlist. */
  extraDomains?: string[];
  /**
   * Force the E2 (signed crimson-proxy) path even when the extension is present.
   * For edge-secret sources (Jellyfin): only the edge can inject the token, so the
   * extension's raw-URL+DNR path would 401. Returns null when no signer is wired.
   */
  forceProxy?: boolean;
}

/**
 * Build the final playback handle for `upstreamUrl` (typically a master.m3u8)
 * gated on `headers`. Returns `null` when no client-side delivery path exists.
 */
export async function preparePlayback(
  env: ResolvedEnv,
  upstreamUrl: string,
  headers: UpstreamHeaders,
  streamType: StreamType = "hls",
  opts: PlaybackOpts = {},
): Promise<PlaybackHandle | null> {
  // Edge-secret sources (Jellyfin) must go through the proxy even with the
  // extension on — only the edge holds the token to inject.
  if (env.extension && env.extensionEnabled && !opts.forceProxy) {
    const host = hostOf(upstreamUrl);
    const domains = [host, ...(opts.extraDomains ?? [])].filter(Boolean);
    const requestHeaders: Record<string, string> = {};
    if (headers.referer) requestHeaders["Referer"] = headers.referer;
    if (headers.origin) requestHeaders["Origin"] = headers.origin;
    if (headers.userAgent) requestHeaders["User-Agent"] = headers.userAgent;
    Object.assign(requestHeaders, opts.extraHeaders ?? {});
    return {
      url: upstreamUrl,
      streamType,
      mediaRules: [
        {
          // Match the master host; HLS sub-resources resolve relative to it, so
          // same-host segments are covered. `extraDomains` widens this for sources
          // whose segments rotate onto a sibling CDN host.
          requestDomains: domains.length ? domains : undefined,
          requestHeaders,
          cors: true,
        },
      ],
    };
  }

  if (env.signProxyUrl) {
    const signed = await env.signProxyUrl({
      url: upstreamUrl,
      referer: headers.referer ?? "",
      origin: headers.origin ?? "",
      userAgent: headers.userAgent ?? "",
    });
    return { url: signed, streamType };
  }

  return null;
}
