/*
 * Insertunit — IMDb-keyed HLS source, Russian/Ukrainian/English audio + subs
 * (client port of movie-web/providers `sources/insertunit`). Verified live
 * 2026-06-30 against api.insertunit.ws (returns the player `seasons:`/`hls:` data).
 *
 * Flow: GET /embed/imdb/{imdbId} returns a player HTML page.
 *   show:  parse `seasons:(…)` JSON → season → episode (episode string includes the
 *          number) → episode.hls (+ episode.cc subtitles).
 *   movie: parse `hls: "(…)"` + `cc: (…)` JSON.
 *
 * The HLS + the embed page are CORS-open (movie-web's CORS_ALLOWED), so it runs
 * over the E2 proxy or E3 extension; no IP lock, no JA3, no secret. **Needs
 * MediaCtx.imdbId** (host fills it from TMDB external_ids); absent → it skips
 * itself, so it's inert until that wiring lands rather than erroring.
 */
import { preparePlayback } from "../playback";
import { NO_FLAGS } from "../types";
import { dlog, dwarn } from "../util/debug";
import type { ResolvedStream, Source, SourceContext, SubtitleTrack } from "../types";

const BASE = "https://api.insertunit.ws";

interface Subtitle { url: string; name: string }
interface Episode { episode: string; hls: string; cc?: Subtitle[] }
interface Season { season: number; blocked?: boolean; episodes: Episode[] }

/** Map insertunit subtitle names ("Рус…/Укр…/Eng…") to a language code. */
function parseCaptions(cc?: Subtitle[]): SubtitleTrack[] {
  const out: SubtitleTrack[] = [];
  const seen = new Set<string>();
  for (const sub of cc ?? []) {
    let lang = "";
    if (sub.name.includes("Рус")) lang = "ru";
    else if (sub.name.includes("Укр")) lang = "uk";
    else if (sub.name.includes("Eng")) lang = "en";
    else continue;
    if (seen.has(lang)) continue;
    seen.add(lang);
    out.push({ url: sub.url, lang, label: sub.name });
  }
  return out;
}

export const insertunit: Source = {
  id: "insertunit",
  label: "Insertunit",
  supportsMovies: true,
  // Embed page + HLS are CORS-open but cross-origin to us (C1); no IP/JA3/secret.
  flags: { ...NO_FLAGS, needsCORSBypass: true },

  async resolve(ctx: SourceContext): Promise<ResolvedStream[]> {
    const imdb = ctx.ctx.imdbId;
    if (!imdb) {
      dlog("insertunit: no imdbId in ctx — skipping (needs host wiring)");
      return [];
    }

    let res;
    try {
      res = await ctx.fetcher.fetch(`${BASE}/embed/imdb/${imdb}`, { headers: { Referer: `${BASE}/` } });
    } catch (e) {
      dwarn("insertunit: embed fetch threw", e);
      return [];
    }
    if (!res.ok || res.bodyEncoding !== "text") return [];
    const page = res.body;

    let hls: string | null = null;
    let cc: Subtitle[] | undefined;

    if (ctx.ctx.mediaType === "tv") {
      const m = /seasons:(.*)/.exec(page);
      if (!m?.[1]) { dlog("insertunit: no seasons data"); return []; }
      let seasons: Season[];
      try {
        seasons = JSON.parse(m[1]);
      } catch {
        return [];
      }
      const season = seasons.find((s) => s.season === Number(ctx.ctx.season ?? 1) && !s.blocked);
      const ep = season?.episodes.find((e) => e.episode.includes(String(ctx.ctx.episode ?? 1)));
      if (!ep?.hls) { dlog("insertunit: episode not found"); return []; }
      hls = ep.hls;
      cc = ep.cc;
    } else {
      const m = /hls: "([^"]*)/.exec(page);
      if (!m?.[1]) { dlog("insertunit: no movie hls"); return []; }
      hls = m[1];
      const sm = /cc: (.*)/.exec(page);
      if (sm?.[1]) {
        try { cc = JSON.parse(sm[1]); } catch { /* no subs */ }
      }
    }

    if (!hls) return [];
    const subtitles = parseCaptions(cc);
    const handle = await preparePlayback(ctx.env, hls, { referer: `${BASE}/` }, "hls");
    if (!handle) return [];
    return [
      {
        label: "Insertunit",
        streamType: handle.streamType,
        url: handle.url,
        subtitles: subtitles.length ? subtitles : null,
        mediaRules: handle.mediaRules,
      },
    ];
  },
};
