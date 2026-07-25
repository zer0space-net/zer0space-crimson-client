/*
 * The manga engine — the client-side counterpart of the backend's (removed) manga
 * provider. A small, self-contained sibling of the video `createEngine`: it reuses
 * the exact same fetcher tiering (extension E3 / signed proxy E2), but its unit is a
 * chapter of page images, not a stream, so it has its own tiny surface instead of
 * bending `streamEpisode`.
 *
 * It is **multi-source**: an AniList title is resolved against every registered
 * manga source (MangaDex, WeebCentral, …) in parallel, and the host is handed one
 * result per source that matched — so the reader UI can offer a source picker exactly
 * like the video source tiles. Each source owns opaque chapter ids, so the ids we
 * return are namespaced `"{sourceId}:{rawId}"`; `pages()` reads that prefix back to
 * dispatch a page fetch to the right source. The prefix is safe because both sources'
 * ids (MangaDex UUIDs, WeebCentral ULIDs) never contain a colon.
 *
 * The host (crimson-client) drives it directly:
 *
 *   const manga = await createMangaEngine({ extension, signProxyUrl });
 *   if (manga.available) {
 *     const results = await manga.resolveAll(candidateTitles, contentRating, "en");
 *     // results: [{ sourceId, sourceLabel, mangaId, chapters }, …] (chapters tagged)
 *     const pages = await manga.pages(results[0].chapters[0].id); // raw <img> URLs
 *   }
 *
 * `available` is false when neither E3 nor E2 can run (the sources need a CORS
 * bypass), in which case the host leaves the title to the backend (E0) — a provider
 * build resolves it server-side, a base build simply has no chapters. Never a
 * regression.
 */
import { probeExtension } from "../extension";
import { selectFetcher } from "../fetchers";
import type { EngineEnv, Fetcher, ResolvedEnv, SourceFlags } from "../types";
import {
  getChapterPages as mdPages,
  getChapters as mdChapters,
  MANGA_FLAGS,
  resolveMangaId as mdResolve,
} from "./mangadex";
import type { MangaChapter } from "./mangadex";
import {
  getChapterPages as wcPages,
  getChapters as wcChapters,
  resolveMangaId as wcResolve,
  WEEBCENTRAL_FLAGS,
} from "./weebcentral";

export type { MangaChapter } from "./mangadex";

/** A registered manga source — the three resolve stages plus its capability flags. */
interface MangaSourceDef {
  id: string;
  label: string;
  flags: SourceFlags;
  resolveManga(fetcher: Fetcher, titles: string[], contentRating: string[]): Promise<string | null>;
  chapters(fetcher: Fetcher, mangaId: string, language: string, contentRating: string[]): Promise<MangaChapter[]>;
  pages(fetcher: Fetcher, chapterId: string, dataSaver: boolean): Promise<string[]>;
}

// Registry + iteration order (also the default source order in the picker). MangaDex
// first — the larger, multilingual catalogue — then WeebCentral as an alternative /
// fallback with its own scanlations.
const MANGA_SOURCES: MangaSourceDef[] = [
  { id: "mangadex", label: "MangaDex", flags: MANGA_FLAGS, resolveManga: mdResolve, chapters: mdChapters, pages: mdPages },
  { id: "weebcentral", label: "WeebCentral", flags: WEEBCENTRAL_FLAGS, resolveManga: wcResolve, chapters: wcChapters, pages: wcPages },
];

/** A source the engine can currently run (has a fetcher), for the picker UI. */
export interface MangaSourceInfo {
  id: string;
  label: string;
}

/** One source's resolution for a title: its mapped id + its (tagged) chapter list. */
export interface MangaSourceResult {
  sourceId: string;
  sourceLabel: string;
  /** The raw (untagged) manga id on that source, for telemetry/caching. */
  mangaId: string;
  /** Chapters with ids namespaced `"{sourceId}:{rawId}"` (see module header). */
  chapters: MangaChapter[];
}

