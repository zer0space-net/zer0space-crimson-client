# Vendored: crimson-sources

This directory is a **vendored copy** of Crimson Haven's client-side scrape/resolve
engine, **crimson-sources** — https://github.com/crimsonhaven-to/crimson-sources
(at commit `9c65087`).

It is committed directly rather than kept as a git submodule so CI builds are
self-contained: the engine lives in the `crimsonhaven-to` org while this app lives
in `zer0space-net`, and GitHub Actions can't clone a cross-org submodule without a
personal token. Vendoring removes that dependency entirely.

**This code is Crimson Haven's, not zer0space's.** To update it, re-copy `src/`
(and `contracts/`, `tests/`) from the upstream repo. Everything about how streams
are resolved is theirs.

## zer0space changes on top of upstream

Kept identical to `zer0space-net/zer0space-crimson-sources`, which carries the
same patches:

- **Gate follower for s.to (2026-10-26).** `ExtensionBridge.resolveRedirect` +
  `Fetcher.resolveGate`, used by `sources/sto.ts` when `/r?t=` answers the
  Turnstile interstitial. Provided only by the zer0space Android app
  (github.com/zer0space-net/zer0space-android-app), which opens the gate link
  in a hidden real browser on the phone's own IP. Feature-detected: browsers
  and the extension behave exactly as before.
