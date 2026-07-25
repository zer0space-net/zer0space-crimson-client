/*
 * Burning Series (bs.to) discovery source — E3 (extension-only).
 *
 * bs.to is the same "German series index that fronts VOE/Vidmoly/Filemoon/Doodstream"
 * shape as the s.to family, but it does NOT fit the stoFamily skeleton, for two
 * reasons that force a bespoke module:
 *
 *   1. Slug + URL convention. bs.to keys series on the *human* title, capitalised and
 *      hyphenated (`/serie/Die-Simpsons-The-Simpsons`), with no lowercase `_slugify`
 *      rule we can reproduce and no JSON suggest endpoint (the `/api/*` surface is
 *      token-gated — `{"unauthorized":"missing_token"}`). Discovery is therefore a
 *      title match against the full catalogue at `/andere-serien` (~10k entries, one
 *      link per series). Episode URLs additionally embed the episode's own title slug
 *      (`…/1-Es-Weihnachtet-Schwer/de`), which we don't know up front — a bare
 *      `…/1/de` soft-404s to the home page — so we read it off the season page.
 *
 *   2. reCAPTCHA-gated hoster reveal. The watch page (`…/de/VOE`) never ships the
 *      embed URL. Clicking `.hoster-player` POSTs `ajax/embed.php` with an *invisible
 *      reCAPTCHA v2* ticket, and only then does bs.to inject the hoster `<iframe>`.
 *      The click handler is itself guarded (`!navigator.webdriver` + a trusted mouse
 *      event with real coordinates), so there is no static request to replay — no
 *      backend/edge fetch can crack it. The only path is to run the real watch page in
 *      a real browser tab and let it do its own work: the companion's `resolveInPage`
 *      hidden-tab capture, exactly like Vidking. That makes this source strictly E3 —
 *      with no companion it skips itself and the backend (E0) stays the floor.
 *
 * Everything downstream is shared: the captured `.m3u8`/`.mp4` (VOE/Filemoon/… CDN)
 * plus the header profile the player used run through `preparePlayback` like any
 * other extension-resolved stream.
 *
 * The three live mirrors (burningseries.ac / burningseries.cx / bs.cine.to) are the
 * same site; we try them in order and lock onto the first that answers, overridable
 * via `VITE_BURNINGSERIES_BASE` without a code change (mirrors stomirror's pattern).
 */
import { preparePlayback } from "../playback";
import { streamTypeOf } from "../resolvers/common";
import { parseHtml, attr, elText } from "../util/dom";
import { absolutize } from "./stoFamily";
import { candidateTitles, normalizeTitle } from "../util/text";
import { NO_FLAGS } from "../types";
import { dlog, dwarn } from "../util/debug";
import type { MediaCtx, ResolvedEnv, ResolvedStream, Source, SourceContext, Fetcher } from "../types";

/** Live bs.to mirrors, tried in order; `VITE_BURNINGSERIES_BASE` prepends an override. */
const DEFAULT_BASES = [
  "https://burningseries.ac",
  "https://burningseries.cx",
  "https://bs.cine.to",
];

function bases(): string[] {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string> }).env;
    const override = env?.["VITE_BURNINGSERIES_BASE"];
    if (override) return [override.replace(/\/+$/, ""), ...DEFAULT_BASES];
  } catch {
    /* no import.meta.env in this context */
  }
  return DEFAULT_BASES;
}

// Hosters we surface. Resolution is generic hidden-tab capture (whatever media the
// hoster fetches), so this set is about label sanity / avoiding junk providers, not
// about which static resolver exists. Kept in step with the s.to-family SUPPORTED set.
const PROVIDER_RANK: Record<string, number> = { VOE: 0, Vidmoly: 1, Filemoon: 2, Doodstream: 3 };

/** Canonicalise a bs.to hoster path segment (`voe` → `VOE`) if supported, else null. */
function canonProvider(seg: string): string | null {
  const low = seg.toLowerCase();
  for (const name of Object.keys(PROVIDER_RANK)) {
    if (name.toLowerCase() === low) return name;
  }
  return null;
}

