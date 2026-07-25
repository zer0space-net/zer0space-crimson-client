/*
 * WeebCentral client resolver (src/manga/weebcentral.ts).
 *
 * The HTML twin of the MangaDex resolver tests: no network — a mock Fetcher feeds
 * canned WeebCentral HTML fragments so we pin the scraping that matters — the first
 * `/series/{ULID}/` search hit, the chapter-anchor parse (number pulled from the
 * label, newest-first list reversed to ascending), and that page URLs are the RAW
 * `scans.lastation.us` CDN URLs (no proxy, no signing) for a direct `<img>`.
 */
import { describe, expect, it } from "vitest";

import type { Fetcher, FetchOptions, FetchResult, SourceFlags } from "../src/types";
import { getChapterPages, getChapters, resolveMangaId, WEEBCENTRAL_FLAGS } from "../src/manga/weebcentral";

/** A Fetcher that records requested URLs and replies with canned HTML from a table. */
function mockFetcher(routes: (url: string) => string | undefined): { fetcher: Fetcher; urls: string[] } {
  const urls: string[] = [];
  const fetcher: Fetcher = {
    id: "proxied",
    supports: (_flags: SourceFlags) => true,
    async fetch(url: string, _opts?: FetchOptions): Promise<FetchResult> {
      urls.push(url);
      const body = routes(url);
      return {
        ok: body !== undefined,
        status: body !== undefined ? 200 : 404,
        url,
        headers: {},
        body: body ?? "",
        bodyEncoding: "text",
      };
    },
  };
  return { fetcher, urls };
}

describe("WEEBCENTRAL_FLAGS", () => {
  it("needs a CORS bypass but nothing else (routes to E2/E3, never plain E1)", () => {
    expect(WEEBCENTRAL_FLAGS.needsCORSBypass).toBe(true);
    expect(WEEBCENTRAL_FLAGS.needsHeaderInjection).toBe(false);
    expect(WEEBCENTRAL_FLAGS.needsServerSecret).toBe(false);
    expect(WEEBCENTRAL_FLAGS.needsJA3).toBe(false);
  });
});

describe("resolveMangaId", () => {
  it("returns the first result's ULID and sends %20-encoded search facets", async () => {
    const { fetcher, urls } = mockFetcher((url) =>
      url.includes("/search/data") && url.includes("Eminence")
        ? `<article><a href="https://weebcentral.com/series/01J76XYCXG1EX4EVP4CYWCJBTR/Kage-No-Jitsuryokusha">
             <img></a>
             <a href="https://weebcentral.com/series/01J76XYCXG1EX4EVP4CYWCJBTR/Kage" class="line-clamp-1">The Eminence in Shadow</a></article>`
        : "<div>no results</div>",
    );
    const id = await resolveMangaId(fetcher, ["The Eminence in Shadow"], ["safe"]);
    expect(id).toBe("01J76XYCXG1EX4EVP4CYWCJBTR");
    // Spaces normalised to %20 (not "+") to match the request WeebCentral serves.
    expect(urls[0]).toContain("sort=Best%20Match");
    expect(urls[0]).toContain("display_mode=Full%20Display");
    expect(urls[0]).not.toContain("+");
  });

  it("skips blank/duplicate titles and returns null when nothing matches", async () => {
    const { fetcher, urls } = mockFetcher(() => "<div>nope</div>");
    const id = await resolveMangaId(fetcher, ["", "X", "x", "X"], []);
    expect(id).toBeNull();
    expect(urls.length).toBe(1); // "" skipped; "x"/"X" dupes collapse to one call
  });
});

describe("getChapters", () => {
  it("parses anchors, pulls the number from the label, and reverses to ascending", async () => {
    // Fragment as WeebCentral serves it: newest-first, label in the empty-class span.
    const { fetcher } = mockFetcher((url) =>
      url.includes("/full-chapter-list")
        ? `
        <a href="https://weebcentral.com/chapters/01CHAPTERTWOAAAAAAAAAAAAAA" class="flex">
          <span class="me-2"><svg></svg></span>
          <span class="grow"><span class="">Chapter 2</span></span>
          <time datetime="2026-05-15T12:16:56.309Z">later</time>
        </a>
        <a href="https://weebcentral.com/chapters/01CHAPTERONEAAAAAAAAAAAAAA" class="flex">
          <span class="me-2"><svg></svg></span>
          <span class="grow"><span class="">Episode. 1</span></span>
          <time datetime="2026-05-01T00:00:00.000Z">earlier</time>
        </a>`
        : undefined,
    );
    const chapters = await getChapters(fetcher, "01SERIES", "en", ["safe"]);
    expect(chapters.map((c) => c.id)).toEqual([
      "01CHAPTERONEAAAAAAAAAAAAAA",
      "01CHAPTERTWOAAAAAAAAAAAAAA",
    ]);
    expect(chapters.map((c) => c.chapter)).toEqual(["1", "2"]);
    expect(chapters[0].published_at).toBe("2026-05-01T00:00:00.000Z");
    expect(chapters[0].language).toBe("en");
  });

  it("keeps a named special's label as the title when it has no number", async () => {
    const { fetcher } = mockFetcher(() =>
      `<a href="https://weebcentral.com/chapters/01SPECIALAAAAAAAAAAAAAAAAA">
         <span class="">Special: Prologue</span>
       </a>`,
    );
    const chapters = await getChapters(fetcher, "s", "en", []);
    expect(chapters[0].chapter).toBeNull();
    expect(chapters[0].title).toBe("Special: Prologue");
  });
});

describe("getChapterPages", () => {
  it("returns RAW CDN image URLs (no proxy / no signing) for <img>", async () => {
    const { fetcher } = mockFetcher((url) =>
      url.includes("/chapters/ch1/images")
        ? `<section>
             <img src="https://scans.lastation.us/manga/Kage/0081-001.png" alt="1">
             <img src="https://scans.lastation.us/manga/Kage/0081-002.png" alt="2">
           </section>`
        : undefined,
    );
    const pages = await getChapterPages(fetcher, "ch1");
    expect(pages).toEqual([
      "https://scans.lastation.us/manga/Kage/0081-001.png",
      "https://scans.lastation.us/manga/Kage/0081-002.png",
    ]);
    expect(pages[0]).not.toContain("/manga_proxy");
    expect(pages[0]).not.toContain("&s=");
  });
});
