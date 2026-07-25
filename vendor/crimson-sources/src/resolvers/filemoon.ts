/*
 * Filemoon embed resolver — another hoster the BACKEND deliberately couldn't do.
 *
 * Filemoon (filemoon.sx / .to / .in / .nl / .eu / moonplayer / rotating mirrors) is a
 * Cloudflare-gated JWPlayer host whose config is `p,a,c,k,e,d`-packed. The backend's
 * datacenter JA3 trips the passive Cloudflare gate, so it was left unresolved
 * server-side ([[aniworld-doodstream-filemoon-blocked]] — "encrypted SPA, needs a
 * headless browser"). Run from the viewer's real browser via the companion (E3), the
 * gate clears for free and the only real work is *unpacking the JS* — no headless
 * browser required, just the Dean-Edwards unpacker (util/unpack.ts). So another
 * previously-impossible hoster becomes playable with zero backend involvement.
 *
 * Flow:
 *   1. GET /e/<id> (Referer = the filemoon host). Some embeds wrap the player in a
 *      same-site <iframe>; follow it once if the outer page has no player yet.
 *   2. Unpack the packed `eval(function(p,a,c,k,e,d){…})` blob.
 *   3. Pull `file:"…m3u8"` out of the decoded JWPlayer config.
 * The HLS CDN gates on a Filemoon Referer, injected by the extension's media rules,
 * so segment bytes flow CDN → viewer, never the backend.
 */
import type { Fetcher } from "../types";
import type { ResolvedUpstream } from "./common";
import { streamTypeOf } from "./common";
import { unpackPacked } from "../util/unpack";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Hostnames in the Filemoon family (it rotates mirrors constantly). `byse` is the
 *  "Byse Frontend" SPA mirror the s.to-family sites hand out as of 2026-07 (e.g.
 *  bysezejataos.com); it carries no "moon"/"filemoon" substring, so without it every
 *  Byse-hosted Filemoon embed is silently dropped — and, because the s.to-family's
 *  hidden-tab fallback is itself gated on isFilemoon(), it never even reaches the
 *  in-page capture that the Byse SPA+PoW actually needs. */
const FILEMOON_HOST_HINTS = ["filemoon", "moonplayer", "kerapoxy", "furher", "moonmov", "byse"];

export function isFilemoon(url: string): boolean {
  const low = url.toLowerCase();
  return FILEMOON_HOST_HINTS.some((h) => low.includes(h));
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

/** Pull the first plausible playable URL out of a (possibly unpacked) player config. */
function extractFile(text: string): string | null {
  // Prefer an explicit m3u8, then any file:"…", then a sources[] entry.
  const m =
    text.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i) ||
    text.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*["'](https?:\/\/[^"']+)["']/i) ||
    text.match(/file\s*:\s*["'](https?:\/\/[^"']+)["']/i);
  return m ? m[1]! : null;
}

export async function resolveFilemoon(embedUrl: string, fetcher: Fetcher): Promise<ResolvedUpstream | null> {
  const embed = embedUrl.replace(/\/d\//, "/e/");
  const origin = originOf(embed);
  const referer = origin ? origin + "/" : embedUrl;

  let html: string;
  try {
    const res = await fetcher.fetch(embed, {
      headers: { "User-Agent": USER_AGENT, Referer: referer },
      redirect: "follow",
    });
    if (!res.ok || res.bodyEncoding !== "text") return null;
    html = res.body;
  } catch {
    return null;
  }

  // Some Filemoon embeds nest the actual player in a same-site iframe; follow it
  // once when the outer page carries neither a packed blob nor a JW config.
  if (!/eval\(function\(p,a,c,k,e,d\)|jwplayer|sources\s*:/i.test(html)) {
    const iframe = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (iframe) {
      try {
        const inner = new URL(iframe[1]!, embed).toString();
        const res2 = await fetcher.fetch(inner, {
          headers: { "User-Agent": USER_AGENT, Referer: referer },
          redirect: "follow",
        });
        if (res2.ok && res2.bodyEncoding === "text") html = res2.body;
      } catch {
        /* keep the outer page */
      }
    }
  }

  const decoded = unpackPacked(html) || html;
  const url = extractFile(decoded);
  if (!url) return null;

  return {
    url,
    streamType: streamTypeOf(url),
    headers: { referer, origin, userAgent: USER_AGENT },
  };
}
