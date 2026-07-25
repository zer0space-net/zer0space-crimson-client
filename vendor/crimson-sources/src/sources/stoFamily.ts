/*
 * The s.to-family discovery engine — shared skeleton for aniworld.to, s.to and the
 * s.to IP mirror (client port of scrapers/aniworld_scraper.py + sto_scraper.py +
 * stomirror_scraper.py). These three sites run the same stack and feed the same
 * VOE / Vidmoly hosters, so — exactly like the backend — they are a pure discovery
 * layer: find the show, open the episode page, turn each supported hoster link into
 * a real embed URL, then resolve it with the shared VOE/Vidmoly resolvers.
 *
 * Site differences (search endpoint, page path, hoster markup, redirect gate) are
 * injected via a `SiteConfig` so the matching logic stays in one place and
 * byte-identical to the backend.
 */
import { preparePlayback } from "../playback";
import { resolveVoe } from "../resolvers/voe";
import { resolveVidmoly } from "../resolvers/vidmoly";
import { resolveDoodstream, isDoodstream } from "../resolvers/doodstream";
import { resolveFilemoon, isFilemoon } from "../resolvers/filemoon";
import type { ResolvedUpstream } from "../resolvers/common";
import { streamTypeOf } from "../resolvers/common";
import { parseHtml, attr, elText } from "../util/dom";
import {
  candidateTitles,
  normalizeTitle,
  slugifyTitle,
  searchKeywords,
  seriesRoot,
  pickByTitle,
  pickByRoot,
  htmlUnescape,
} from "../util/text";
import { NO_FLAGS } from "../types";
import { dlog, dwarn } from "../util/debug";
import type { Fetcher, ResolvedStream, Source, SourceContext } from "../types";

// --- per-host request throttle (anti rate-limit) -----------------------------
//
// All three s.to-family sources fan out on every episode load — each runs a
// keyword-search loop, an episode-page fetch, and a concurrent redirect-resolve
// pass. Fired unthrottled they burst a dozen-plus requests at one host in a single
// tick, which is exactly what trips s.to's Cloudflare rate limiter (and leaves the
// slower IP mirror timing out on the extension's 30s ceiling). We serialize
// requests *per host* with a minimum gap, so a single origin never sees a burst —
// distinct hosts (aniworld.to vs serienstream.to vs the mirror IP) still run fully
// in parallel, since each keeps its own chain.
const HOST_MIN_GAP_MS = 300;
const hostChain = new Map<string, Promise<unknown>>();
const hostLastHit = new Map<string, number>();

// How many directly-constructed slugs to probe before falling back to search. The
// s.to family's slug is deterministic (aniworld's English-title slug, s.to's
// localized-title slug), so the primary candidate almost always lands on the first
// try — but we allow a couple of alternates (romaji/synonym/season-root forms)
// before conceding to the heavier search path. Anything not found here is still
// found by the search fallback, so this only bounds the fast path, never coverage.
const MAX_DIRECT_PROBES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function hostOfUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Wrap a fetcher so every request it makes is spaced ≥HOST_MIN_GAP_MS from the
 * previous request to the SAME host. Transparent: sources keep calling
 * `fetcher.fetch(...)` exactly as before — the wrapper is installed once per
 * `discover()` run and threaded through search, episode fetch and redirect resolve.
 */
function politeFetcher(inner: Fetcher): Fetcher {
  return {
    id: inner.id,
    supports: (flags) => inner.supports(flags),
    fetch: (url, opts) => {
      const host = hostOfUrl(url);
      const prev = hostChain.get(host) ?? Promise.resolve();
      // Chain after the previous request to this host; a prior rejection must not
      // break the chain, so swallow it before waiting our turn.
      const run = prev
        .catch(() => {})
        .then(async () => {
          const gap = HOST_MIN_GAP_MS - (Date.now() - (hostLastHit.get(host) ?? 0));
          if (gap > 0) await sleep(gap);
          try {
            return await inner.fetch(url, opts);
          } finally {
            hostLastHit.set(host, Date.now());
          }
        });
      hostChain.set(host, run);
      return run;
    },
  };
}

