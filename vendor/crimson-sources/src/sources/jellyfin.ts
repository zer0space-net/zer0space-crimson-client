/*
 * Jellyfin — a backend-resolved, EDGE-delivered source (New System edge-token-injection).
 *
 * Jellyfin's stream needs the server access token on *every* request, not just at
 * resolve — and that token must never reach the browser. So unlike the extension-
 * first sources, Jellyfin is **E2-only**: the backend `/resolve` grant returns the
 * raw, token-LESS Jellyfin URL, and the crimson-proxy edge injects the token from
 * its own env when it fetches (crimson-proxy/utils/inject.ts). Bytes flow
 * Jellyfin → edge → viewer; the token stays on the edge. The companion can't help
 * here (it can't hold the secret), hence `needsEdgeSecret` + `forceProxy`.
 *
 * Gated three ways, all of which fall back cleanly to the backend /watch line (E0):
 *   • the grant 503s unless the backend has JELLYFIN_EDGE_INJECT=on (→ no streams),
 *   • the source is only runnable when a proxy signer (E2) is wired,
 *   • preparePlayback returns null without a signer.
 */
import { preparePlayback } from "../playback";
import { NO_FLAGS } from "../types";
import { dlog } from "../util/debug";
import type { ResolvedStream, Source, SourceContext } from "../types";

export const jellyfin: Source = {
  id: "jellyfin",
  // "Jellyfin" so the edge-delivered tile dedups with / supersedes the backend one.
  label: "Jellyfin",
  supportsMovies: true,
  // The token is an EDGE secret → E2-only (proxied fetcher), never E1/E3.
  flags: { ...NO_FLAGS, needsEdgeSecret: true },

  async resolve(sctx: SourceContext): Promise<ResolvedStream[]> {
    const grant = sctx.env.resolveGrant;
    if (!grant) return [];

    let streams;
    try {
      streams = await grant({ source: "jellyfin", ctx: sctx.ctx });
    } catch (err) {
      dlog("jellyfin: /resolve grant failed:", err);
      return [];
    }
    if (!streams?.length) return [];

    const out: ResolvedStream[] = [];
    for (const s of streams) {
      if (!s?.url) continue;
      // forceProxy: even with the companion on, route through the edge — only it
      // can inject the Jellyfin token.
      const handle = await preparePlayback(
        sctx.env,
        s.url,
        s.headers ?? {},
        s.streamType ?? "hls",
        { forceProxy: true },
      );
      if (!handle) continue; // no E2 signer → leave it to the backend (E0)
      out.push({
        label: s.label || "Jellyfin",
        streamType: handle.streamType,
        url: handle.url,
        language: s.language ?? null,
        subtitles: s.subtitles ?? null,
      });
    }
    return out;
  },
};
