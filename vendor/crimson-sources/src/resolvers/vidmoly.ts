/*
 * Vidmoly embed resolver — client port of resolvers/vidmoly.py.
 *
 * Vidmoly serves a JWPlayer page with a `file: "https://…"` (m3u8 or mp4). The
 * embed host rotates (vidmoly.net → vidmoly.biz → …) so the fetch must follow
 * redirects. The CDN gates on a `vidmoly.me` Referer, injected by the extension's
 * media rules; under the extension the raw URL plays directly (no proxy).
 */
import type { Fetcher } from "../types";
import type { ResolvedUpstream } from "./common";
import { streamTypeOf } from "./common";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export const VIDMOLY_REFERER = "https://vidmoly.me/";

export async function resolveVidmoly(embedUrl: string, fetcher: Fetcher): Promise<ResolvedUpstream | null> {
  let body: string;
  try {
    const res = await fetcher.fetch(embedUrl, {
      headers: { "User-Agent": USER_AGENT, Referer: VIDMOLY_REFERER },
      redirect: "follow",
    });
    if (!res.ok || res.bodyEncoding !== "text") return null;
    body = res.body;
  } catch {
    return null;
  }

  const m = body.match(/file\s*:\s*["'](https?:\/\/[^"']+)["']/);
  if (!m) return null;
  const url = m[1]!;

  return {
    url,
    streamType: streamTypeOf(url),
    headers: { referer: VIDMOLY_REFERER, origin: "https://vidmoly.me", userAgent: USER_AGENT },
  };
}