/** A hoster entry pulled off an episode page, before its redirect is resolved. */
interface Hoster {
  /** The site-relative or absolute redirect link (/redirect/<id> or /r?t=<token>). */
  redirect: string;
  /** Canonical language label (e.g. "English Sub") or null when unknown. */
  language: string | null;
  /** Sort rank — lower plays first (subbed over dubbed, English over German). */
  rank: number;
}

export interface SiteConfig {
  id: string;
  /** Origin without trailing slash, e.g. "https://aniworld.to". */
  base: string;
  /** Build the show landing path, e.g. `/anime/stream/${slug}` or `/serie/${slug}`. */
  showPath(slug: string): string;
  /** The `staffel-N/episode-M` season path segment lives under showPath. */
  episodePath(slug: string, season: number, episode: number): string;
  /** Minimum search-keyword length (s.to ignores <3 chars). */
  minKeywordLen: number;
  /** Query the site's search endpoint; return raw {title, slug} candidates. */
  fetchShows(keyword: string, fetcher: Fetcher, base: string): Promise<Array<{ title: string; slug: string }>>;
  /** Pull supported hoster entries off an episode page. */
  parseHosters(html: string, base: string): Hoster[];
  /** Turn a hoster redirect link into the real third-party embed URL. */
  resolveRedirect(redirect: string, fetcher: Fetcher, base: string): Promise<string | null>;
}

// --- shared discovery (identical to the backend's two-step pipeline) ---------

async function searchSlug(
  ctx: SourceContext["ctx"],
  fetcher: Fetcher,
  cfg: SiteConfig,
): Promise<string | null> {
  const candidates = candidateTitles(ctx);
  dlog(`${cfg.id}: title candidates = [${candidates.join(" | ")}]`);
  if (candidates.length === 0) {
    dwarn(`${cfg.id}: no title candidates — /scrape-meta enrichment likely missing`);
    return null;
  }

  const normCandidates = new Set(candidates.map(normalizeTitle).filter(Boolean));
  // Season-agnostic roots ("… Season 3" -> "…"). These sites host every season
  // under one slug (the season is a URL-path segment), so the search result is the
  // *base series* — "Arifureta: From Commonplace to World's Strongest" for a
  // "… Season 3" request. Matching the full season title never lands; matching the
  // root does, and the caller applies the requested /staffel-N/ afterwards.
  const rootCandidates = new Set(
    [...normCandidates].map(seriesRoot).filter((r) => r.length >= 6),
  );

  // Fast path: the site's search, matched against our candidate titles. Exact/prefix
  // first (a precise same-title hit), then the season-agnostic root (the common case
  // for multi-season shows, and why aniworld searches previously found the show but
  // "matched" nothing).
  for (const keyword of searchKeywords(candidates, { minLen: cfg.minKeywordLen })) {
    let shows: Array<{ title: string; slug: string }>;
    try {
      shows = await cfg.fetchShows(keyword, fetcher, cfg.base);
    } catch (e) {
      dwarn(`${cfg.id}: search "${keyword}" threw`, e);
      continue;
    }
    dlog(`${cfg.id}: search "${keyword}" -> ${shows.length} candidate show(s)`);
    const normShows = shows.map((s) => ({ normTitle: normalizeTitle(s.title), slug: s.slug }));
    const slug = pickByTitle(normShows, normCandidates) ?? pickByRoot(normShows, rootCandidates);
    if (slug) {
      dlog(`${cfg.id}: matched slug "${slug}" via search`);
      return slug;
    }
  }

  // Fallback: construct the slug directly and probe the page. Try each candidate's
  // full slug AND its season-stripped root slug — the site's real slug is the base
  // series (e.g. "arifureta-shokugyou-de-sekai-saikyou"), never the "…-3rd-season"
  // form the full title would produce. De-duplicated so we never probe a host twice.
  const probeSlugs = new Set<string>();
  for (const candidate of candidates) {
    const full = slugifyTitle(candidate);
    if (full) probeSlugs.add(full);
  }
  for (const root of rootCandidates) {
    const rootSlug = slugifyTitle(root);
    if (rootSlug) probeSlugs.add(rootSlug);
  }
  for (const slug of probeSlugs) {
    if (await showExists(slug, fetcher, cfg)) {
      dlog(`${cfg.id}: matched slug "${slug}" via slug-probe fallback`);
      return slug;
    }
  }
  dlog(`${cfg.id}: no slug matched any candidate title`);
  return null;
}

