# Deploying zer0space ✕ Crimson

Crimson runs as **three stacks behind the zer0space dashboard gate**. Nothing is
public: the only way in is being signed in to zer0space and visiting
`zer0space.com/crimson`.

```
 browser ──▶ zer0space dashboard  ──(/crimson gate: checks session)──▶ crimson-client (SPA)
                     │
                     └────────────(/crimson/api)────────────────────▶ crimson-api (backend)
                                                                            │
                                                                       crimson-internal
                                                                       └─ postgres, api-sync
 media: CDN ──▶ crimson-proxy ──▶ viewer   (never through the dashboard — Cloudflare ToS §2.8)
```

## 0. The image builds itself — no secret needed

GitHub Actions builds and pushes `ghcr.io/zer0space-net/zer0space-crimson-client`
on every push to `main`, using the built-in `GITHUB_TOKEN` (the engine is
vendored, not a cross-org submodule, so no PAT is required). After the first
successful run, make the new package **pullable by the Swarm nodes** — either set
the ghcr package to public, or have the nodes `docker login ghcr.io` (same as the
dashboard image).

## 1. Create the shared overlay (once)

All three stacks and the dashboard find each other on one external overlay:

```bash
docker network create --driver overlay --attachable crimson_net
```

## 2. Deploy the backend stack

`zer0space-crimson-backend` (Portainer stack from that repo). Set stack env:

| Variable | Value |
|---|---|
| `POSTGRES_PASSWORD` | the Crimson DB password |
| `TMDB_API_KEY` | TMDB key |
| `PROXY_SECRET` | crimson-proxy shared secret |
| `REQUIRE_LOGIN` | **`false`** — the zer0space gate is the auth |
| `SIGNUP_INVITE_CODE` | e.g. `zer0space` — the SSO broker auto-registers accounts with this |
| `PROXY_URLS` | crimson-proxy endpoints (optional) |

It publishes `api` on `crimson_net` as **`zer0space-crimson-api`**.

## 3. Deploy this client stack

`zer0space-crimson-client` (Portainer stack from this repo). No env needed. It
publishes on `crimson_net` as **`zer0space-crimson-client`**.

## 4. Wire the dashboard gate

Add the two upstreams and the shared network to the **dashboard** stack, then
redeploy it. (Kept out of the dashboard's committed compose on purpose, so a
dashboard redeploy never fails on a `crimson_net` that doesn't exist yet — add
these only once step 1 is done.)

First create the SSO key secret on a manager (gives each zer0space user a real,
synced Crimson account with no login screen):

```bash
openssl rand -hex 32 | docker secret create crimson_sso_secret -
```

Then add to the **dashboard** stack and redeploy:

```yaml
services:
  dashboard:
    environment:
      # … existing env …
      - CRIMSON_CLIENT_URL=http://zer0space-crimson-client:80
      - CRIMSON_API_URL=http://zer0space-crimson-api:8000    # confirm backend port
      - CRIMSON_SSO_INVITE_CODE=zer0space                    # = SIGNUP_INVITE_CODE
    secrets:
      - crimson_sso_secret
    networks:
      - dashboard_net
      - cloudflared_proxy
      - crimson_net            # add this

secrets:
  crimson_sso_secret:
    external: true

networks:
  # … existing …
  crimson_net:
    external: true
```

When both `CRIMSON_*` are set the dashboard logs
`[crimson] gateway on /crimson (... sso=on)` at boot and mounts the gated routes;
unset, `/crimson` simply 404s and the dashboard is unchanged.

> Confirm the backend's actual listen port and set `CRIMSON_API_URL` to match
> (the Crimson backend serves uvicorn on its container port — commonly 8000).

## 5. Verify browsing

1. Sign in to zer0space.
2. Visit `https://zer0space.com/crimson` → the crimson SPA loads (May, crimson
   accent). Signed out, the same URL bounces to `/login`.
3. Browse/search should fill (needs a valid **TMDB v4 Read Access Token** as the
   backend's `TMDB_API_KEY` — the backend sends it as `Authorization: Bearer`, so
   the *long* `eyJ…` token, not the short v3 key).
4. A title's watch page should stream **source tiles** in as they resolve.

