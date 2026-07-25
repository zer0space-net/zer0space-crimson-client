/*
 * Title-matching helpers (src/util/text.ts).
 *
 * These are documented as byte-for-byte equivalents of the backend scrapers'
 * `_normalize` / `_slugify` / `_series_root` / `_search_keywords`. If they drift,
 * a slug the backend matches stops matching client-side and a whole source goes
 * dark silently — so the parity examples from the docstrings are pinned here.
 */
import { describe, expect, it } from "vitest";

import {
  candidateTitles,
  htmlUnescape,
  normalizeTitle,
  pickByRoot,
  pickByTitle,
  searchKeywords,
  seriesRoot,
  slugifyTitle,
} from "../src/util/text";

describe("htmlUnescape", () => {
  it("decodes the entities the scraped markup carries", () => {
    expect(htmlUnescape("Tom &amp; Jerry")).toBe("Tom & Jerry");
    expect(htmlUnescape("&lt;em&gt;hi&lt;/em&gt;")).toBe("<em>hi</em>");
    expect(htmlUnescape("Journey&#39;s End")).toBe("Journey's End");
    expect(htmlUnescape("&quot;quoted&quot;")).toBe('"quoted"');
    expect(htmlUnescape("a&nbsp;b")).toBe("a b");
  });
  it("decodes numeric + hex character references", () => {
    expect(htmlUnescape("&#65;&#x42;")).toBe("AB");
  });
  it("is empty-safe", () => {
    expect(htmlUnescape("")).toBe("");
  });
});

describe("normalizeTitle", () => {
  it("strips tags, de-accents, lowercases to single-spaced alphanumerics", () => {
    expect(normalizeTitle("<em>Frieren</em>: Beyond Journey's End")).toBe(
      "frieren beyond journey s end",
    );
    expect(normalizeTitle("Pokémon")).toBe("pokemon");
    expect(normalizeTitle("  Spy x  Family!! ")).toBe("spy x family");
  });
  it("is null/undefined-safe", () => {
    expect(normalizeTitle(null)).toBe("");
    expect(normalizeTitle(undefined)).toBe("");
  });
});

describe("slugifyTitle", () => {
  it("reproduces the s.to-family slug convention", () => {
    expect(slugifyTitle("Frieren: Beyond Journey's End")).toBe("frieren-beyond-journeys-end");
    expect(slugifyTitle("Pokémon")).toBe("pokemon");
    expect(slugifyTitle("Tom & Jerry")).toBe("tom-jerry");
  });
});

describe("seriesRoot", () => {
  it("strips trailing season/sequel markers", () => {
    expect(seriesRoot("overlord iv")).toBe("overlord");
    expect(seriesRoot("kaguya sama season 3")).toBe("kaguya sama");
    expect(seriesRoot("attack on titan part 2")).toBe("attack on titan");
  });
  it("returns '' when nothing distinctive is left", () => {
    expect(seriesRoot("ii")).toBe("");
  });
});

describe("candidateTitles", () => {
  it("orders English-first and de-duplicates", () => {
    expect(
      candidateTitles({
        titleEnglish: "Frieren",
        title: "Frieren",
        titleRomaji: "Sousou no Frieren",
        titleNative: "葬送のフリーレン",
        synonyms: ["Frieren", "Frieren at the Funeral"],
      }),
    ).toEqual(["Frieren", "Sousou no Frieren", "葬送のフリーレン", "Frieren at the Funeral"]);
  });
});

describe("searchKeywords", () => {
  it("offers subtitle-stripped + short + full + root forms, capped + deduped", () => {
    const kw = searchKeywords(["Frieren: Beyond Journey's End"]);
    expect(kw).toContain("frieren");
    expect(kw.length).toBeLessThanOrEqual(6);
    expect(new Set(kw).size).toBe(kw.length); // no dupes
  });
  it("honours minLen to drop short queries", () => {
    const kw = searchKeywords(["A"], { minLen: 3 });
    expect(kw.every((k) => k.length >= 3)).toBe(true);
  });
});

describe("pickByTitle", () => {
  it("matches an exact normalized title, then a length-guarded prefix", () => {
    const shows = [
      { normTitle: "some other show", slug: "other" },
      { normTitle: "arifureta from commonplace to world s strongest", slug: "arifureta" },
    ];
    // Exact
    expect(pickByTitle(shows, new Set(["arifureta from commonplace to world s strongest"]))).toBe(
      "arifureta",
    );
    // Prefix: candidate carries the season suffix, show title is the base.
    expect(
      pickByTitle(shows, new Set(["arifureta from commonplace to world s strongest season 3"])),
    ).toBe("arifureta");
  });
  it("returns null when nothing matches", () => {
    expect(pickByTitle([{ normTitle: "bleach", slug: "bleach" }], new Set(["naruto"]))).toBeNull();
  });
});

describe("pickByRoot", () => {
  // The regression that motivated this: aniworld titles the show under its base name,
  // but the request carries "Season 3" — full-title matching found the show yet
  // matched nothing. Root matching (season-agnostic slug) lands it.
  it("matches when only the season-stripped roots agree", () => {
    const shows = [
      { normTitle: "arifureta shokugyou de sekai saikyou", slug: "arifureta-shokugyou-de-sekai-saikyou" },
    ];
    const roots = new Set([seriesRoot("arifureta shokugyou de sekai saikyou 3rd season")]);
    expect(pickByRoot(shows, roots)).toBe("arifureta-shokugyou-de-sekai-saikyou");
  });
  it("ignores short, collision-prone roots and empties", () => {
    expect(pickByRoot([{ normTitle: "go", slug: "go" }], new Set(["go"]))).toBeNull();
    expect(pickByRoot([{ normTitle: "bleach", slug: "b" }], new Set())).toBeNull();
  });
  it("does not match unrelated shows", () => {
    const shows = [{ normTitle: "one piece", slug: "one-piece" }];
    expect(pickByRoot(shows, new Set(["naruto shippuuden"].map(seriesRoot)))).toBeNull();
  });
});
