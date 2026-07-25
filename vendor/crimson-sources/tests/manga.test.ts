/*
 * MangaDex client resolver (src/manga/mangadex.ts).
 *
 * The reading counterpart of the video source tests: no network — a mock Fetcher
 * feeds canned MangaDex JSON so we pin the behaviour that must match the (private)
 * backend provider byte-for-byte: repeated array query keys (contentRating[] /
 * translatedLanguage[]), the chapter de-dup + external-chapter drop, and — the whole
 * point of moving this client-side — that page URLs are the RAW @Home CDN URLs (no
 * proxy, no signing), so they drop straight into an <img> with the bytes off-backend.
 */
import { describe, expect, it } from "vitest";

import type { Fetcher, FetchOptions, FetchResult, SourceFlags } from "../src/types";
import { getChapterPages, getChapters, MANGA_FLAGS, resolveMangaId } from "../src/manga/mangadex";

/** A Fetcher that records the URLs it was asked for and replies from a route table. */
function mockFetcher(routes: (url: string) => unknown): { fetcher: Fetcher; urls: string[] } {
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
        body: body !== undefined ? JSON.stringify(body) : "",
        bodyEncoding: "text",
      };
    },
  };
  return { fetcher, urls };
}

describe("MANGA_FLAGS", () => {
  it("needs a CORS bypass but nothing else (routes to E2/E3, never plain E1)", () => {
    expect(MANGA_FLAGS.needsCORSBypass).toBe(true);
    expect(MANGA_FLAGS.needsHeaderInjection).toBe(false);
    expect(MANGA_FLAGS.needsServerSecret).toBe(false);
    expect(MANGA_FLAGS.needsJA3).toBe(false);
  });
});

describe("resolveMangaId", () => {
  it("returns the first title that matches and sends repeated contentRating[] keys", async () => {
    const { fetcher, urls } = mockFetcher((url) =>
      url.includes("/manga?") && url.includes("Chainsaw")
        ? { data: [{ id: "abc-123" }] }
        : { data: [] },
    );
    const id = await resolveMangaId(fetcher, ["Chainsaw Man"], ["safe", "suggestive"]);
    expect(id).toBe("abc-123");
    expect(urls[0]).toContain("contentRating%5B%5D=safe");
    expect(urls[0]).toContain("contentRating%5B%5D=suggestive");
    expect(urls[0]).toContain("order%5Brelevance%5D=desc");
  });

  it("skips blank/duplicate titles and returns null when nothing matches", async () => {
    const { fetcher, urls } = mockFetcher(() => ({ data: [] }));
    const id = await resolveMangaId(fetcher, ["", "X", "x", "X"], []);
    expect(id).toBeNull();
    expect(urls.length).toBe(1); // "", and the "x"/"X" dupes collapse to one call
  });
});

describe("getChapters", () => {
  it("drops external + page-less chapters and de-dups chapter numbers", async () => {
    const { fetcher } = mockFetcher((url) => {
      if (!url.includes("/feed")) return undefined;
      if (url.includes("offset=0")) {
        return {
          total: 4,
          data: [
            { id: "c1", attributes: { chapter: "1", volume: "1", pages: 20, translatedLanguage: "en" } },
            { id: "c1b", attributes: { chapter: "1", pages: 18, translatedLanguage: "en" } }, // dup number
            { id: "cext", attributes: { chapter: "2", pages: 10, externalUrl: "https://x" } }, // external
            { id: "cnop", attributes: { chapter: "3", pages: 0 } }, // no pages
          ],
        };
      }
      return { total: 4, data: [] };
    });
    const chapters = await getChapters(fetcher, "m1", "en", ["safe"]);
    expect(chapters.map((c) => c.id)).toEqual(["c1"]);
    expect(chapters[0].pages).toBe(20);
    expect(chapters[0].language).toBe("en");
  });
});

describe("getChapterPages", () => {
  it("builds RAW @Home URLs (no proxy / no signing) for <img>", async () => {
    const { fetcher } = mockFetcher((url) =>
      url.includes("/at-home/server/ch9")
        ? { baseUrl: "https://cdn.mangadex.network/", chapter: { hash: "HASH", data: ["1.jpg", "2.png"] } }
        : undefined,
    );
    const pages = await getChapterPages(fetcher, "ch9");
    expect(pages).toEqual([
      "https://cdn.mangadex.network/data/HASH/1.jpg",
      "https://cdn.mangadex.network/data/HASH/2.png",
    ]);
    // Not a backend proxy path, not signed — the whole reason this is client-side.
    expect(pages[0]).not.toContain("/manga_proxy");
    expect(pages[0]).not.toContain("&s=");
  });

  it("uses the data-saver track when asked", async () => {
    const { fetcher } = mockFetcher(() => ({
      baseUrl: "https://cdn.mangadex.network",
      chapter: { hash: "H", data: ["big.jpg"], dataSaver: ["small.jpg"] },
    }));
    const pages = await getChapterPages(fetcher, "ch", true);
    expect(pages).toEqual(["https://cdn.mangadex.network/data-saver/H/small.jpg"]);
  });
});
