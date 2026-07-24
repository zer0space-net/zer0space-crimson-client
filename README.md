# zer0space ✕ Crimson

A **zer0space-styled web client for the Crimson Haven streaming backend**, served
behind the zer0space dashboard at `zer0space.com/crimson`. The frontend (this
repo) is built by zer0space in the zer0space design language, with May; the
**streaming engine, sources and backend it talks to are Crimson Haven's**.

> ## Credit — Crimson Haven 🩸
>
> Crimson Haven is developed at **[github.com/crimsonhaven-to](https://github.com/crimsonhaven-to)**
> and the whole thing — the API, the database, the sync worker, and the
> client-side scrape/resolve engine (`crimson-sources`) this app embeds — is their
> work. This repository is only a **zer0space-flavoured frontend and deploy stack**
> for running it on the homelab. All the hard streaming machinery is theirs.
> Please point people at the upstream project.
>
> More about Crimson Haven: <https://crimsonhaven.org/> · <https://crimsonhaven.to/>

## What this is

- A **React + Vite + TypeScript SPA** in the zer0space look (near-black space,
  frosted glass, starfield, May) — the single accent shifted from zer0space blue
  to **crimson**, so the whole UI reads as the crossover it is.
- Talks to the Crimson Haven backend over a **same-origin, relative `/crimson/api`
  base**. The zer0space dashboard reverse-proxies that to the backend, so there is
  no CORS and no backend hostname in the bundle.
- Embeds Crimson Haven's **`crimson-sources`** engine (as a vendored submodule) to
  resolve streams in the viewer's browser, exactly as the upstream client does.

## Access model — no separate login

Crimson has **no login of its own here**. It sits *behind* zer0space: the
dashboard gates `/crimson` on the zer0space session, so anyone signed in to
zer0space reaches it and nobody else does. There is no Crimson sign-in screen to
see — the zer0space session is the door. (Backend `REQUIRE_LOGIN` is handled by
the gate; see the [backend repo](https://github.com/zer0space-net/zer0space-crimson-backend).)

## Develop

```bash
npm install
git submodule update --init            # vendor/crimson-sources (engine)
cp .env.example .env                    # point CRIMSON_API_ORIGIN at a backend
npm run dev                             # http://localhost:5199/crimson/
npm run build                           # tsc -b && vite build → dist/
```

`vendor/crimson-sources` is Crimson Haven's engine, aliased so Vite transpiles its
TypeScript inline (no separate build step), matching the upstream client's setup.

## Layout

```
src/
  main.tsx / App.tsx      entry + router (basename /crimson)
  lib/
    config.ts             API base, router basename, brand constants
    api.ts                typed Crimson Haven backend client + session token
    ndjson.ts             incremental reader for the progressive /watch stream
    useAsync.ts           tiny fetch hook
  components/
    Layout.tsx            topbar, nav, search, footer (Crimson Haven credit), May
    Wordmark.tsx          "zer0space ✕ Crimson"
    Starfield.tsx         canvas backdrop
    CrimsonPlayer.tsx     hls.js / MP4 / iframe player
    Chibi.tsx             May companion
    ui.tsx                Poster, grids, states
  pages/                  Home, Catalogue, Search, Overview, Watch, NotFound
  styles/                 tokens.css (ported zer0space design system, crimson), app.css
public/may/               May artwork (from zer0space-docs)
vendor/crimson-sources/   Crimson Haven engine (git submodule)
```

## Deploy

Crimson runs as three stacks behind the zer0space dashboard gate — see
**[DEPLOY.md](DEPLOY.md)** for the full runbook. In short: create the shared
`crimson_net` overlay, deploy the backend + this client onto it, then point the
dashboard's `CRIMSON_CLIENT_URL` / `CRIMSON_API_URL` at them. The image is built
by [`.github/workflows/client.yml`](.github/workflows/client.yml) to
`ghcr.io/zer0space-net/zer0space-crimson-client` (multi-stage `Dockerfile`:
Vite build → nginx with SPA fallback).

## Status

Frontend source, `Dockerfile`, nginx, CI and the gated deploy stack are in place;
the dashboard-side gate/proxy lives in `zer0space-dashboard` (`src/crimson.py`).
Still to come (tracked): the `crimson-sources` submodule wiring for E1–E3 client
resolving, and per-user account/progress sync via the zer0space→Crimson SSO
bridge.

## Related in this org

- [`zer0space-crimson-backend`](https://github.com/zer0space-net/zer0space-crimson-backend) — API, database, sync worker (deploy stack)
- [`zer0space-crimson-sources`](https://github.com/zer0space-net/zer0space-crimson-sources) — the sources component

---

*Crimson Haven is a project by **[crimsonhaven-to](https://github.com/crimsonhaven-to)**.
zer0space ✕ Crimson is a homelab frontend for it, not a fork or a replacement.*
