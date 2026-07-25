/*
 * VOE embed resolver — client port of resolvers/voe.py (the flagship win).
 *
 * VOE (voe.sx and its rotating mirrors) hides the stream behind an obfuscated
 * `<script type="application/json">` blob. We fetch the embed page, run the exact
 * decode chain the site's own JS does (rot13 → symbol scrub → strip underscores →
 * base64 → char-shift → reverse → base64 → JSON) and pull the HLS `source` (or a
 * progressive `fallback` mp4) out of the decoded payload.
 *
 * Why this is *the* migration win (New_System §3, C4): VOE's delivery CDN binds
 * the stream token to the IP/ASN that resolved the embed (note `asn=` in every
 * playlist/segment URL). Resolving from a datacenter ASN — what the backend does —
 * mints a token the viewer's residential browser then 403s on, which is why the
 * backend has to relay every segment from that same ASN. Resolving in the
 * viewer's own browser mints the token for *their* ASN, so the player can load the
 * CDN directly. The CDN also gates on a `voe.sx` Referer + a fixed mobile UA (the
 * token is UA-bound), both injected by the extension's DNR media rules.
 */
import type { Fetcher } from "../types";
import type { ResolvedUpstream } from "./common";
import { streamTypeOf } from "./common";
import { dlog, dwarn } from "../util/debug";

// The CDN token is bound to this exact UA — the player's segment fetches must
// reuse it (installed as a media rule), so it lives alongside the resolver.
const VOE_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 11; K) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

export const VOE_REFERER = "https://voe.sx/";

// --- the decode chain (mirrors VoeResolver's static helpers) ----------------

function rot13(text: string): string {
  return text.replace(/[a-zA-Z]/g, (ch) => {
    const base = ch <= "Z" ? 65 : 97;
    return String.fromCharCode(((ch.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function cleanSymbols(text: string): string {
  for (const p of ["@$", "^^", "~@", "%?", "*~", "!!", "#&"]) {
    text = text.split(p).join("_");
  }
  return text;
}

function shiftBack(text: string, shift: number): string {
  let out = "";
  for (let i = 0; i < text.length; i++) out += String.fromCharCode(text.charCodeAt(i) - shift);
  return out;
}

/** base64 (standard alphabet) -> UTF-8 string, as Python's `b64decode().decode()`. */
function b64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
  return new TextDecoder("utf-8").decode(bytes);
}

function decodeObfuscated(encoded: string): unknown {
  let s = rot13(encoded);
  s = cleanSymbols(s);
  s = s.replace(/_/g, ""); // clean_underscores
  s = b64ToUtf8(s);
  s = shiftBack(s, 3);
  s = s.split("").reverse().join("");
  s = b64ToUtf8(s);
  return JSON.parse(s);
}

/** Exposed for parity tests against the Python resolver's decode chain. */
export const __voeDecode = decodeObfuscated;

// --- resolver ---------------------------------------------------------------

export async function resolveVoe(embedUrl: string, fetcher: Fetcher): Promise<ResolvedUpstream | null> {
  const headers = { "User-Agent": VOE_USER_AGENT, Referer: embedUrl };

  let html: string;
  try {
    const res = await fetcher.fetch(embedUrl, { headers });
    if (!res.ok || res.bodyEncoding !== "text") {
      dwarn(`voe: embed fetch ${embedUrl} -> HTTP ${res.status} (${res.bodyEncoding})`);
      return null;
    }
    html = res.body;
  } catch (e) {
    dwarn(`voe: embed fetch ${embedUrl} threw`, e);
    return null;
  }

  // Some embeds serve a tiny "Redirecting…" bounce page first.
  if (html.includes("Redirecting...")) {
    const m = html.match(/href\s*=\s*'(.*?)';/);
    if (!m) {
      dwarn(`voe: "Redirecting..." bounce page had no href to follow (${embedUrl})`);
      return null;
    }
    try {
      const res2 = await fetcher.fetch(m[1]!, { headers });
      if (!res2.ok || res2.bodyEncoding !== "text") {
        dwarn(`voe: bounce target -> HTTP ${res2.status} (${res2.bodyEncoding})`);
        return null;
      }
      html = res2.body;
    } catch (e) {
      dwarn(`voe: bounce target fetch threw`, e);
      return null;
    }
  }

  // A content blocker (AdGuard/uBlock/etc.) may substitute a tiny stub for VOE's
  // rotating mirror domain — the resolver did everything right, the request just
  // never reached VOE. Call it out explicitly so a user report is self-explaining.
  if (/blocked by adguard|ublock|adblock|^\s*\/\*\s*blocked/i.test(html) && html.length < 200) {
    dwarn(
      `voe: ${embedUrl} was intercepted by a content blocker ` +
        `(body=${JSON.stringify(html.slice(0, 80))}). Whitelist the streaming hosts ` +
        `in your ad-blocker — this is not a resolver failure.`,
    );
    return null;
  }

  const script = html.match(/<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!script) {
    // Echo a short body so a stub/block page is legible in the trace — a tiny body
    // here means VOE (or an ad-blocker) refused the request, not a parse miss.
    const peek = html.length <= 400 ? ` body=${JSON.stringify(html)}` : "";
    dwarn(`voe: no <script type="application/json"> blob in ${embedUrl} (${html.length} bytes)${peek}`);
    return null;
  }
  const encMatch = script[1]!.trim().match(/\["(.*?)"\]/);
  if (!encMatch) {
    dwarn(`voe: JSON blob had no ["…"] obfuscated payload`);
    return null;
  }

  let data: any;
  try {
    data = decodeObfuscated(encMatch[1]!);
  } catch (e) {
    dwarn(`voe: decode chain threw (rot13→…→json)`, e);
    return null;
  }

  let videoUrl: string | undefined = typeof data?.source === "string" ? data.source : undefined;
  if (!videoUrl) {
    const fallback = Array.isArray(data?.fallback) ? data.fallback : [];
    for (const f of fallback) {
      if (f && typeof f.file === "string") {
        videoUrl = f.file;
        break;
      }
    }
  }
  if (!videoUrl || !videoUrl.startsWith("https://")) {
    dwarn(`voe: decoded payload had no usable https source/fallback`);
    return null;
  }

  dlog(`voe: resolved ${embedUrl} -> ${videoUrl}`);
  return {
    url: videoUrl,
    streamType: streamTypeOf(videoUrl),
    headers: { referer: VOE_REFERER, userAgent: VOE_USER_AGENT },
  };
}