// bs.to language path segments → canonical labels, mirroring the s.to-family naming
// so the player groups dub/sub variants as tiles. Unknown codes fall through to the
// raw code (still a usable, if un-ranked, tile).
const LANG_LABELS: Record<string, string> = {
  de: "German Dub",
  des: "German Sub",
  en: "English Dub",
  ens: "English Sub",
};
const LANG_RANK: Record<string, number> = {
  "English Sub": 0,
  "German Sub": 1,
  "English Dub": 2,
  "German Dub": 3,
};

function langLabel(code: string): string {
  return LANG_LABELS[code] ?? code;
}
function langRank(code: string): number {
  const label = LANG_LABELS[code];
  return label != null && label in LANG_RANK ? LANG_RANK[label]! : Object.keys(LANG_RANK).length;
}

// Hidden-tab capture opens a real browser tab per hoster, so bound how many we try
// per episode (each also risks ad popunders). One successful tile per language is the
// goal; a failed language may still fall back to its next-ranked hoster within budget.
const MAX_INPAGE_ATTEMPTS = 4;

interface SeriesEntry {
  slug: string;
  /** The catalogue title, e.g. "Die Simpsons | The Simpsons" (German | English | …). */
  title: string;
}

interface HosterLink {
  /** Absolute watch-page URL, e.g. `https://…/serie/…/1-…/de/VOE`. */
  watchUrl: string;
  provider: string;
  langCode: string;
}

// The catalogue is ~1.3 MB; cache the parsed list per base so repeated resolves
// (many episodes / sibling sources in one session) don't refetch it.
const catalogueCache = new Map<string, Promise<SeriesEntry[]>>();

async function fetchCatalogue(fetcher: Fetcher, base: string): Promise<SeriesEntry[]> {
  const res = await fetcher.fetch(`${base}/andere-serien`, { redirect: "follow" });
  if (!res.ok || res.bodyEncoding !== "text") throw new Error(`HTTP ${res.status}`);
  const doc = parseHtml(res.body);
  const out: SeriesEntry[] = [];
  const seen = new Set<string>();
  for (const a of doc.all('a[href^="serie/"]')) {
    // Series-root links only: `serie/<slug>` with no further path (skips the
    // season/episode/hoster links that share the prefix).
    const m = attr(a, "href").match(/^serie\/([^/]+)$/);
    if (!m) continue;
    const slug = m[1]!;
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, title: attr(a, "title") || elText(a) });
  }
  return out;
}

async function loadCatalogue(fetcher: Fetcher, base: string): Promise<SeriesEntry[]> {
  let p = catalogueCache.get(base);
  if (!p) {
    p = fetchCatalogue(fetcher, base);
    catalogueCache.set(base, p);
  }
  try {
    return await p;
  } catch (e) {
    catalogueCache.delete(base); // don't pin a rejected fetch
    throw e;
  }
}

/** Pick the first mirror that serves a non-empty catalogue; returns it plus the list. */
async function pickBase(fetcher: Fetcher): Promise<{ base: string; catalogue: SeriesEntry[] } | null> {
  for (const base of bases()) {
    try {
      const catalogue = await loadCatalogue(fetcher, base);
      if (catalogue.length) return { base, catalogue };
      dwarn(`burningseries: ${base}/andere-serien parsed 0 series — trying next mirror`);
    } catch (e) {
      dwarn(`burningseries: ${base} unreachable`, e);
    }
  }
  return null;
}

/**
 * Match a ctx's candidate titles against the catalogue. bs.to titles bundle the
 * language variants with " | " (e.g. "Attack on Titan | Shingeki no Kyojin | AoT"),
 * so we compare each split part: exact normalized match first, then a length-guarded
 * containment for "X" vs "X: Subtitle" differences.
 */
function matchSeries(catalogue: SeriesEntry[], ctx: MediaCtx): string | null {
  const cands = candidateTitles(ctx).map(normalizeTitle).filter(Boolean);
  if (!cands.length) return null;

  const partsOf = (title: string) =>
    title.split("|").map(normalizeTitle).filter(Boolean);

  for (const entry of catalogue) {
    if (partsOf(entry.title).some((p) => cands.includes(p))) return entry.slug;
  }
  for (const entry of catalogue) {
    for (const p of partsOf(entry.title)) {
      for (const c of cands) {
        if (c.length >= 5 && (p.startsWith(c) || c.startsWith(p))) return entry.slug;
      }
    }
  }
  return null;
}

