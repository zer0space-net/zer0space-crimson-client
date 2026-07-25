# crimson-sources 🩸

The **client-side scrape/resolve engine** for [Crimson Haven](https://crimsonhaven.to) —
the from-scratch TypeScript re-implementation of the backend's sources, run in the
viewer's own browser. It is Phase 1 of the
[New System](../crimson-backend/New_System.md): moving *scrape → resolve* (and the
video bytes) off the backend so cost scales with users/library, not watch-hours.

> It produces the **exact same** `{"type":"stream", …}` line shape the backend's
> `/watch` NDJSON emits, so a locally-resolved source is indistinguishable from a
> backend-resolved one — no player rewrite. The backend stays the floor (E0): any
> source the client can't run is simply left to it, so nothing regresses.

## How it fits together

```
 crimson-client (SPA)
   └─ createEngine({ extension, signProxyUrl })
        └─ streamEpisode(mediaCtx)  ──▶  yields StreamLine (== backend NDJSON line)
             router picks a fetcher per source's constraint flags:
               E3 extension   → crimson-extension (DNR headers + CORS, residential)
               E2 proxied     → crimson-proxy edge (signed; headers + CORS relay)
               E1 direct      → plain fetch (CORS-safe hosts only)
               else           → (skip) backend E0 fallback handles it
```

The **execution-environment** analysis (why each source lands where it does) lives
in `crimson-backend/New_System.md` §3–§6. The capability flags a source declares
(`needsJA3`, `needsResidentialIP`, `needsHeaderInjection`, `needsCORSBypass`,
`needsServerSecret`, `needsEdgeSecret`) drive the routing.

## Sources implemented

Anything not runnable in the current environment is skipped and left to the backend
(E0), so nothing regresses. "Best env" is the cheapest fetcher that can run it.

### Anime (TMDB- or title-keyed)

| Source | Resolves via | Constraints | Best env |
| --- | --- | --- | --- |
| **cinema.bz** (tcloud/ipcloud/ngcloud) | direct HLS | C1 + C2 | E2 / E3 |
| **PlayIMDb** | direct HLS (multiple servers → tiles) | C1 + C2 | E2 / E3 |
| **ScreenScape** (~15 servers) | direct HLS | C1 + C2 | E2 / E3 |
| **Vidking** | ad-supported HLS SPA → hidden-tab capture | C1 + C2 + real browser | **E3** |
| **aniworld / s.to / stomirror** | VOE / Vidmoly / Doodstream / Filemoon | C1 + C2 + C4 (VOE ASN) | **E3** |
| **Burning Series** (bs.to) | VOE / Vidmoly / Filemoon / Doodstream → hidden-tab capture past reCAPTCHA | C1 + C2 + real browser | **E3** |
| **aniwatch** | VidSrc / megaplay | C1 + C2 + C3 (JA3) | **E3** |
| **AnimeSuge** | ad-free direct files | C1 + C2 | E2 / E3 |

### Western movies / TV (movie-web/providers revival — title/IMDb-keyed)

| Source | Content | Resolves via | Best env |
| --- | --- | --- | --- |
| **HDRezka** | West + RU-dub movies/TV | direct files, **one tile per dub** + subs | **E3** (IP-locked) |
| **LookMovie** | Western movies/TV | direct HLS + VTT subs | **E3** (IP-locked) |
| **Insertunit** | RU/UK/EN series | direct HLS + subs (needs `ctx.imdbId`) | E2 / E3 |
| **EE3** | movies | edge-resolved torrent stream (session-bound) | **E2 only** (`needsEdgeSecret`) |

### Manga (reading surface — AniList-keyed)

The reading counterpart of the video sources: a self-contained `createMangaEngine`
(not part of the `streamEpisode` set — its unit is a chapter of page images, not a
stream). Discovery + metadata stay server-side (AniList, like TMDB for video); the
engine turns an AniList title into a MangaDex chapter list and a chapter into its
page images, entirely in the browser.

| Source | Content | Resolves via | Constraints | Best env |
| --- | --- | --- | --- | --- |
| **MangaDex** | manga chapters + pages | `/manga?title=` → `/manga/{id}/feed` → `/at-home/server/{id}` | C1 (API has no ACAO) | E2 / E3 |

The three JSON calls need a CORS bypass (MangaDex answers no ACAO for a third-party
origin), so they route to the extension (E3) or the signed proxy (E2). The page
**images** need no proxy at all — they drop straight into an `<img>` as raw
`*.mangadex.network` URLs (image loads aren't subject to CORS), so the bytes flow
CDN → viewer and never touch our backend. No API key. See `src/manga/`.

### Secret-bound (backend resolves / edge delivers)

| Source | Secret | Path |
| --- | --- | --- |
| **ShowBox/Febbox** | `FEBBOX_UI_TOKEN` (cookie) | backend `/resolve` grant → raw CDN file delivered E3/E2 |
| **Jellyfin** | server token | backend `/resolve` grant → **E2 edge** injects the token |
| **EE3** | ee3 login | the crimson-proxy **edge** logs in + resolves + relays (see crimson-proxy) |

The Western/title-keyed sources need the title (+ release year, + imdb id for
Insertunit) in the `MediaCtx`; the client fills these from the backend
`/scrape-meta` (+ `/scrape-meta/movie`) grant, since they derive from the
server-held TMDB key (C5). See `crimson-client/src/clientSources.js`.

## Public API

```ts
import { createEngine, getExtensionBridge } from "crimson-sources";

const engine = await createEngine({
  extension: getExtensionBridge(),   // E3 — null when the companion isn't installed
  signProxyUrl: async (fields) => {  // E2 — optional; mints a signed crimson-proxy URL
    // fields = { url, referer, origin, userAgent }
    // ⚠️ PROXY_SECRET must NEVER ship to the browser — this calls the backend /sign grant.
    return await backendSign(fields);
  },
});

if (engine.canRunAny({ mediaType: "tv" })) {
  for await (const line of engine.streamEpisode(
    { tmdbId, mediaType: "tv", season, episode },
    { signal },
  )) {
    handleLine(JSON.stringify(line)); // same consumer the backend feeds
  }
}
await engine.dispose(); // clears any installed extension media rules
```

## Security model (inherited from New_System §8)

- **No secrets in the bundle.** The engine holds nothing sensitive. `PROXY_SECRET`
  stays server-side: the E2 path works only via a `signProxyUrl` grant the host
  wires to a backend `/sign` endpoint. Secret-bound sources (Febbox, Jellyfin,
  OpenSubtitles, …) are never ported here — they stay E0.
- **The extension does the privileged network work** (header injection, CORS) and
  is itself off-by-default and user-toggled. The engine treats a present-but-off
  extension as absent and routes to E2/E0.

## Build / consumption

**Prerequisites:** Node 20+ (for the bundled WebCrypto used by the ported AES /
HMAC resolvers) and npm. No runtime dependencies — the engine is dependency-free
TypeScript; the only `devDependencies` are `typescript`, `vitest`, and `ajv`.

This is consumed by `crimson-client` as a **git submodule** (`vendor/crimson-sources`)
via a Vite alias — Vite transpiles the TypeScript inline, so there's no separate
build step in the normal client build. For standalone use / development:

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest — validates the ported crypto byte-for-byte against
                    # the Python resolvers (MD5 vectors, AES round-trip, the
                    # ScreenScape signing primitives, VOE deobfuscation, unpacker)
npm run build       # emits dist/ (tsc) — only needed for non-Vite consumers
```

> Because the engine re-implements the backend's crypto resolvers in TS, the
> `npm test` vectors are the safety net: keep them green when porting a resolver so
> a client-resolved stream stays byte-identical to what the Python side produced.

## Layout

```
src/
  index.ts        public API
  types.ts        StreamLine (== backend NDJSON), MediaCtx (+ releaseYear/imdbId), SourceFlags, Fetcher, …
  engine.ts       createEngine → streamEpisode (the client /watch producer)
  fetchers.ts     direct / proxied / extension fetchers + the capability router
  playback.ts     turn a resolved URL into a player handle (E3 rules vs E2 signed; forceProxy)
  extension.ts    crimson-extension bridge detection
  registry.ts     the source list
  crypto/         md5 / aes / screenscape signing (ported from the Python resolvers)
  resolvers/      voe, vidmoly, vidsrc, doodstream, filemoon, common
  util/           text (title matching), dom (DOMParser), debug, unpack, base64
  sources/
    cinemabz.ts playimdb.ts screenscape.ts      TMDB-keyed aggregators
    vidking.ts                                    TMDB-keyed ad-SPA (E3 hidden-tab capture)
    aniworld.ts sto.ts stomirror.ts stoFamily.ts  s.to-family discovery (→ VOE/Vidmoly/Dood/Filemoon)
    burningseries.ts                              bs.to discovery (E3 hidden-tab capture past reCAPTCHA)
    aniwatch.ts animesuge.ts                      anime (VidSrc / ad-free direct)
    hdrezka.ts lookmovie.ts insertunit.ts         Western movies/TV (movie-web revival)
    ee3.ts                                        movies — edge-resolved (signed /__ee3 marker)
    febbox.ts jellyfin.ts                         secret-bound (backend /resolve grant)
  manga/
    mangadex.ts                                   MangaDex search → feed → @Home (raw <img> URLs)
    engine.ts                                     createMangaEngine (reading sibling of createEngine)
```

The manga engine is separate from the stream engine:

```ts
import { createMangaEngine, getExtensionBridge } from "crimson-sources";

const manga = await createMangaEngine({ extension: getExtensionBridge(), signProxyUrl });
if (manga.available) {                                  // else leave it to the backend (E0)
  const id = await manga.resolveManga(candidateTitles, contentRating);
  const chapters = await manga.chapters(id, "en", contentRating);
  const pages = await manga.pages(chapters[0].id);      // raw @Home URLs for <img>
}
```
