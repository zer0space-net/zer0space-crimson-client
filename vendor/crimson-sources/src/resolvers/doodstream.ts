/*
 * Doodstream embed resolver — a source the BACKEND deliberately can't do.
 *
 * Doodstream (dood.li / d000d.com / d0000d.com / ds2play.com / dooood.com …, the
 * host rotates constantly) sits behind Cloudflare. The backend's datacenter JA3 is
 * passively fingerprinted and blocked, which is why Doodstream was left unresolved
 * server-side ([[aniworld-doodstream-filemoon-blocked]] — "needs a headless
 * browser"). Run from the viewer's *real* browser via the companion extension (E3),
 * the Cloudflare passive gate clears for free (real Chrome JA3 + residential IP),
 * so the classic two-step token dance just works — turning a previously-impossible
 * hoster into a playable one with no backend involvement.
 *
 * The dance (same as yt-dlp's DoodStreamIE):
 *   1. GET the /e/<id> embed page (Referer = the dood host).
 *   2. Pull the `/pass_md5/<a>/<b>` path + the `?token=<tok>` literal off the page.
 *   3. GET /pass_md5/… (Referer = the embed page) → a base CDN URL prefix.
 *   4. final mp4 = <basePrefix> + <10 random chars> + "?token=<tok>&expiry=<now ms>".
 * The CDN gates the mp4 on a Doodstream Referer, injected by the extension's media
 * rules — so segment/file bytes flow CDN → viewer, never the backend.
 */
import type { Fetcher } from "../types";
import type { ResolvedUpstream } from "./common";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Hostnames that belong to the Doodstream family (it rotates often). `playmogo` is
 *  the current front (title "…| DoodStream", preconnects to i.doodcdn.io) that the
 *  s.to-family sites hand out as of 2026-07 — it carries no "dood" substring, so it
 *  must be listed explicitly or every Doodstream embed is silently dropped. */
const DOOD_HOST_HINTS = ["dood", "d000d", "d0000d", "ds2play", "dooood", "do0od", "doods.", "playmogo"];

export function isDoodstream(url: string): boolean {
  const low = url.toLowerCase();
  return DOOD_HOST_HINTS.some((h) => low.includes(h));
}

const RAND_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function randomChars(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += RAND_ALPHABET[Math.floor(Math.random() * RAND_ALPHABET.length)];
  return s;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

export async function resolveDoodstream(embedUrl: string, fetcher: Fetcher): Promise<ResolvedUpstream | null> {
  // Normalise the download (/d/) form to the embed (/e/) form the JS lives on.
  const embed = embedUrl.replace(/\/d\//, "/e/");
  const origin = originOf(embed);
  if (!origin) return null;
  const referer = origin + "/";

  let body: string;
  try {
    const res = await fetcher.fetch(embed, {
      headers: { "User-Agent": USER_AGENT, Referer: referer },
      redirect: "follow",
    });
    if (!res.ok || res.bodyEncoding !== "text") return null;
    body = res.body;
  } catch {
    return null;
  }

  const passMatch = body.match(/\/pass_md5\/[^"'\s]+/);
  if (!passMatch) return null;
  const passPath = passMatch[0];

  // The token literal sits in the page; fall back to the last pass_md5 segment.
  const tokenMatch = body.match(/[?&]token=([a-z0-9]+)/i);
  const token = tokenMatch ? tokenMatch[1]! : passPath.split("/").pop() || "";
  if (!token) return null;

  let prefix: string;
  try {
    const res = await fetcher.fetch(origin + passPath, {
      headers: { "User-Agent": USER_AGENT, Referer: embed },
      redirect: "follow",
    });
    if (!res.ok || res.bodyEncoding !== "text") return null;
    prefix = res.body.trim();
  } catch {
    return null;
  }
  if (!/^https?:\/\//i.test(prefix)) return null;

  const url = `${prefix}${randomChars(10)}?token=${token}&expiry=${Date.now()}`;
  return {
    url,
    streamType: "mp4", // Doodstream serves a progressive mp4, not HLS
    headers: { referer, origin, userAgent: USER_AGENT },
  };
}