/** The site soft-404s unknown slugs with HTTP 200, so a genuine page is detected
 *  by it linking to its own season pages (`…/staffel-`). */
async function showExists(slug: string, fetcher: Fetcher, cfg: SiteConfig): Promise<boolean> {
  try {
    const res = await fetcher.fetch(cfg.base + cfg.showPath(slug), { redirect: "follow" });
    if (!res.ok || res.bodyEncoding !== "text") return false;
    return res.body.includes(`${cfg.showPath(slug)}/staffel-`);
  } catch {
    return false;
  }
}

/** Match an embed URL to its resolver the way the backend does (substring keyword). */
async function resolveEmbed(embedUrl: string, fetcher: Fetcher): Promise<ResolvedUpstream | null> {
  const low = embedUrl.toLowerCase();
  if (low.includes("voe")) return resolveVoe(embedUrl, fetcher);
  if (low.includes("vidmoly")) return resolveVidmoly(embedUrl, fetcher);
  if (isDoodstream(low)) return resolveDoodstream(embedUrl, fetcher);
  if (isFilemoon(low)) return resolveFilemoon(embedUrl, fetcher);
  return null;
}

/**
 * Last-resort resolve via the companion's hidden-tab capture (v1.0.4+): when a
 * static resolver can't crack a hoster (Filemoon's "Byse" SPA+PoW, or a future
 * obfuscated one), run the embed in a real background tab and grab the media URL it
 * fetches. Feature-detected (older companions lack `resolveInPage`) and best-effort.
 */
async function resolveViaInPage(
  embedUrl: string,
  env: SourceContext["env"],
): Promise<ResolvedUpstream | null> {
  const ext = env.extension;
  if (!ext || !env.extensionEnabled || typeof ext.resolveInPage !== "function") return null;
  try {
    const r = await ext.resolveInPage(embedUrl, {});
    if (!r || !r.ok || !r.url) return null;
    let referer = "";
    try {
      referer = new URL(embedUrl).origin + "/";
    } catch {
      /* leave blank */
    }
    return {
      url: r.url,
      streamType: r.streamType ?? streamTypeOf(r.url),
      // Prefer the headers the page actually used; fall back to the embed origin.
      headers: r.headers ?? { referer },
    };
  } catch {
    return null;
  }
}

/** Player-facing label from the embed host (kept byte-compatible with the backend
 *  resolver names so local↔backend dedup matches on (source, language)). */
function hosterLabel(embedUrl: string): string {
  const low = embedUrl.toLowerCase();
  if (low.includes("voe")) return "Voe";
  if (low.includes("vidmoly")) return "Vidmoly";
  if (isDoodstream(low)) return "Doodstream";
  if (isFilemoon(low)) return "Filemoon";
  return "Stream";
}

/** GET an episode page for `slug`; returns its HTML, or null when unreachable /
 *  non-text. The site soft-404s unknown slugs with HTTP 200, so a null here only
 *  means the request failed — a wrong slug still returns a (hoster-less) page, which
 *  the caller distinguishes by parsing zero supported hosters. */
