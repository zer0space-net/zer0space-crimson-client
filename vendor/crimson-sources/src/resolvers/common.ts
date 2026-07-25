/*
 * Shared shape for the embed resolvers (VOE / Vidmoly / VidSrc).
 *
 * A resolver turns a third-party *embed* URL (handed over by a discovery source)
 * into the raw upstream stream URL plus the header profile the CDN gates on. The
 * source then runs it through `preparePlayback`, which — under the extension (E3)
 * — hands the player the raw URL and installs DNR media rules carrying these
 * headers (so the gated segment bytes flow CDN → viewer). This mirrors the
 * backend resolvers, minus the same-origin proxy: the extension replaces it.
 */
import type { StreamType, SubtitleTrack, UpstreamHeaders } from "../types";

export interface ResolvedUpstream {
  url: string;
  streamType: StreamType;
  headers: UpstreamHeaders;
  /** Soft-subtitle tracks the embed exposed alongside the stream, when any (some
   *  players carry none — e.g. hardsubbed anime). Absolute URLs the player loads
   *  directly via <track>, identical to the backend's subtitle lines. */
  subtitles?: SubtitleTrack[];
}

/** Is the upstream an HLS playlist (vs a progressive mp4)? */
export function streamTypeOf(url: string): StreamType {
  return /\.m3u8(\?|$)/i.test(url) ? "hls" : "mp4";
}
