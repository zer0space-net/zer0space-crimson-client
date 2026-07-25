/*
 * crimson-sources — public API.
 *
 * Usage (crimson-client):
 *
 *   import { createEngine, getExtensionBridge } from "crimson-sources";
 *
 *   const engine = await createEngine({
 *     extension: getExtensionBridge(),          // E3, when the companion is installed
 *     signProxyUrl: mySignGrant,                // E2, backend /sign grant (optional)
 *   });
 *   for await (const line of engine.streamEpisode(mediaCtx, { signal })) {
 *     handleLine(JSON.stringify(line));         // same NDJSON the backend emits
 *   }
 *   await engine.dispose();
 */
export { createEngine } from "./engine";
export type { Engine, EngineCapabilities, SourceResult, StreamEpisodeOpts } from "./engine";
// The manga (reading) engine — a self-contained sibling of the video engine that
// resolves chapters/pages client-side (E2/E3) across every registered manga source
// (MangaDex, WeebCentral, …). See src/manga/.
export { createMangaEngine } from "./manga/engine";
export type { MangaChapter, MangaEngine, MangaSourceInfo, MangaSourceResult } from "./manga/engine";
export { getExtensionBridge, waitForExtensionBridge, probeExtension } from "./extension";
export { SOURCES } from "./registry";
export type {
  EngineEnv,
  ExtensionBridge,
  GrantRequest,
  GrantStream,
  MediaCtx,
  ResolvedStream,
  SignFields,
  Source,
  SourceFlags,
  StreamLine,
  StreamType,
  SubtitleTrack,
} from "./types";