async function fetchEpisodePage(
  cfg: SiteConfig,
  fetcher: Fetcher,
  slug: string,
  season: number,
  episode: number,
): Promise<string | null> {
  const episodeUrl = cfg.base + cfg.episodePath(slug, season, episode);
  dlog(`${cfg.id}: episode page ${episodeUrl}`);
  try {
    const res = await fetcher.fetch(episodeUrl, { redirect: "follow" });
    if (!res.ok || res.bodyEncoding !== "text") {
      dwarn(`${cfg.id}: episode page -> HTTP ${res.status} (${res.bodyEncoding})`);
      return null;
    }
    return res.body;
  } catch (e) {
    dwarn(`${cfg.id}: episode page fetch threw`, e);
    return null;
  }
}

/**
 * Ordered, de-duplicated slugs to try by *direct construction* — the deterministic
 * slug the s.to family assigns each show. English title first (candidateTitles
 * order: title_english, title, romaji, native, …synonyms), then each title's
 * season-stripped root (these sites host every season under one slug with the season
 * in the URL path, so "Arifureta … Season 3" lives under the base-series slug). This
 * is the same slug set the search-path's probe fallback builds, promoted to the
 * front so the canonical URL is tried *before* the search endpoint is ever touched.
 */
function directSlugCandidates(ctx: SourceContext["ctx"]): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    if (s && !out.includes(s)) out.push(s);
  };
  const candidates = candidateTitles(ctx);
  for (const c of candidates) add(slugifyTitle(c));
  for (const c of candidates) {
    const root = seriesRoot(normalizeTitle(c));
    if (root.length >= 6) add(slugifyTitle(root));
  }
  return out;
}

