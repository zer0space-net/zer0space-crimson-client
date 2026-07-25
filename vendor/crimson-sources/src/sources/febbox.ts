/*
 * ShowBox / Febbox — a *backend-resolved* source (New System: take the backend out
 * of the byte path, even for cookie-secret sources).
 *
 * Febbox's final hop (`POST febbox.com/file/player`) needs the `ui` session cookie
 * — a C5 secret that must never ship to the browser — so unlike every other source
 * here it cannot scrape in the page. Instead it asks the backend `/resolve` grant to
 * do the token-gated lookup and return the **raw** Febbox OSS file URL (a direct
 * mp4/HLS the viewer can fetch themselves). This engine then delivers those bytes
 * exactly like any other source: extension DNR (E3, CDN → viewer) or the signed
 * crimson-proxy (E2, CDN → edge → viewer). The heavy video never touches the backend
 * — only the few hundred bytes of the grant round-trip do.
 *
 * Routing: declared `needsCORSBypass` because the player sets `crossOrigin` whenever
 * subtitle tracks are present (and the OSS CDN won't answer ACAO for our origin), so
 * it needs E3 or E2 — never plain E1. With neither available the engine skips it and
 * the backend /watch line (same-origin /febbox_proxy) covers it, the E0 floor.
 *
 * The grant is absent unless the host wires `env.resolveGrant` AND the backend has
 * FEBBOX_UI_TOKEN set (the grant 503s / yields nothing otherwise) — so this stays a
 * pure upgrade over the backend path.
 */
import { preparePlayback } from "../playback";
import { NO_FLAGS } from "../types";
import { dlog } from "../util/debug";
import type { ResolvedStream, Source, SourceContext } from "../types";

export const febbox: Source = {
  id: "febbox",
  // "ShowBox" so a locally-delivered tile dedups with (and supersedes) the
  // backend's own "ShowBox" /watch line.
  label: "ShowBox",
  supportsMovies: true,
  // C1 only (CORS bypass for the crossOrigin'd <video>/<track>); the secret is held
  // by the backend grant, NOT a fetcher constraint, so needsServerSecret stays false.
  flags: { ...NO_FLAGS, needsCORSBypass: true },

  async resolve(sctx: SourceContext): Promise<ResolvedStream[]> {
    const grant = sctx.env.resolveGrant;
    if (!grant) {
      dlog("febbox: no resolveGrant wired — leaving it to the backend (E0)");
      return [];
    }

    let streams;
    try {
      streams = await grant({ source: "febbox", ctx: sctx.ctx });
    } catch (err) {
      dlog("febbox: /resolve grant failed:", err);
      return [];
    }
    if (!streams?.length) return [];

    const out: ResolvedStream[] = [];
    for (const s of streams) {
      if (!s?.url) continue;
      const handle = await preparePlayback(
        sctx.env,
        s.url,
        s.headers ?? {},
        s.streamType ?? "mp4",
        { extraDomains: s.extraDomains },
      );
      if (!handle) continue; // no client delivery path -> backend keeps serving it
      out.push({
        label: s.label || "ShowBox",
        streamType: handle.streamType,
        url: handle.url,
        language: s.language ?? null,
        subtitles: s.subtitles ?? null,
        mediaRules: handle.mediaRules,
      });
    }
    return out;
  },
};
