/*
 * EE3 — movies-only, EDGE-resolved source (New System edge-held-secret, the heaviest
 * variant). ee3 was rebuilt as a SvelteKit app whose stream is the raw torrent file
 * behind a session-bound, rotating `/api/torrent/proxy/{uuid}` gated on
 * `Sec-Fetch-Site: same-origin`. The browser can't fetch it (forbidden headers +
 * cross-origin cookie), and the uuid is bound to whoever read it — so the crimson-proxy
 * EDGE owns the whole flow: it logs in, searches, reads the movie's torrentStreamUrl,
 * and relays the stream with the session + same-origin headers
 * (crimson-proxy/utils/ee3.ts). Creds live only on the edge.
 *
 * This source therefore emits nothing but a *signed marker* the edge understands:
 *   https://ee3.me/__ee3?title=<t>&year=<y>   →  signed crimson-proxy URL
 * It's E2-only (`needsEdgeSecret` → the proxied fetcher; the companion can't hold the
 * secret) and resolves to nothing unless a proxy signer is wired — falling back
 * cleanly to the rest of the sources. Needs MediaCtx.title (+ releaseYear to
 * disambiguate; the edge matches on title+year).
 *
 * Caveat: the payload is the raw ~20GB MKV — plays in Chromium-on-Windows, not
 * universally. See [[movieweb-providers-revival]].
 */
import { preparePlayback } from "../playback";
import { NO_FLAGS } from "../types";
import { candidateTitles } from "../util/text";
import { dlog } from "../util/debug";
import type { ResolvedStream, Source, SourceContext } from "../types";

// Stable marker host the edge recognises (the edge maps it to its configured ee3
// host, so a domain rotation only needs an edge env change, not a client redeploy).
const MARKER = "https://ee3.me/__ee3";

export const ee3: Source = {
  id: "ee3",
  label: "EE3",
  supportsMovies: true,
  // Creds + session-bound resolve live on the edge → E2-only, never E1/E3.
  flags: { ...NO_FLAGS, needsEdgeSecret: true },

  async resolve(sctx: SourceContext): Promise<ResolvedStream[]> {
    if (sctx.ctx.mediaType !== "movie") return []; // ee3 is movies-only
    const title = candidateTitles(sctx.ctx)[0] ?? sctx.ctx.title;
    if (!title) return [];

    const params = new URLSearchParams({ title });
    if (sctx.ctx.releaseYear) params.set("year", String(sctx.ctx.releaseYear));
    const marker = `${MARKER}?${params.toString()}`;

    // forceProxy: sign the marker into a crimson-proxy URL; the edge does the rest.
    const handle = await preparePlayback(sctx.env, marker, {}, "mp4", { forceProxy: true });
    if (!handle) {
      dlog("ee3: no E2 signer wired — skipping (edge resolution unavailable)");
      return [];
    }
    return [
      {
        label: "EE3",
        streamType: handle.streamType,
        url: handle.url,
        language: null,
      },
    ];
  },
};
