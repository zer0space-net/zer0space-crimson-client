/*
 * The fetcher strategy — the heart of the tiered execution model (New_System §4/§5.2).
 *
 * Every source is written once against a `Fetcher`. At runtime the router picks
 * the cheapest fetcher that can satisfy the source's constraint flags:
 *
 *   E3 extensionFetcher  — DNR header rewrite + host-access CORS bypass, real
 *                          browser (Chrome JA3, residential IP). Handles C1–C4.
 *   E2 proxiedFetcher    — crimson-proxy edge relay: injects headers + CORS-open,
 *                          but datacenter IP / non-Chrome JA3 (no C3/C4).
 *   E1 directFetcher     — plain browser fetch: real JA3/IP, but no CORS bypass
 *                          and no forbidden headers (CORS-safelisted hosts only).
 *
 * When no fetcher can run a source it routes to the backend (E0) at the engine
 * level — never below today's behavior.
 */
import type {
  Fetcher,
  FetchOptions,
  FetchResult,
  ResolvedEnv,
  SignFields,
  SourceFlags,
  UpstreamHeaders,
} from "./types";

// --- helpers ---------------------------------------------------------------

function pickHeader(h: Record<string, string> | undefined, name: string): string {
  if (!h) return "";
  const lower = name.toLowerCase();
  for (const k of Object.keys(h)) {
    if (k.toLowerCase() === lower) return h[k] ?? "";
  }
  return "";
}

async function bufferToBase64(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function headersToObject(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

async function readResponse(
  resp: Response,
  responseType: "text" | "arraybuffer",
): Promise<FetchResult> {
  let body: string;
  let bodyEncoding: "text" | "base64";
  if (responseType === "arraybuffer") {
    body = await bufferToBase64(await resp.arrayBuffer());
    bodyEncoding = "base64";
  } else {
    body = await resp.text();
    bodyEncoding = "text";
  }
  return {
    ok: resp.ok,
    status: resp.status,
    statusText: resp.statusText,
    url: resp.url,
    redirected: resp.redirected,
    headers: headersToObject(resp.headers),
    body,
    bodyEncoding,
  };
}

// --- E1: direct browser fetch ----------------------------------------------

class DirectFetcher implements Fetcher {
  readonly id = "direct" as const;

  supports(flags: SourceFlags): boolean {
    // Real browser clears JA3/ASN for free; it only fails on CORS + forbidden
    // headers + server/edge secrets.
    return (
      !flags.needsServerSecret &&
      !flags.needsEdgeSecret &&
      !flags.needsCORSBypass &&
      !flags.needsHeaderInjection
    );
  }

  async fetch(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
    const resp = await fetch(url, {
      method: opts.method ?? "GET",
      headers: opts.headers, // forbidden headers are silently dropped by the browser
      body: opts.body,
      redirect: opts.redirect ?? "follow",
      credentials: opts.credentials ?? "omit",
    });
    return readResponse(resp, opts.responseType ?? "text");
  }
}

// --- E2: crimson-proxy edge relay ------------------------------------------

class ProxiedFetcher implements Fetcher {
  readonly id = "proxied" as const;

  constructor(private readonly signProxyUrl: (f: SignFields) => Promise<string>) {}

  supports(flags: SourceFlags): boolean {
    // The edge injects headers + is CORS-open, but it's a datacenter IP with a
    // non-Chrome JA3 — so it can't run JA3-gated or ASN-bound sources. It CAN hold
    // an edge secret (needsEdgeSecret), unlike the extension/direct fetchers.
    return !flags.needsServerSecret && !flags.needsJA3 && !flags.needsResidentialIP;
  }

  async fetch(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
    const signed = await this.signProxyUrl({
      url,
      referer: pickHeader(opts.headers, "Referer"),
      origin: pickHeader(opts.headers, "Origin"),
      userAgent: pickHeader(opts.headers, "User-Agent"),
    });
    // The proxy answers ACAO:* so a plain browser fetch can read it.
    const resp = await fetch(signed, {
      method: opts.method ?? "GET",
      redirect: opts.redirect ?? "follow",
    });
    return readResponse(resp, opts.responseType ?? "text");
  }
}

// --- E3: companion extension -----------------------------------------------

class ExtensionFetcher implements Fetcher {
  readonly id = "extension" as const;

  constructor(
    private readonly bridge: {
      fetch(url: string, opts?: FetchOptions): Promise<FetchResult>;
    },
  ) {}

  supports(flags: SourceFlags): boolean {
    // Real browser + DNR header rewrite + host-access CORS: clears C1–C4. But it
    // can't hold an edge secret (needsEdgeSecret) — that's the proxy's job.
    return !flags.needsServerSecret && !flags.needsEdgeSecret;
  }

  fetch(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
    return this.bridge.fetch(url, opts);
  }
}

// --- router ----------------------------------------------------------------

/**
 * Pick the leftmost fetcher in `[extension, proxied, direct]` that can satisfy
 * the source's flags given what the environment offers. Returns `null` when only
 * the backend (E0) can run it — the engine then skips it client-side and the
 * host keeps using the backend /watch line for that source.
 */
export function selectFetcher(flags: SourceFlags, env: ResolvedEnv): Fetcher | null {
  const candidates: Fetcher[] = [];
  if (env.extension && env.extensionEnabled) {
    candidates.push(new ExtensionFetcher(env.extension));
  }
  if (env.signProxyUrl) {
    candidates.push(new ProxiedFetcher(env.signProxyUrl));
  }
  candidates.push(new DirectFetcher());

  for (const f of candidates) {
    if (f.supports(flags)) return f;
  }
  return null;
}

/** Convenience: the upstream headers object a source threads into `fetch`. */
export function upstreamHeaderObject(h: UpstreamHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  if (h.referer) out["Referer"] = h.referer;
  if (h.origin) out["Origin"] = h.origin;
  if (h.userAgent) out["User-Agent"] = h.userAgent;
  return out;
}
