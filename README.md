# zer0space-crimson-client

CrimsonHaven web client — the static frontend.

> **Project paused.** The deploy stack is kept here so it can be picked back up
> without reconstructing it. Application source is not in this repo yet.

## Stack

[`docker-compose.yml`](docker-compose.yml) runs a single service: 2 replicas of the
static frontend on the `cloudflared_proxy` network.

Stateless — no volumes, nothing to persist, and therefore no placement constraint.
Unlike the backend it can run on any node.

Updates use `order: start-first`, so a redeploy of the public frontend brings the new
task up before stopping the old one and causes no visible downtime.

## Deployment

Deployed as a Portainer stack from this repository (compose path
`docker-compose.yml`), then updated with "Pull and redeploy".

The `cloudflared_proxy` overlay network must exist before the first deploy — it is
external to every stack and created once by hand:

```bash
docker network create --driver overlay --attachable cloudflared_proxy
```

No environment variables are required.

## Notes

- The image still publishes under the old personal namespace
  (`ghcr.io/sige0/crimson-client`), built by the external `crimsonhaven-to` CI. Once
  the source lands here and a workflow builds it, switch to
  `ghcr.io/zer0space-net/zer0space-crimson-client`.
- **No CI workflow yet, deliberately** — there is no source here to build, so a
  workflow would fail on every push. Add it in the same commit as the source.
- **Cloudflare ToS §2.8** prohibits continuous video streaming through the CDN.
  Serving this UI over the tunnel is fine; media delivery must go over Tailscale.
  Full caveats are in the [backend repo](https://github.com/zer0space-net/zer0space-crimson-backend).

## Intended layout

This repo is meant to end up like [`zer0space-dashboard`](https://github.com/zer0space-net/zer0space-dashboard):
source, `Dockerfile`, compose and CI in one place. Right now it holds only the
deploy stack.

## Related

- [`zer0space-crimson-backend`](https://github.com/zer0space-net/zer0space-crimson-backend) — API, database, sync worker
- [`zer0space-crimson-sources`](https://github.com/zer0space-net/zer0space-crimson-sources) — sources
