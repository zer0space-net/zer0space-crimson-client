/*
 * s.to-family discovery routing — the direct-URL-first behaviour.
 *
 * These exercise the shared skeleton (createStoFamilySource -> discover) through a
 * fully-mocked SiteConfig + Fetcher, asserting *which* requests fire:
 *   - a constructible slug resolves straight off the canonical episode URL, and the
 *     search endpoint is never touched (the request-reduction / anti-rate-limit win);
 *   - a slug we can't construct falls back to the original search path.
 */
import { describe, it, expect } from "vitest";
import { createStoFamilySource } from "../src/sources/stoFamily";
import type { SiteConfig } from "../src/sources/stoFamily";
import { normalizeTitle } from "../src/util/text";
import { NO_FLAGS } from "../src/types";
import type { Fetcher, FetchResult, MediaCtx, ResolvedEnv } from "../src/types";

/** Episode HTML the mock serves for a slug that "exists" — carries the hoster marker
 *  parseHosters() keys on. Any other slug gets a marker-less (soft-404-like) page. */
const HOSTER_MARKER = "HAS_HOSTER";

interface Harness {
  source: ReturnType<typeof createStoFamilySource>;
  fetcher: Fetcher;
  fetchedUrls: string[];
  searchCalls: string[];
}

/**
 * Build a source over a mock site. `realSlugs` are the slugs whose episode pages
 * carry hosters; `searchResults` is what the (mocked) search endpoint returns.
 * A unique `host` keeps each case on its own per-host throttle chain.
 */
function makeHarness(opts: {
  host: string;
  realSlugs: string[];
  searchResults?: Array<{ title: string; slug: string }>;
}): Harness {
  const base = `https://${opts.host}`;
  const fetchedUrls: string[] = [];
  const searchCalls: string[] = [];

  const fetcher: Fetcher = {
    id: "direct",
    supports: () => true,
    async fetch(url: string): Promise<FetchResult> {
      fetchedUrls.push(url);
      // Episode page carries the hoster marker only for a "real" slug.
      const isReal = opts.realSlugs.some((s) => url.includes(`/show/${s}/`));
      return {
        ok: true,
        status: 200,
        url,
        headers: {},
        body: isReal ? HOSTER_MARKER : "soft-404 landing",
        bodyEncoding: "text",
      };
    },
  };

  const cfg: SiteConfig = {
    id: `mock-${opts.host}`,
    base,
    showPath: (slug) => `/show/${slug}`,
    episodePath: (slug, s, e) => `/show/${slug}/s${s}/e${e}`,
    minKeywordLen: 0,
    async fetchShows(keyword) {
      searchCalls.push(keyword);
      return opts.searchResults ?? [];
    },
    parseHosters(html) {
      return html.includes(HOSTER_MARKER)
        ? [{ redirect: `${base}/redirect/1`, language: "English Sub", rank: 0 }]
        : [];
    },
    // Resolution is out of scope here — we only assert the discovery routing.
    async resolveRedirect() {
      return null;
    },
  };

  return { source: createStoFamilySource(cfg, opts.host), fetcher, fetchedUrls, searchCalls };
}

const ENV: ResolvedEnv = {
  extension: null,
  extensionEnabled: false,
  proxyBases: [],
  signProxyUrl: null,
  resolveGrant: null,
};

function ctxFor(titleEnglish: string): MediaCtx {
  return { tmdbId: 1, mediaType: "tv", season: 2, episode: 3, titleEnglish };
}

describe("stoFamily direct-URL-first discovery", () => {
  it("hits the canonical episode URL and never touches search when the slug is constructible", async () => {
    const h = makeHarness({ host: "hit.test", realSlugs: ["the-eminence-in-shadow"] });

    await h.source.resolve({ ctx: ctxFor("The Eminence in Shadow"), fetcher: h.fetcher, env: ENV });

    // Exactly one request: the directly-constructed episode URL.
    expect(h.fetchedUrls).toEqual(["https://hit.test/show/the-eminence-in-shadow/s2/e3"]);
    // The search endpoint was never called — the whole point of the fast path.
    expect(h.searchCalls).toEqual([]);
  });

  it("falls back to search when the constructed slug soft-404s (no hosters)", async () => {
    const h = makeHarness({
      host: "miss.test",
      realSlugs: ["localized-slug"], // the site's real slug, NOT derivable from the title
      searchResults: [{ title: "Some German Localized Title", slug: "localized-slug" }],
    });

    const ctx = ctxFor("Some German Localized Title");
    await h.source.resolve({ ctx, fetcher: h.fetcher, env: ENV });

    // Direct probe(s) fired first and missed, so search WAS consulted...
    expect(h.searchCalls.length).toBeGreaterThan(0);
    // ...and the searched slug's episode page was then fetched.
    expect(h.fetchedUrls).toContain("https://miss.test/show/localized-slug/s2/e3");
    // The searched slug happens to differ from the constructed one, so a direct
    // probe for the (wrong) constructed slug fired before search.
    const constructed = normalizeTitle(ctx.titleEnglish!).replace(/ /g, "-");
    expect(h.fetchedUrls[0]).toBe(`https://miss.test/show/${constructed}/s2/e3`);
  });
});