## 6. Make it actually play — sources + the proxy

Browsing works with just the base image, but two more pieces are needed before a
gated source (VOE, ScreenScape, …) actually plays:

### 6a. Backend source overlay (which sources exist)

The public backend ships **no** third-party resolvers. Inject them from the
private [`zer0space-crimson-secret-backend-sources`](https://github.com/zer0space-net/zer0space-crimson-secret-backend-sources):

1. In `zer0space-crimson-backend` → Settings → Secrets → Actions, add
   **`SOURCES_PAT`** (a classic PAT with `repo` read on the private sources repo).
2. Actions → *Build crimson backend image* → **Run workflow** (a per-commit
   cache-bust makes the overlay re-clone each build).
3. Pull-and-redeploy the backend. `docker exec … ls resolvers/` should now show
   `voe.py`, `screenscape.py`, … .

### 6b. crimson-proxy (so gated sources deliver)

Gated CDNs need `Referer`/`Origin` headers a browser can't set — the
[`zer0space-crimson-proxy`](https://github.com/zer0space-net/zer0space-crimson-proxy)
Cloudflare Worker injects them and relays segments. Deploy it (see that repo's
README), then set on the backend stack — the **same secret** in both places:

| Where | Variable | Value |
|---|---|---|
| proxy (wrangler secret) | `NITRO_PROXY_SECRET` | `openssl rand -hex 32` |
| backend | `PROXY_SECRET` | *same value* |
| backend | `CRIMSON_PROXY_BASE` | `https://zer0space-crimson-proxy.<you>.workers.dev` |

Pull-and-redeploy the backend → its `/sign` grant stops 503-ing and E0 sources
get proxy links → **playback works**.

### 6c. German dubs for live-action series/movies (FlareSolverr)

Anime German works out of the box (aniworld.to has no captcha). But
**serienstream.to / s.to** (the German source for live-action shows + movies) now
gate every hoster link behind a **Cloudflare Turnstile**, which plain-HTTP
scraping can't pass — so those titles resolve English-only without this.

The fix needs **no browser extension**: a headless real Chromium
(**FlareSolverr**) resolves the gate server-side. On the homelab's *residential*
IP the "managed" Turnstile auto-passes with no interaction, mints the German
VOE/Vidmoly redirect, and the normal resolver + crimson-proxy play it.

It ships in the backend stack (`docker-compose.yml` → the `flaresolverr` service)
and is **on by default**: `FLARESOLVERR_URL` defaults to `http://flaresolverr:8191`
(the internal service). So just **pull-and-redeploy the backend stack** — the new
`flaresolverr` container comes up and the patched `sto` scraper routes gated links
to it. To disable, set `FLARESOLVERR_URL=` (empty) → those hosters are dropped,
exactly as before.

Notes:
- Chromium is memory-hungry — the service reserves up to **1 GiB**; it's pinned to
  `CRIMSON_NODE` alongside the api (no overlay hop) and is **internal-only** (never
  a public hostname).
- First solve after a cold start is slow (Chromium warms up); later ones are fast.
- If a title still shows no German, the Turnstile occasionally escalates to an
  interactive challenge FlareSolverr can't clear — retry, or it's genuinely
  unavailable in German.

## Notes

- **Media stays off the tunnel.** Only JSON/NDJSON and the small static SPA pass
  through the dashboard. Segment bytes go CDN → **crimson-proxy** (Cloudflare
  Worker) → viewer — never through the backend or the dashboard (Cloudflare ToS
  §2.8).
- The client + backend images build via the built-in `GITHUB_TOKEN` (fresh
  packages that link to their repos) — no PAT needed for the image push. The
  **backend overlay** does need `SOURCES_PAT` to read the private sources repo
  (§6a).
- Per-user favourites/progress use the SSO bridge (the dashboard mints a Crimson
  identity per zer0space user, `CRIMSON_SSO_SECRET` + `CRIMSON_SSO_INVITE_CODE`);
  browse/search/play work without it.
- The engine (`crimson-sources`) is **vendored** into this repo, not a submodule,
  so CI needs no cross-org token. Its org copy lives in
  [`zer0space-crimson-sources`](https://github.com/zer0space-net/zer0space-crimson-sources).