/** Available language codes off a season page's `<select class="series-language">`. */
function parseLanguages(html: string): string[] {
  const doc = parseHtml(html);
  const out: string[] = [];
  for (const opt of doc.all("select.series-language option")) {
    const code = attr(opt, "value").trim();
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

/** Supported-hoster watch links for `episode` off one (language-scoped) season page. */
function parseHosterLinks(html: string, base: string, episode: number): HosterLink[] {
  const doc = parseHtml(html);
  for (const row of doc.all("table.episodes tr")) {
    const numLink = row.querySelector("td a");
    if (parseInt(elText(numLink), 10) !== episode) continue;
    const out: HosterLink[] = [];
    for (const a of Array.from(row.querySelectorAll("a[href]"))) {
      // Hoster links are `serie/<slug>/<season>/<epslug>/<lang>/<provider>` — 6
      // segments; the plain episode links (5 segments) end at `<lang>`.
      const segs = attr(a, "href").split("/");
      if (segs.length !== 6 || segs[0] !== "serie") continue;
      const provider = canonProvider(segs[5]!);
      if (!provider) continue;
      out.push({ watchUrl: absolutize(base, attr(a, "href")), provider, langCode: segs[4]! });
    }
    return out; // one row matches the episode
  }
  return [];
}

/** Collect every supported hoster link for the episode, across all languages. */
async function collectHosters(
  fetcher: Fetcher,
  base: string,
  slug: string,
  season: number,
  episode: number,
): Promise<HosterLink[]> {
  const seasonUrl = `${base}/serie/${slug}/${season}`;
  let firstRes;
  try {
    firstRes = await fetcher.fetch(seasonUrl, { redirect: "follow" });
  } catch (e) {
    dwarn(`burningseries: season page ${seasonUrl} fetch threw`, e);
    return [];
  }
  if (!firstRes.ok || firstRes.bodyEncoding !== "text") {
    dwarn(`burningseries: season page -> HTTP ${firstRes.status}; giving up`);
    return [];
  }

  const links: HosterLink[] = parseHosterLinks(firstRes.body, base, episode);
  const langsSeen = new Set(links.map((l) => l.langCode));

  // Fetch the remaining language variants (the default page only carries its own
  // language's hosters). Concurrent — these are cheap HTML pages.
  const otherLangs = parseLanguages(firstRes.body).filter((code) => !langsSeen.has(code));
  const extra = await Promise.all(
    otherLangs.map(async (code) => {
      try {
        const res = await fetcher.fetch(`${seasonUrl}/${code}`, { redirect: "follow" });
        if (res.ok && res.bodyEncoding === "text") return parseHosterLinks(res.body, base, episode);
      } catch (e) {
        dwarn(`burningseries: season page (${code}) fetch threw`, e);
      }
      return [] as HosterLink[];
    }),
  );

  const all = [...links, ...extra.flat()];
  // Dedup by watch URL (a language may repeat across the pages we fetched).
  const seen = new Set<string>();
  return all.filter((l) => (seen.has(l.watchUrl) ? false : (seen.add(l.watchUrl), true)));
}

/** Run one watch page through the companion's hidden-tab capture. `resolve` has
 *  already asserted the companion + `resolveInPage` are present. */
async function captureHoster(env: ResolvedEnv, watchUrl: string) {
  const resolveInPage = env.extension!.resolveInPage!;
  let captured;
  try {
    // `active:true` — bs.to's `.hoster-player` only fires on a *trusted* mouse event
    // and its invisible reCAPTCHA scores best from a foregrounded, non-webdriver tab;
    // a backgrounded (`document.hidden`) tab tends to never start. The companion
    // restores the user's previous tab the instant we're done. Not `frame:true`: the
    // watch page is a normal top-level page, not an anti-embed player.
    captured = await resolveInPage(watchUrl, { timeoutMs: 45000, active: true });
  } catch (e) {
    dwarn(`burningseries: resolveInPage threw for ${watchUrl}:`, e);
    return null;
  }
  if (!captured || !captured.ok || !captured.url) {
    dwarn(`burningseries: no stream captured for ${watchUrl} — ${captured?.error ?? "no url"}`);
    return null;
  }
  return {
    url: captured.url,
    streamType: captured.streamType ?? streamTypeOf(captured.url),
    headers: { ...(captured.headers ?? {}) },
  };
}

async function resolve(sctx: SourceContext): Promise<ResolvedStream[]> {
  const { ctx, fetcher, env } = sctx;
  if (ctx.mediaType !== "tv" || ctx.season == null || ctx.episode == null) return [];

  // E3-only: hidden-tab capture is the sole way past bs.to's reCAPTCHA gate.
  const ext = env.extension;
  if (!ext || !env.extensionEnabled) {
    dlog("burningseries: no enabled companion — skipping (E0 floor)");
    return [];
  }
  if (typeof ext.resolveInPage !== "function") {
    dwarn(
      `burningseries: companion v${ext.version} lacks resolveInPage — update the ` +
        "crimson-extension to v1.0.4+ (protocol 2) for hidden-tab capture",
    );
    return [];
  }

  const picked = await pickBase(fetcher);
  if (!picked) {
    dwarn("burningseries: no reachable mirror");
    return [];
  }
  const { base, catalogue } = picked;

  const slug = matchSeries(catalogue, ctx);
  if (!slug) {
    dlog(`burningseries: no catalogue match for [${candidateTitles(ctx).join(" | ")}]`);
    return [];
  }
  dlog(`burningseries: matched slug "${slug}" on ${base}`);

  const hosters = await collectHosters(fetcher, base, slug, ctx.season || 1, ctx.episode);
  if (!hosters.length) {
    dlog(`burningseries: no supported hosters for ${slug} S${ctx.season}E${ctx.episode}`);
    return [];
  }
  // Subbed over dubbed / English over German, then by hoster reliability.
  hosters.sort(
    (a, b) => langRank(a.langCode) - langRank(b.langCode) || PROVIDER_RANK[a.provider]! - PROVIDER_RANK[b.provider]!,
  );
  dlog(
    `burningseries: ${hosters.length} hoster link(s) ` +
      `[${hosters.map((h) => `${h.provider}/${h.langCode}`).join(", ")}]`,
  );

  const out: ResolvedStream[] = [];
  const doneLangs = new Set<string>();
  let budget = MAX_INPAGE_ATTEMPTS;
  for (const h of hosters) {
    if (budget <= 0) break;
    if (doneLangs.has(h.langCode)) continue; // already have a tile for this language
    budget -= 1;

    const cap = await captureHoster(env, h.watchUrl);
    if (!cap) continue;
    const handle = await preparePlayback(env, cap.url, cap.headers, cap.streamType);
    if (!handle) {
      dwarn(`burningseries: no client playback path for ${cap.url} (extension off mid-resolve?)`);
      continue;
    }
    doneLangs.add(h.langCode);
    dlog(`burningseries: ✓ ${h.provider}/${langLabel(h.langCode)} -> ${handle.streamType} ${cap.url}`);
    out.push({
      label: h.provider,
      streamType: handle.streamType,
      url: handle.url,
      language: langLabel(h.langCode),
      mediaRules: handle.mediaRules,
    });
  }
  return out;
}

export const burningseries: Source = {
  id: "burningseries",
  label: "Burning Series",
  supportsMovies: false, // episode-oriented catalogue, no movie ids
  // E3-only, for the same reasons as Vidking: resolution needs a real browser tab
  // (hidden-tab capture past reCAPTCHA — excludes the datacenter edge E2), and the
  // captured hoster CDN gates its segments on a Referer + answers no ACAO, so the
  // player's own media fetches need header injection + a CORS bypass (excludes E1).
  // Only the companion (E3) satisfies all three; else → backend (E0).
  flags: { ...NO_FLAGS, needsCORSBypass: true, needsHeaderInjection: true, needsResidentialIP: true },
  resolve,
};
