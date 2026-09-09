// AirPlay support for the player.
//
// Two things stand between a phone and a proper "the TV plays the video" AirPlay
// session, as opposed to screen mirroring (which letterboxes the phone's screen
// onto the TV and is what happens without any of this):
//
//  1. **The media has to come out of a URL, not a MediaSource.** hls.js feeds the
//     <video> element from MSE / ManagedMediaSource, and Safari cannot AirPlay
//     that as video — only mirror it. On Apple platforms the m3u8 therefore goes
//     straight into `video.src`, where Safari's own HLS stack takes it and the
//     AirPlay route button appears. See `prefersNativeHls`.
//  2. **The receiver fetches that URL itself.** The Apple TV is a separate device
//     with no zer0space session cookie, so every hop of our session-gated media
//     relay would 401 on it — a black screen on the TV while the phone plays
//     fine. The dashboard mints a short-lived signed token for exactly those
//     relays (`GET /crimson/airplay-token`); appended to the stream URL it lets
//     the receiver through, and the gateway carries it into the playlist's child
//     links as it passes them back.
//
// Nothing here is Apple-specific on the wire: the token simply makes a same-origin
// stream URL self-authenticating, so a plain <video src> works off-device.

import { ROUTER_BASENAME } from "./config";

interface MediaToken {
  param: string;
  token: string;
}

let cached: (MediaToken & { until: number }) | null = null;
let inflight: Promise<MediaToken | null> | null = null;

// The dashboard's token endpoint sits next to the SPA, not behind /crimson/api —
// it is the gateway's own, not the Crimson backend's.
const TOKEN_URL = `${ROUTER_BASENAME}/airplay-token`;

/** A media-relay token for this viewer, or null if the gateway won't mint one. */
export async function mediaToken(): Promise<MediaToken | null> {
  if (cached && cached.until > Date.now()) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(TOKEN_URL, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        token?: string;
        param?: string;
        expires_in?: number;
      };
      if (!data.token) return null;
      const ttl = Math.max(60, (data.expires_in ?? 3600) - 300) * 1000;
      cached = {
        token: data.token,
        param: data.param || "zt",
        until: Date.now() + ttl,
      };
      return cached;
    } catch {
      // An older gateway (or a standalone dev build) has no such endpoint. In-page
      // playback is unaffected; only AirPlay stays mirror-only.
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** True for a URL this origin serves — the only kind the token is valid for. */
export function isSameOrigin(url: string): boolean {
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  try {
    return new URL(url, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

/** `url` with the relay token attached, if it is ours to attach it to. */
export function withToken(url: string, tok: MediaToken | null): string {
  if (!tok || !isSameOrigin(url)) return url;
  if (url.includes(`?${tok.param}=`) || url.includes(`&${tok.param}=`)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${tok.param}=${encodeURIComponent(tok.token)}`;
}

/**
 * Should this browser play HLS natively rather than through hls.js?
 *
 * Only on Apple's stack, and deliberately so: the previous "trust
 * canPlayType first" rule sent m3u8 URLs to Chrome elements that answer
 * "maybe" and then fail with a format error (the old grey-player bug). The
 * marker used here is ManagedMediaSource, which only Safari ships — plus the
 * older-iOS case, where there is no MSE at all and hls.js cannot run anyway.
 */
export function prefersNativeHls(video: HTMLVideoElement, hlsSupported: boolean): boolean {
  if (video.canPlayType("application/vnd.apple.mpegurl") === "") return false;
  return typeof (window as unknown as { ManagedMediaSource?: unknown }).ManagedMediaSource !==
    "undefined" || !hlsSupported;
}

// --- The route picker --------------------------------------------------------

interface AirPlayVideo extends HTMLVideoElement {
  webkitShowPlaybackTargetPicker?: () => void;
}

/** Whether this element can open Safari's AirPlay picker at all. */
export function canPickTarget(video: HTMLVideoElement): boolean {
  return typeof (video as AirPlayVideo).webkitShowPlaybackTargetPicker === "function";
}

export function showTargetPicker(video: HTMLVideoElement): void {
  (video as AirPlayVideo).webkitShowPlaybackTargetPicker?.();
}
