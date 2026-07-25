/*
 * VidSrc / megaplay embed resolver — client port of resolvers/vidsrc.py.
 *
 * AniWatch's "VidSrc" server is a megaplay embed. The discovery layer hands us a
 * decoded `…/megaplay/stream/<path>` URL; we rebuild it on megaplay.buzz, read the
 * page's canonical `data-id`, and ask `/stream/getSources` for the HLS master.
 *
 * The megaplay delivery CDN (cdn.mewstream.buzz) sits behind Cloudflare's bot WAF
 * and needs BOTH a megaplay Referer/Origin + the Sec-Fetch-* set AND a real Chrome
 * TLS fingerprint (C2 + C3). The edge proxy can't supply the JA3, which is why
 * this source is E3-only (the extension fetches from a real browser) with E0
 * fallback — exactly the New_System §6 placement.
 */
import type { Fetcher, SubtitleTrack } from "../types";
import type { ResolvedUpstream } from "./common";
import { streamTypeOf } from "./common";

// megaplay's getSources returns soft-subtitle tracks in `tracks[]` (empty for
// hardsubbed anime, populated for many dubs / Western titles). Map the human
// label the player shows to a BCP-47-ish tag; unknown labels pass through as-is.
const LANG_MAP: Record<string, string> = {
  english: "en",
  spanish: "es",
  "spanish - latin america": "es-419",
  portuguese: "pt",
  "portuguese - brazil": "pt-BR",
  french: "fr",
  german: "de",
  italian: "it",
  arabic: "ar",
  russian: "ru",
  japanese: "ja",
  korean: "ko",
  chinese: "zh",
  hindi: "hi",
  indonesian: "id",
  thai: "th",
  vietnamese: "vi",
  turkish: "tr",
  polish: "pl",
  dutch: "nl",
  romanian: "ro",
  greek: "el",
};

function langFromLabel(label: string | undefined): string {
  const key = (label ?? "").trim().toLowerCase();
  if (!key) return "und";
  if (LANG_MAP[key]) return LANG_MAP[key]!;
  // "Spanish - Latin America" / "English (CC)" -> match on the leading word.
  const base = key.split(/[-–(]/)[0]!.trim();
  return LANG_MAP[base] ?? base ?? "und";
}

/** Pull the soft-subtitle tracks out of a megaplay getSources payload (skipping
 *  the scrub-preview VTT it tags as `kind:"thumbnails"`). */
function parseSubtitleTracks(payload: unknown): SubtitleTrack[] {
  const tracks = (payload as { tracks?: unknown })?.tracks;
  if (!Array.isArray(tracks)) return [];
  const out: SubtitleTrack[] = [];
  for (const t of tracks) {
    const file = t?.file;
    if (typeof file !== "string" || !file.startsWith("http")) continue;
    const kind = String(t?.kind ?? "").toLowerCase();
    if (kind === "thumbnails" || kind === "thumbnail") continue;
    const label = typeof t?.label === "string" && t.label.trim() ? t.label.trim() : undefined;
    out.push({ url: file, lang: langFromLabel(label), label });
  }
  return out;
}

const MEGAPLAY_BASE = "https://megaplay.buzz";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// The header set the megaplay stream-path CDN gates on (Referer alone or
// Sec-Fetch alone still 403s; together they pass). Installed as a media rule for
// the player's segment fetches and sent on our API calls.
export const MEGAPLAY_MEDIA_HEADERS: Record<string, string> = {
  Referer: MEGAPLAY_BASE + "/",
  Origin: MEGAPLAY_BASE,
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "cross-site",
};

export async function resolveVidsrc(embedUrl: string, fetcher: Fetcher): Promise<ResolvedUpstream | null> {
  const pathMatch = embedUrl.match(/\/stream\/([^?#]+)/);
  if (!pathMatch) return null;
  const streamPath = pathMatch[1]!.replace(/^\/+|\/+$/g, "");
  const streamPage = `${MEGAPLAY_BASE}/stream/${streamPath}`;

  // The stream page carries the canonical getSources id in data-id; fall back to
  // the last numeric id in the path if the page can't be read.
  let dataId: string | null = null;
  try {
    const page = await fetcher.fetch(streamPage, {
      headers: { "User-Agent": USER_AGENT, Referer: MEGAPLAY_BASE + "/" },
      redirect: "follow",
    });
    if (page.ok && page.bodyEncoding === "text") {
      const idm = page.body.match(/data-id="(\d+)"/);
      if (idm) dataId = idm[1]!;
    }
  } catch {
    /* fall through to the path-derived id */
  }
  if (!dataId) {
    const ids = streamPath.match(/\d+/g);
    dataId = ids && ids.length ? ids[ids.length - 1]! : null;
  }
  if (!dataId) return null;

  let payload: any;
  try {
    const api = await fetcher.fetch(`${MEGAPLAY_BASE}/stream/getSources?id=${dataId}`, {
      headers: {
        "User-Agent": USER_AGENT,
        "X-Requested-With": "XMLHttpRequest",
        Referer: streamPage,
      },
    });
    if (!api.ok || api.bodyEncoding !== "text") return null;
    payload = JSON.parse(api.body);
  } catch {
    return null;
  }

  const sources = payload?.sources;
  let fileUrl: string | undefined;
  if (sources && typeof sources === "object" && !Array.isArray(sources)) {
    if (typeof sources.file === "string") fileUrl = sources.file;
  } else if (Array.isArray(sources)) {
    for (const s of sources) {
      if (s && typeof s.file === "string") {
        fileUrl = s.file;
        break;
      }
    }
  }
  if (!fileUrl || !fileUrl.startsWith("http")) return null;

  const subtitles = parseSubtitleTracks(payload);
  return {
    url: fileUrl,
    streamType: streamTypeOf(fileUrl),
    headers: { referer: MEGAPLAY_BASE + "/", origin: MEGAPLAY_BASE, userAgent: USER_AGENT },
    ...(subtitles.length ? { subtitles } : {}),
  };
}

// --- Shared megaplay embed -> stream helper --------------------------------
// KissAnime and its mirrors don't embed megaplay directly: an episode page hands
// out a gogoanime `streaming.php`/`newplayer.php` embed which *itself* iframes a
// `megaplay.buzz/stream/...` URL. This normalises any such embed to the megaplay
// stream URL `resolveVidsrc` understands: a megaplay URL is returned as-is; a
// gogo (or other) wrapper page is fetched and its megaplay iframe src extracted.
const MEGAPLAY_STREAM_RE = /https?:\/\/[a-z0-9.-]*megaplay\.[a-z.]+\/stream\/[^\s"'<>]+/i;

export async function megaplayUrlFromEmbed(
  embedUrl: string,
  fetcher: Fetcher,
): Promise<string | null> {
  if (MEGAPLAY_STREAM_RE.test(embedUrl)) {
    return embedUrl.match(MEGAPLAY_STREAM_RE)![0]!;
  }
  let page;
  try {
    page = await fetcher.fetch(embedUrl, {
      headers: { "User-Agent": USER_AGENT, Referer: embedUrl },
      redirect: "follow",
    });
  } catch {
    return null;
  }
  if (!page.ok || page.bodyEncoding !== "text") return null;
  const m = page.body.match(MEGAPLAY_STREAM_RE);
  return m ? m[0]! : null;
}