async function discover(sctx: SourceContext, cfg: SiteConfig): Promise<ResolvedStream[]> {
  const { ctx, env } = sctx;
  if (ctx.mediaType !== "tv" || ctx.season == null || ctx.episode == null) return [];

  // Every request this source makes goes through the per-host throttle, so the
  // direct probes, search loop, episode fetch and the concurrent redirect-resolve
  // pass below can never burst a single origin.
  const fetcher = politeFetcher(sctx.fetcher);
  const season = ctx.season || 1;
  const episode = ctx.episode;

  // Episode pages fetched this run, keyed by slug, so the search fallback never
  // re-requests a page a direct probe already pulled (and re-parsed zero hosters on).
  const episodeCache = new Map<string, string | null>();
  const loadEpisode = async (slug: string): Promise<string | null> => {
    const cached = episodeCache.get(slug);
    if (cached !== undefined) return cached;
    const page = await fetchEpisodePage(cfg, fetcher, slug, season, episode);
    episodeCache.set(slug, page);
    return page;
  };

  let html: string | null = null;
  let slug: string | null = null;
  let hosters: Hoster[] | null = null;

  // 1. DIRECT URL — construct the canonical episode URL and hit it straight away.
  //    Because the slug is deterministic, the common case resolves in a SINGLE
  //    request, skipping the multi-keyword search loop that bursts the host and is
  //    the most likely trigger of its rate limiter. A page that parses supported
  //    hosters is a definitive hit; a wrong slug soft-404s to a hoster-less page and
  //    simply falls through. Reliability is unchanged — search remains the net.
  const directSlugs = directSlugCandidates(ctx).slice(0, MAX_DIRECT_PROBES);
  if (directSlugs.length) dlog(`${cfg.id}: direct slug attempts = [${directSlugs.join(" | ")}]`);
  for (const s of directSlugs) {
    const page = await loadEpisode(s);
    if (!page) continue;
    const found = cfg.parseHosters(page, cfg.base);
    if (found.length > 0) {
      dlog(`${cfg.id}: direct URL hit — slug "${s}" episode page has ${found.length} hoster(s)`);
      html = page;
      slug = s;
      hosters = found;
      break;
    }
  }

  // 2. SEARCH FALLBACK — the original two-step discovery (search endpoint, then a
  //    slug-probe), used only when the direct URL produced no hosters (wrong slug,
  //    or a title whose slug we couldn't construct).
  if (!html) {
    const found = await searchSlug(ctx, fetcher, cfg);
    if (found) {
      const page = await loadEpisode(found);
      if (page) {
        html = page;
        slug = found;
        hosters = cfg.parseHosters(page, cfg.base);
      }
    }
  }

  if (!html || !hosters) {
    dlog(`${cfg.id}: no episode page yielded hosters via direct URL or search`);
    return [];
  }

  hosters.sort((a, b) => a.rank - b.rank);
  dlog(
    `${cfg.id}: slug "${slug}" -> parsed ${hosters.length} supported hoster(s) ` +
      `[${hosters.map((h) => h.language ?? "?").join(", ")}] from ${html.length} bytes`,
  );
  if (hosters.length === 0) return [];

  // Resolve every hoster's redirect to its real embed URL (concurrently).
  const embeds = await Promise.all(
    hosters.map(async (h) => {
      const embed = await cfg.resolveRedirect(h.redirect, fetcher, cfg.base);
      if (embed) dlog(`${cfg.id}: hoster (${h.language ?? "?"}) -> embed ${embed}`);
      else dlog(`${cfg.id}: hoster (${h.language ?? "?"}) ${h.redirect} -> null (gated/unreachable)`);
      return { embed, language: h.language };
    }),
  );

  const out: ResolvedStream[] = [];
  const seen = new Set<string>();
  // Hidden-tab capture spins a real background tab, so bound how many we attempt
  // per episode (each is a heavy fallback for what the static resolvers missed).
  let inPageBudget = 2;
  for (const { embed, language } of embeds) {
    if (!embed || seen.has(embed)) continue;
    seen.add(embed);

    let upstream = await resolveEmbed(embed, fetcher);
    // Hidden-tab capture is reserved for hosters with NO static path — today only
    // Filemoon's "Byse" SPA+PoW (an opened embed page also tends to spawn ad-popup
    // tabs, so we never do it for hosters we can resolve statically). VOE/Vidmoly/
    // Doodstream have working resolvers; if one fails we skip it silently rather
    // than opening sketchy tabs in the viewer's browser.
    if (!upstream && inPageBudget > 0 && isFilemoon(embed.toLowerCase())) {
      inPageBudget -= 1;
      upstream = await resolveViaInPage(embed, env);
      if (upstream) dlog(`${cfg.id}: in-page capture resolved ${embed} -> ${upstream.url}`);
    }
    if (!upstream) {
      dlog(`${cfg.id}: no resolver matched embed ${embed} (or it returned null)`);
      continue;
    }

    const handle = await preparePlayback(env, upstream.url, upstream.headers, upstream.streamType);
    if (!handle) {
      dwarn(`${cfg.id}: no client playback path for ${upstream.url} (extension off and no signer?)`);
      continue;
    }
    // Label byte-compatible with the backend resolver names ("Voe"/"Vidmoly"/
    // "Doodstream"/"Filemoon"); the language travels alongside so the player groups
    // dub/sub variants as tiles.
    const label = hosterLabel(embed);
    dlog(`${cfg.id}: ✓ ${label}/${language ?? "?"} -> ${handle.streamType} ${handle.url}`);
    out.push({
      label,
      streamType: handle.streamType,
      url: handle.url,
      language,
      mediaRules: handle.mediaRules,
    });
  }
  return out;
}

/** Build a Source from a SiteConfig. */
export function createStoFamilySource(cfg: SiteConfig, label: string): Source {
  return {
    id: cfg.id,
    label,
    supportsMovies: false, // these are episode/title-oriented, no movie ids
    // C1 (CORS) + C2 (Referer) for the hoster pages + the VOE/Vidmoly CDNs;
    // VOE additionally needs the residential ASN (C4), satisfied by E1/E3.
    flags: { ...NO_FLAGS, needsCORSBypass: true, needsHeaderInjection: true, needsResidentialIP: true },
    resolve: (sctx) => discover(sctx, cfg),
  };
}

// --- helpers exported for the site configs ----------------------------------

export { parseHtml, attr, elText, htmlUnescape };

/** Resolve `target` (absolute or site-relative) against the site base. */
export function absolutize(base: string, target: string): string {
  try {
    return new URL(target, base + "/").toString();
  } catch {
    return target;
  }
}
