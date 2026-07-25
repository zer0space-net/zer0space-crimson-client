/*
 * LookMovie — Western movies/TV, direct HLS + VTT subtitles (client port of
 * movie-web/providers `sources/lookmovie`). Verified live 2026-06-30 against the
 * lmscript.xyz v1 JSON API.
 *
 * Flow (all JSON):
 *   movie: GET /v1/movies?filters[q]=<title>  → items[{id_movie,title,year}]
 *   show:  GET /v1/shows?filters[q]=<title>   → items[{id_show,title,year}]
 *          GET /v1/shows?expand=episodes&id=<id_show> → pick episode.id by s/e
 *   then:  GET /v1/{movies|episodes}/view?expand=streams,subtitles&id=<id>
 *          → streams:{quality:url} (pick best/auto) + subtitles:[{language,url}]
 *
 * The stream is IP-locked to the resolving (residential) IP — datacenter resolves
 * get nothing — so it's E3-only (the companion), backend E0 not applicable (this is
 * a frontend revival). Subtitles are VTT (browser <track>-ready). Needs MediaCtx
 * title + releaseYear (host fills from TMDB).
 */
import { preparePlayback } from "../playback";
import { NO_FLAGS } from "../types";
import { candidateTitles, normalizeTitle } from "../util/text";
import { dlog, dwarn } from "../util/debug";
import type { ResolvedStream, Source, SourceContext, SubtitleTrack } from "../types";

const BASE = "https://lmscript.xyz";
const STREAM_PREF = ["auto", "1080p", "1080", "720p", "720", "480p", "480", "360p", "360", "240p", "240"];

interface SearchItem { id_movie?: number; id_show?: number; title: string; year: number | string }
interface ViewResult {
  streams?: Record<string, string>;
  subtitles?: Array<{ language: string; url: string }>;
}

function titleMatches(ctx: SourceContext["ctx"], title: string, year: number | string): boolean {
  const want = new Set(candidateTitles(ctx).map(normalizeTitle));
  if (ctx.title) want.add(normalizeTitle(ctx.title));
  if (!want.has(normalizeTitle(title))) return false;
  const y = Number(year);
  if (ctx.releaseYear != null && y && Math.abs(y - ctx.releaseYear) > 1) return false;
  return true;
}

async function getJson<T>(ctx: SourceContext, path: string, query: Record<string, string>): Promise<T | null> {
  const qs = new URLSearchParams(query).toString();
  try {
    const res = await ctx.fetcher.fetch(`${BASE}${path}?${qs}`, { headers: { Referer: `${BASE}/` } });
    if (!res.ok || res.bodyEncoding !== "text") return null;
    return JSON.parse(res.body) as T;
  } catch (e) {
    dwarn(`lookmovie: ${path} threw`, e);
    return null;
  }
}

export const lookmovie: Source = {
  id: "lookmovie",
  label: "LookMovie",
  supportsMovies: true,
  // Stream IP-locked (C4) -> E3/residential only; v1 API + CDN cross-origin (C1).
  flags: { ...NO_FLAGS, needsCORSBypass: true, needsResidentialIP: true },

  async resolve(ctx: SourceContext): Promise<ResolvedStream[]> {
    const title = candidateTitles(ctx.ctx)[0] ?? ctx.ctx.title;
    if (!title) return [];
    const isShow = ctx.ctx.mediaType === "tv";

    // 1) search
    const search = await getJson<{ items: SearchItem[] }>(
      ctx,
      isShow ? "/v1/shows" : "/v1/movies",
      { "filters[q]": title },
    );
    const item = search?.items?.find((r) => titleMatches(ctx.ctx, r.title, r.year));
    if (!item) {
      dlog("lookmovie: no title+year match");
      return [];
    }

    // 2) resolve the playable id
    let viewId: string | null = null;
    if (!isShow) {
      viewId = item.id_movie != null ? String(item.id_movie) : null;
    } else if (item.id_show != null) {
      const eps = await getJson<{ episodes?: Array<{ id: number; season: number | string; episode: number | string }> }>(
        ctx,
        "/v1/shows",
        { expand: "episodes", id: String(item.id_show) },
      );
      const ep = eps?.episodes?.find(
        (v) => Number(v.season) === Number(ctx.ctx.season ?? 1) && Number(v.episode) === Number(ctx.ctx.episode ?? 1),
      );
      viewId = ep ? String(ep.id) : null;
    }
    if (!viewId) {
      dlog("lookmovie: no episode/movie id");
      return [];
    }

    // 3) streams + subtitles
    const view = await getJson<ViewResult>(
      ctx,
      isShow ? "/v1/episodes/view" : "/v1/movies/view",
      { expand: "streams,subtitles", id: viewId },
    );
    const streams = view?.streams ?? {};
    let playlist: string | null = null;
    for (const q of STREAM_PREF) {
      if (streams[q]) { playlist = streams[q]!; break; }
    }
    if (!playlist) {
      const keys = Object.keys(streams);
      if (keys.length) playlist = streams[keys[0]!]!;
    }
    if (!playlist) {
      dlog("lookmovie: no stream url");
      return [];
    }

    const subtitles: SubtitleTrack[] = [];
    const seen = new Set<string>();
    for (const sub of view?.subtitles ?? []) {
      const lang = (sub.language || "").slice(0, 2).toLowerCase();
      if (!lang || seen.has(lang)) continue;
      seen.add(lang);
      subtitles.push({ url: `${BASE}${sub.url}`, lang, label: sub.language });
    }

    const handle = await preparePlayback(ctx.env, playlist, { referer: `${BASE}/` }, "hls");
    if (!handle) return [];
    return [
      {
        label: "LookMovie",
        streamType: handle.streamType,
        url: handle.url,
        subtitles: subtitles.length ? subtitles : null,
        mediaRules: handle.mediaRules,
      },
    ];
  },
};