export interface MangaEngine {
  /** True when a fetcher (E3/E2) can run at least one source; false → leave it to E0. */
  readonly available: boolean;
  /** The chosen fetcher's id ("extension" | "proxied"), for host telemetry/logging. */
  readonly env: string | null;
  /** The sources that can run right now, in picker order. */
  readonly sources: MangaSourceInfo[];
  /** Resolve a title against every runnable source in parallel; one result each for
   *  the sources that matched with ≥1 chapter, in registry order. */
  resolveAll(titles: string[], contentRating: string[], language: string): Promise<MangaSourceResult[]>;
  /** Ordered page-image URLs for one tagged chapter id (dispatches on its prefix). */
  pages(taggedChapterId: string, dataSaver?: boolean): Promise<string[]>;
}

/** Split a tagged chapter id back into its source def + raw id. Falls back to the
 *  first source for a bare (untagged) id so a legacy id never hard-fails. */
function dispatch(
  taggedId: string,
  runnable: Array<{ def: MangaSourceDef; fetcher: Fetcher }>,
): { entry: { def: MangaSourceDef; fetcher: Fetcher }; rawId: string } | null {
  const colon = taggedId.indexOf(":");
  if (colon > 0) {
    const sourceId = taggedId.slice(0, colon);
    const entry = runnable.find((r) => r.def.id === sourceId);
    if (entry) return { entry, rawId: taggedId.slice(colon + 1) };
  }
  // Untagged / unknown prefix → default to the first runnable source with the whole id.
  const first = runnable[0];
  return first ? { entry: first, rawId: taggedId } : null;
}

export async function createMangaEngine(rawEnv: EngineEnv): Promise<MangaEngine> {
  const probe = await probeExtension(rawEnv.extension ?? null);
  const env: ResolvedEnv = {
    extension: probe.bridge,
    extensionEnabled: probe.enabled,
    proxyBases: rawEnv.proxyBases ?? [],
    signProxyUrl: rawEnv.signProxyUrl ?? null,
    resolveGrant: rawEnv.resolveGrant ?? null,
  };

  // Pair each source with the fetcher the router picks for its flags (null → that
  // source can't run in this environment and is dropped).
  const runnable = MANGA_SOURCES.map((def) => ({ def, fetcher: selectFetcher(def.flags, env) }))
    .filter((r): r is { def: MangaSourceDef; fetcher: Fetcher } => r.fetcher !== null);

  return {
    available: runnable.length > 0,
    env: runnable[0]?.fetcher.id ?? null,
    sources: runnable.map((r) => ({ id: r.def.id, label: r.def.label })),

    async resolveAll(titles, contentRating, language) {
      if (!runnable.length || !Array.isArray(titles) || titles.length === 0) return [];
      const settled = await Promise.all(
        runnable.map(async ({ def, fetcher }): Promise<MangaSourceResult | null> => {
          try {
            const mangaId = await def.resolveManga(fetcher, titles, contentRating || []);
            if (!mangaId) return null;
            const chapters = await def.chapters(fetcher, mangaId, language || "en", contentRating || []);
            if (!chapters.length) return null;
            return {
              sourceId: def.id,
              sourceLabel: def.label,
              mangaId,
              // Namespace the ids so pages() can route back to this source.
              chapters: chapters.map((c) => ({ ...c, id: `${def.id}:${c.id}` })),
            };
          } catch {
            return null; // one source failing must never sink the others
          }
        }),
      );
      return settled.filter((r): r is MangaSourceResult => r !== null);
    },

    async pages(taggedChapterId, dataSaver = false) {
      if (!taggedChapterId) return [];
      const d = dispatch(taggedChapterId, runnable);
      if (!d) return [];
      try {
        return await d.entry.def.pages(d.entry.fetcher, d.rawId, dataSaver);
      } catch {
        return [];
      }
    },
  };
}
