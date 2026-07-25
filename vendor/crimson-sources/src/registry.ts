/*
 * Source registry. Add a source here and the engine will route + run it.
 * Order is the engine's iteration order (and a soft default tile order); the
 * player still re-ranks via the frontend's streamRank.
 *
 * Sources NOT listed here are pinned to the backend (E0) by nature and stay there,
 * served by the /watch stream that runs alongside the local engine (New_System §6):
 *   • Movish   — an HTML-rewriting iframe player-proxy, inherently same-origin.
 *   • Cache, Local — server NAS / admin mounts.
 *   • Subtitles (OpenSubtitles) — quota key (C5); the client merges tracks.
 *
 * Two special cases scrape/resolve on the backend (server-held secret) but deliver
 * the bytes off-backend here:
 *   • ShowBox/Febbox — cookie at resolve only; raw CDN file delivered E3/E2 (febbox.ts).
 *   • Jellyfin — token injected at the crimson-proxy EDGE; E2-only (jellyfin.ts).
 * Both go via the `/resolve` grant and keep the heavy bytes off the backend.
 */
import { cinemabz } from "./sources/cinemabz";
import { playimdb } from "./sources/playimdb";
import { vidking } from "./sources/vidking";
import { aniworld } from "./sources/aniworld";
import { sto } from "./sources/sto";
import { stomirror } from "./sources/stomirror";
// Disabled 2026-07-11: the hidden-tab capture opens the correct bs.to watch tab but
// the companion's play-nudge (trusted click past the invisible reCAPTCHA) doesn't
// start playback, so it never captures a stream — it just leaves a dead tab open.
// The fix lives in the companion extension's resolveInPage, not here; re-add
// `burningseries` to SOURCES below once that nudge works.
// import { burningseries } from "./sources/burningseries";
import { aniwatch } from "./sources/aniwatch";
import { kissanime } from "./sources/kissanime";
import { kissanimeIng } from "./sources/kissanimeing";
import { animesuge } from "./sources/animesuge";
import { screenscape } from "./sources/screenscape";
import { febbox } from "./sources/febbox";
import { jellyfin } from "./sources/jellyfin";
import { hdrezka } from "./sources/hdrezka";
import { lookmovie } from "./sources/lookmovie";
import { insertunit } from "./sources/insertunit";
import { ee3 } from "./sources/ee3";
import type { Source } from "./types";

export const SOURCES: Source[] = [
  // TMDB-keyed aggregators (CORS + Referer only).
  cinemabz,
  playimdb,
  screenscape,
  // Vidking — TMDB-keyed ad-supported HLS SPA; resolved by hidden-tab capture (E3-only).
  vidking,
  // HDRezka — Western + RU-dub movies/TV, direct files, one tile per dub (E3-only).
  hdrezka,
  // LookMovie — Western movies/TV, direct HLS + VTT subs (E3-only, IP-locked).
  lookmovie,
  // Insertunit — IMDb-keyed HLS (RU/UK/EN); inert until host wires ctx.imdbId (E2/E3).
  insertunit,
  // EE3 — movies-only, edge-resolved (session-bound torrent stream); E2-only.
  ee3,
  // s.to-family discovery -> VOE / Vidmoly (residential-IP win for VOE).
  aniworld,
  sto,
  stomirror,
  // Burning Series (bs.to) -> VOE/Vidmoly/Filemoon/Doodstream via hidden-tab capture
  // past its reCAPTCHA gate (extension-only, E3). DISABLED: the play-nudge in the
  // companion never starts playback, so it opens a dead watch tab and captures
  // nothing. Re-enable (here + the import above) once the extension nudge is fixed.
  // burningseries,
  // aniwatch -> VidSrc / megaplay (extension-only; JA3-gated CDN).
  aniwatch,
  // KissAnime (kissanime.com.cv) -> gogoanime streaming.php -> megaplay; title
  // search + episode scrape. Same JA3-gated megaplay CDN as aniwatch (E3-only).
  kissanime,
  // KissAnime.ing -> megaplay MAL endpoint direct (keyed by ctx.malId); an
  // independent key into the same CDN. E3-only; inert until the host wires malId.
  kissanimeIng,
  // AnimeSuge ad-free direct files.
  animesuge,
  // ShowBox/Febbox — backend resolves (cookie secret), client delivers the bytes.
  febbox,
  // Jellyfin — backend resolves, crimson-proxy edge injects the token (E2-only).
  jellyfin,
];
