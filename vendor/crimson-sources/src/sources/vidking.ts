/*
 * Vidking — TMDB-keyed embed, resolved purely by hidden-tab capture (companion v1.0.4+).
 *
 * Vidking (vidking.net) is an ad-supported HLS.js SPA: it mints its own
 * session-bound, obfuscated token *in the browser*, so there's no static request
 * to replay the way cinema.bz / VidSrc expose a `getSources`-style endpoint. Rather
 * than reverse the token we let the page do its OWN work in a real background tab
 * and just watch the network — the companion's `resolveInPage` primitive (the same
 * one Filemoon's "Byse" SPA leans on via stoFamily). The page runs its PoW/decrypt
 * for real, fetches its `.m3u8`, and we capture that URL plus the Referer/Origin/UA
 * it used, then the throwaway tab (and any ad popunders it spawned) is closed.
 *
 * This makes Vidking strictly **E3 (extension-only)**, and for two independent
 * reasons encoded in the flags below: (a) hidden-tab capture is an extension
 * capability the edge/proxy simply doesn't have, and (b) even once captured, the
 * CDN gates its segments on a Vidking Referer and answers no ACAO, so playback
 * needs header injection + a CORS bypass on the viewer's own media fetches. The
 * backend (E0) stays the floor — with no companion the source just skips itself.
 *
 * Embed URLs (per vidking.net/#documentation):
 *   movie: https://www.vidking.net/embed/movie/{tmdb}
 *   tv:    https://www.vidking.net/embed/tv/{tmdb}/{season}/{episode}
 * We append `autoPlay=true` so the lazy player fetches its `.m3u8` without a manual
 * click (the companion also injects a play nudge, but the param makes it fire
 * sooner). Vidking's postMessage events are playback telemetry only — they never
 * carry the source URL — so watching the network is the *only* way to get the stream.
 *
 * Unlike the old vidking-iframe source this replaces, the embed loads as its own
 * top-level tab, not nested in our page, so its framebusting / anti-embed hostility
 * is moot — it runs in exactly the context it expects.
 */
import { preparePlayback } from "../playback";
import { streamTypeOf } from "../resolvers/common";
import { dlog, dwarn } from "../util/debug";
import { NO_FLAGS } from "../types";
import type { MediaCtx, ResolvedStream, Source, SourceContext, UpstreamHeaders } from "../types";

const EMBED_BASE = "https://www.vidking.net/embed";
const VIDKING_REFERER = "https://www.vidking.net/";

/** Build the top-level embed URL the companion opens (movie or TV), or null when
 *  the ctx lacks the ids this source needs. */
function embedUrl(ctx: MediaCtx): string | null {
  const id = ctx.tmdbId;
  if (id == null || id === "") return null;
  if (ctx.mediaType === "tv") {
    if (ctx.season == null || ctx.episode == null) return null;
    return `${EMBED_BASE}/tv/${id}/${ctx.season}/${ctx.episode}?autoPlay=true`;
  }
  return `${EMBED_BASE}/movie/${id}?autoPlay=true`;
}

async function resolve(sctx: SourceContext): Promise<ResolvedStream[]> {
  const { ctx, env } = sctx;
  const ext = env.extension;
  // Hidden-tab capture is the ONLY path here. Feature-detect it: an installed
  // companion older than v1.0.4 (protocol 2) has no `resolveInPage`, so Vidking is
  // unrunnable and we leave it to E0. This is a common footgun — the browser
  // extension is a separate artifact from the vendored source, so it can lag — so
  // we say so out loud rather than failing silently.
  if (!ext || !env.extensionEnabled) {
    dlog("vidking: no enabled companion — skipping (E0 floor)");
    return [];
  }
  if (typeof ext.resolveInPage !== "function") {
    dwarn(
      `vidking: companion v${ext.version} lacks resolveInPage — update the ` +
        "crimson-extension in your browser to v1.0.4+ (protocol 2) for hidden-tab capture",
    );
    return [];
  }

  const embed = embedUrl(ctx);
  if (!embed) {
    dlog(`vidking: no embed URL for ${ctx.mediaType} tmdb=${ctx.tmdbId} (missing season/episode?)`);
    return [];
  }

  // No `mustInclude` for the first cut: accept the first `.m3u8`/`.mp4` the tab
  // fetches, mirroring stoFamily's Filemoon call. If Vidking ever runs an in-player
  // VAST pre-roll whose media fires *before* the real stream, pass the content CDN's
  // host here as a marker so ad media is skipped.
  dlog(`vidking: opening capture tab for ${embed}`);
  let captured;
  try {
    // Two Vidking-specific quirks, both handled by the companion (v1.1.3+):
    //  • `frame:true` — Vidking's embed is built to run *inside an iframe* and
    //    self-destructs (close/redirect) the instant it's the top-level window, so
    //    the companion hosts it in an <iframe> on its wrapper page and captures the
    //    framed player's .m3u8 from the subframe.
    //  • `active:true` — even framed, its ad-SPA player only autoplays (and so only
    //    fetches the stream) while the tab is *visible*; the companion restores the
    //    user's previous tab the instant we're done, so the flash is brief.
    // Max window since it's ad-heavy and lazy-loading.
    captured = await ext.resolveInPage(embed, { timeoutMs: 40000, active: true, frame: true });
  } catch (e) {
    dwarn(`vidking: resolveInPage threw for ${embed}:`, e);
    return [];
  }
  if (!captured || !captured.ok || !captured.url) {
    // captured.error carries the SW's reason, e.g. "resolve-in-page timed out (no
    // media request)" — the signal that tells us whether the tab never played, the
    // .m3u8 URL didn't match the media regex, or an ad/consent wall blocked it.
    dwarn(`vidking: hidden-tab capture found no stream for ${embed} — ${captured?.error ?? "no url"}`);
    return [];
  }

  // Prefer the header profile the player actually used (captured off the wire);
  // fall back to the Vidking origin as a Referer so the CDN still passes.
  const headers: UpstreamHeaders = { ...(captured.headers ?? {}) };
  if (!headers.referer) headers.referer = VIDKING_REFERER;

  const streamType = captured.streamType ?? streamTypeOf(captured.url);
  const handle = await preparePlayback(env, captured.url, headers, streamType);
  if (!handle) {
    dwarn(`vidking: no client playback path for ${captured.url} (extension off mid-resolve?)`);
    return [];
  }
  dlog(`vidking: ✓ captured ${streamType} ${captured.url} (referer=${headers.referer})`);

  return [
    {
      label: "Vidking",
      streamType: handle.streamType,
      url: handle.url,
      mediaRules: handle.mediaRules,
    },
  ];
}

export const vidking: Source = {
  id: "vidking",
  label: "Vidking",
  supportsMovies: true,
  // E3-only. needsCORSBypass + needsHeaderInjection: the captured CDN gates segments
  // on a Vidking Referer and sends no ACAO, so the player's own media fetches need
  // injection + CORS (excludes E1 direct). needsResidentialIP: resolution requires a
  // real browser tab (the hidden-tab capture), which the datacenter edge can't be
  // (excludes E2). Only the companion (E3) satisfies all three; else → backend (E0).
  flags: {
    ...NO_FLAGS,
    needsCORSBypass: true,
    needsHeaderInjection: true,
    needsResidentialIP: true,
  },
  resolve,
};
