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

```yaml
services:
  dashboard:
    environment:
      # … existing env …
      - CRIMSON_CLIENT_URL=http://zer0space-crimson-client:80
      - CRIMSON_API_URL=http://zer0space-crimson-api:8000   # backend's listen port
    networks:
      - dashboard_net
      - cloudflared_proxy
      - crimson_net            # add this

networks:
  # … existing …
  crimson_net:
    external: true
```

When both `CRIMSON_*` are set the dashboard logs
`[crimson] gateway on /crimson (...)` at boot and mounts the gated routes;
unset, `/crimson` simply 404s and the dashboard is unchanged.

> Confirm the backend's actual listen port and set `CRIMSON_API_URL` to match
> (the Crimson backend serves uvicorn on its container port — commonly 8000).

## 5. Verify

1. Sign in to zer0space.
2. Visit `https://zer0space.com/crimson` → the crimson SPA loads (May, crimson
   accent). Signed out, the same URL bounces to `/login`.
3. A title's watch page should stream source tiles in as they resolve.

## Notes

- **Media stays off the tunnel.** Only JSON/NDJSON and the small static SPA pass
  through the dashboard. Segment bytes go CDN → crimson-proxy → viewer, over
  Tailscale, per Cloudflare ToS §2.8.
- The client image is built by this repo's GitHub Actions to
  `ghcr.io/zer0space-net/zer0space-crimson-client`. Needs the `CR_PAT` secret
  (classic PAT, `write:packages`), same as zer0space-dashboard.
- Per-user favourites/progress need the SSO bridge (the dashboard minting a
  Crimson identity per zer0space user) — a later phase; browse/search/play work
  without it.
