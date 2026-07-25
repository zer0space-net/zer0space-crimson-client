/*
 * s.to discovery source (client port of scrapers/sto_scraper.py).
 *
 * General-purpose s.to-family site; feeds the same VOE/Vidmoly hosters. Search is
 * the JSON suggest endpoint; hosters are `<button data-play-url="/r?t=…"
 * data-provider-name="…" data-language-label="…">`. s.to fronts hoster resolution
 * with a Cloudflare-Turnstile "redirect gate": `/r?t=` no longer 302s straight to
 * the hoster but serves a `frameBridge` interstitial. We follow as far as we can
 * without solving a captcha (genuine 3xx, then a best-effort prepare-POST); when
 * only the interstitial comes back the hoster is captcha-gated and dropped — the
 * IP mirror (stomirror) and aniworld still resolve those. The shared skeleton +
 * config is reused verbatim by stomirror with a different origin.
 */
import { createStoFamilySource } from "./stoFamily";
import type { SiteConfig } from "./stoFamily";
import { parseHtml, attr, absolutize, htmlUnescape } from "./stoFamily";
import type { Fetcher } from "../types";

const LANG_RANK: Record<string, number> = {
  "English Sub": 0,
  "German Sub": 1,
  "English Dub": 2,
  "German Dub": 3,
};
// Doodstream + Filemoon are Cloudflare-gated (un-resolvable from the backend's
// datacenter IP), but resolvable from the viewer's real browser via the companion.
// See resolvers/doodstream.ts + resolvers/filemoon.ts.
const SUPPORTED = new Set(["VOE", "Vidmoly", "Doodstream", "Filemoon"]);

/** Map an s.to `data-language-label` to a canonical label, or null. */
function classifyLanguage(label: string | null): string | null {
  if (!label) return null;
  const low = label.toLowerCase();
  const sub = low.includes("sub") || low.includes("untertitel");
  const english = low.includes("eng");
  if (english && sub) return "English Sub";
  if (sub) return "German Sub";
  if (english) return "English Dub";
  return "German Dub";
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** The `t=` token out of a `/r?t=<token>` link (percent-decoded, like the form posts). */
function tokenOf(playUrl: string): string {
  const idx = playUrl.indexOf("t=");
  if (idx < 0) return "";
  try {
    return decodeURIComponent(playUrl.slice(idx + 2));
  } catch {
    return playUrl.slice(idx + 2);
  }
}

/** SiteConfig shared by s.to and the IP mirror; `id`/`base` are overridden per site. */
export function makeStoConfig(id: string, base: string): SiteConfig {
  return {
    id,
    base,
    showPath: (slug) => `/serie/${slug}`,
    episodePath: (slug, s, e) => `/serie/${slug}/staffel-${s}/episode-${e}`,
    minKeywordLen: 3, // the suggest endpoint ignores queries under 3 chars

    async fetchShows(keyword: string, fetcher: Fetcher, b: string) {
      const res = await fetcher.fetch(`${b}/api/search/suggest?term=${encodeURIComponent(keyword)}`, {
        headers: { "X-Requested-With": "XMLHttpRequest", Accept: "application/json" },
      });
      if (!res.ok || res.bodyEncoding !== "text") return [];
      let data: any;
      try {
        data = JSON.parse(res.body);
      } catch {
        return [];
      }
      const shows = data && typeof data === "object" ? data.shows : null;
      const out: Array<{ title: string; slug: string }> = [];
      for (const item of Array.isArray(shows) ? shows : []) {
        const url = String(item?.url ?? "");
        const m = url.match(/^\/serie\/([a-z0-9\-]+)$/);
        if (m) out.push({ title: String(item?.name ?? ""), slug: m[1]! });
      }
      return out;
    },

    parseHosters(html: string, b: string) {
      const doc = parseHtml(html);
      const out = [];
      for (const btn of doc.all("button[data-play-url]")) {
        const target = attr(btn, "data-play-url");
        if (!target.includes("/r?")) continue;
        const provider = attr(btn, "data-provider-name").trim();
        if (!SUPPORTED.has(provider)) continue;
        const language = classifyLanguage(attr(btn, "data-language-label") || null);
        out.push({
          redirect: absolutize(b, htmlUnescape(target)),
          language,
          rank: language != null && language in LANG_RANK ? LANG_RANK[language]! : Object.keys(LANG_RANK).length,
        });
      }
      return out;
    },

    async resolveRedirect(redirect: string, fetcher: Fetcher, b: string) {
      try {
        const res = await fetcher.fetch(redirect, { headers: { Referer: b }, redirect: "follow" });
        // Genuine redirect to the hoster (ungated content / the IP mirror).
        if (res.url && hostOf(res.url) !== hostOf(b)) return res.url;
        // Turnstile interstitial: best-effort prepare-POST (recovers ungated hosters).
        if (res.bodyEncoding === "text" && res.body.includes("frameBridge")) {
          const token = tokenOf(redirect);
          if (!token) return null;
          const post = await fetcher.fetch(`${b}/r`, {
            method: "POST",
            headers: { Referer: b, "X-Requested-With": "XMLHttpRequest" },
            body: `t=${encodeURIComponent(token)}`,
            redirect: "follow",
            credentials: "include", // carry the session XSRF cookie if present
          });
          if (post.url && hostOf(post.url) !== hostOf(b)) return post.url;
        }
      } catch {
        /* captcha-gated or unreachable -> drop this hoster */
      }
      return null;
    },
  };
}

// s.to (the short domain) was taken down; serienstream.to is the same site/stack.
export const sto = createStoFamilySource(makeStoConfig("sto", "https://serienstream.to"), "s.to");
