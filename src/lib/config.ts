// Runtime configuration, resolved once.
//
// The app is served under zer0space.com/crimson and the dashboard reverse-proxies
// /crimson/api → the Crimson Haven backend, so the app only ever speaks to a
// same-origin, relative API base. No backend hostname is ever baked into the
// bundle, and there is no CORS to configure. VITE_API_BASE only exists so a
// standalone dev build can point elsewhere.

const RAW_BASE = import.meta.env.VITE_API_BASE ?? "/crimson/api";

export const API_BASE = RAW_BASE.replace(/\/$/, "");

// Router basename must match vite.config base. Kept as a constant so a future
// move off /crimson is a one-line change.
export const ROUTER_BASENAME = "/crimson";

// Where the bundled static assets (May artwork, favicon) live at runtime.
export const ASSET_BASE = "/crimson";

export const BRAND = {
  full: "zer0space ✕ Crimson",
  upstreamUrl: "https://github.com/crimsonhaven-to",
  upstreamName: "Crimson Haven",
} as const;
