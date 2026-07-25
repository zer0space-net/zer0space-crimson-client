/*
 * aniworld.to discovery source (client port of scrapers/aniworld_scraper.py).
 *
 * German s.to-family site; feeds VOE/Vidmoly embeds. Search is the legacy AJAX
 * endpoint; hosters are `<li data-link-target="/redirect/…">` with an `<h4>` name
 * and a `data-lang-key` (1=German Dub, 2=English Sub, 3=German Sub). aniworld has
 * NOT deployed s.to's Turnstile gate, so `/redirect/<id>` still 301s straight to
 * the hoster.
 */
import { createStoFamilySource } from "./stoFamily";
import type { SiteConfig } from "./stoFamily";
import { parseHtml, attr, elText, absolutize } from "./stoFamily";
import type { Fetcher } from "../types";

const BASE = "https://aniworld.to";

const LANG_LABELS: Record<number, string> = { 1: "German Dub", 2: "English Sub", 3: "German Sub" };
const LANG_PREFERENCE = [2, 3, 1]; // subbed over dubbed, English over German
// Doodstream + Filemoon are Cloudflare-gated, so the backend can't resolve them —
// but the companion extension runs from a real browser that clears the passive gate,
// so we can. See resolvers/doodstream.ts + resolvers/filemoon.ts.
const SUPPORTED = new Set(["VOE", "Vidmoly", "Doodstream", "Filemoon"]);

function langRank(key: number): number {
  const i = LANG_PREFERENCE.indexOf(key);
  return i < 0 ? LANG_PREFERENCE.length : i;
}

const config: SiteConfig = {
  id: "aniworld",
  base: BASE,
  showPath: (slug) => `/anime/stream/${slug}`,
  episodePath: (slug, s, e) => `/anime/stream/${slug}/staffel-${s}/episode-${e}`,
  minKeywordLen: 0,

  // aniworld's catalogue is titled in English, so the shared candidate order
  // (English title first — see candidateTitles) already searches the English name
  // ahead of the romaji/native variants. Combined with the season-agnostic root
  // match in stoFamily.searchSlug, the English title now lands the show on the very
  // first keyword instead of being found-but-unmatched.
  async fetchShows(keyword: string, fetcher: Fetcher, base: string) {
    const res = await fetcher.fetch(`${base}/ajax/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        // Present as a genuine in-site XHR (referer + JSON accept). Bare
        // header-less POSTs are the easiest bot signal for the site to rate-limit.
        Accept: "application/json, text/javascript, */*; q=0.01",
        Referer: `${base}/`,
      },
      body: `keyword=${encodeURIComponent(keyword)}`,
    });
    if (!res.ok || res.bodyEncoding !== "text" || !res.body.trim()) return [];
    let results: any;
    try {
      results = JSON.parse(res.body);
    } catch {
      return [];
    }
    const out: Array<{ title: string; slug: string }> = [];
    for (const item of Array.isArray(results) ? results : []) {
      const link = String(item?.link ?? "");
      const m = link.match(/^\/anime\/stream\/([a-z0-9\-]+)$/);
      if (m) out.push({ title: String(item?.title ?? ""), slug: m[1]! });
    }
    return out;
  },

  parseHosters(html: string, base: string) {
    const doc = parseHtml(html);
    const out = [];
    for (const li of doc.all("li[data-link-target]")) {
      const target = attr(li, "data-link-target");
      if (!target.includes("/redirect/")) continue;
      const name = elText(li.querySelector("h4"));
      if (!SUPPORTED.has(name)) continue;
      const key = parseInt(attr(li, "data-lang-key") || "0", 10) || 0;
      out.push({
        redirect: absolutize(base, target),
        language: LANG_LABELS[key] ?? null,
        rank: langRank(key),
      });
    }
    return out;
  },

  async resolveRedirect(redirect: string, fetcher: Fetcher, base: string) {
    try {
      const res = await fetcher.fetch(redirect, { headers: { Referer: base }, redirect: "follow" });
      // aniworld 301s /redirect/<id> straight to the hoster; the followed final
      // URL is that hoster embed.
      if (res.url && hostOf(res.url) !== hostOf(base)) return res.url;
    } catch {
      /* drop this hoster */
    }
    return null;
  },
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export const aniworld = createStoFamilySource(config, "AniWorld");
