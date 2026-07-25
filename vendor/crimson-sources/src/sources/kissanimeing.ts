/*
 * kissanime.ing source — resolved MAL-direct against megaplay.
 *
 * kissanime.ing is a "dramastream" WordPress skin whose episode player is a
 * gogoanime `newplayer.php?mal_id={mal}&ep={n}&category={sub|dub}` embed that
 * iframes `megaplay.buzz/stream/mal/{mal}/{n}/{sub|dub}`. Because that megaplay
 * path is keyed purely by the MyAnimeList id + episode, the site itself carries no
 * catalog of its own — it is a thin MAL skin over megaplay. So rather than scrape
 * its fragile WP search we go straight to the megaplay MAL endpoint using the MAL
 * id the host resolves from the backend (`ctx.malId`, AniList `idMal` via Fribb),
 * and hand the resulting `megaplay.buzz/stream/...` URL to the shared VidSrc
 * resolver — the same one aniwatch / kissanime use, subtitles included.
 *
 * This is the more robust of the two KissAnime paths (no title-matching, no
 * intermediate hosts) and an independent key into the same CDN, so the two sources
 * back each other up. Like every megaplay path it's E3-only (the CDN's Cloudflare
 * JA3 gate, C3, on top of Referer + Sec-Fetch, C2), with the backend (E0) as floor.
 * Inert until the host wires `ctx.malId` — absent, it simply skips itself.
 */
import { preparePlayback } from "../playback";
import { resolveVidsrc, MEGAPLAY_MEDIA_HEADERS } from "../resolvers/vidsrc";
import { dlog, dwarn } from "../util/debug";
import { NO_FLAGS } from "../types";
import type { ResolvedStream, Source, SourceContext } from "../types";

const MEGAPLAY_BASE = "https://megaplay.buzz";
const LANG_LABELS: Record<string, string> = { sub: "English Sub", dub: "English Dub" };
// SUB first (most anime); DUB is attempted too and simply dropped when megaplay
// has no dub for the title (its resolve returns null → no dead tile).
const CATEGORIES = ["sub", "dub"] as const;

// The megaplay CDN gates its segments on the Sec-Fetch/Accept set beyond
// Referer/Origin/UA; installed as media rules for the player's own fetches.
const SEC_FETCH_HEADERS = {
  Accept: MEGAPLAY_MEDIA_HEADERS["Accept"]!,
  "Accept-Language": MEGAPLAY_MEDIA_HEADERS["Accept-Language"]!,
  "Sec-Fetch-Dest": MEGAPLAY_MEDIA_HEADERS["Sec-Fetch-Dest"]!,
  "Sec-Fetch-Mode": MEGAPLAY_MEDIA_HEADERS["Sec-Fetch-Mode"]!,
  "Sec-Fetch-Site": MEGAPLAY_MEDIA_HEADERS["Sec-Fetch-Site"]!,
};

async function resolve(sctx: SourceContext): Promise<ResolvedStream[]> {
  const { ctx, fetcher, env } = sctx;
  if (ctx.mediaType !== "tv" || ctx.episode == null) return []; // anime episodes only

  const mal = ctx.malId;
  if (mal == null || mal === "") {
    // The MAL id is AniList-derived and host-supplied; without it this source is
    // unrunnable. Say so (once) rather than failing silently — the companion is a
    // separate artifact from the metadata channel, so the wiring can lag.
    dlog(`kissanime.ing: no malId in ctx (tmdb=${ctx.tmdbId}) — skipping (host must fill ctx.malId)`);
    return [];
  }

  // The MAL id already pins the specific season entry, so the within-season
  // episode number is used directly (no season in the path).
  const out: ResolvedStream[] = [];
  for (const cat of CATEGORIES) {
    const streamUrl = `${MEGAPLAY_BASE}/stream/mal/${mal}/${ctx.episode}/${cat}`;
    const upstream = await resolveVidsrc(streamUrl, fetcher);
    if (!upstream) continue;
    const handle = await preparePlayback(env, upstream.url, upstream.headers, upstream.streamType, {
      extraHeaders: SEC_FETCH_HEADERS,
    });
    if (!handle) continue;
    out.push({
      label: "KissAnime.ing",
      streamType: handle.streamType,
      url: handle.url,
      language: LANG_LABELS[cat] ?? null,
      subtitles: upstream.subtitles ?? null,
      mediaRules: handle.mediaRules,
    });
  }
  if (!out.length) dwarn(`kissanime.ing: megaplay had no stream for mal=${mal} ep=${ctx.episode}`);
  return out;
}

export const kissanimeIng: Source = {
  id: "kissanimeing",
  label: "KissAnime.ing",
  supportsMovies: false,
  // C1 + C2 (Referer + Sec-Fetch) + C3 (the megaplay CDN's Cloudflare JA3 gate) =>
  // extension-only (E3); the edge proxy can't supply a Chrome fingerprint.
  flags: { ...NO_FLAGS, needsCORSBypass: true, needsHeaderInjection: true, needsJA3: true },
  resolve,
};
