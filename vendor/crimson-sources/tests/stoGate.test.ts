import { describe, expect, it, vi } from "vitest";
import { makeStoConfig } from "../src/sources/sto";
import type { Fetcher, FetchResult } from "../src/types";

// The s.to Turnstile gate: /r?t= answers a "frameBridge" interstitial instead of
// redirecting. Plain fetchers drop the hoster; a host with a real browser page
// (the zer0space Android app) follows the gate via `resolveGate`.

const BASE = "https://serienstream.to";
const GATE = `${BASE}/r?t=abc`;

function page(url: string, body: string): FetchResult {
  return { ok: true, status: 200, url, headers: {}, body, bodyEncoding: "text" };
}

function gatedFetcher(extra: Partial<Fetcher> = {}): Fetcher {
  return {
    id: "extension",
    supports: () => true,
    // Both the GET and the prepare-POST stay on the gate host.
    fetch: vi.fn(async (url: string) => page(url.startsWith(BASE) ? url : GATE, "<div id=frameBridge></div>")),
    ...extra,
  };
}

describe("s.to gated redirect", () => {
  const cfg = makeStoConfig("sto", BASE);

  it("drops the hoster when no gate follower exists", async () => {
    expect(await cfg.resolveRedirect(GATE, gatedFetcher(), BASE)).toBeNull();
  });

  it("follows the gate through resolveGate when the host provides it", async () => {
    const resolveGate = vi.fn(async () => "https://jessicachoosemake.com/e/xyz");
    const url = await cfg.resolveRedirect(GATE, gatedFetcher({ resolveGate }), BASE);
    expect(resolveGate).toHaveBeenCalledWith(GATE);
    expect(url).toBe("https://jessicachoosemake.com/e/xyz");
  });

  it("ignores a gate result that never left s.to", async () => {
    const resolveGate = vi.fn(async () => `${BASE}/serie/dark`);
    expect(await cfg.resolveRedirect(GATE, gatedFetcher({ resolveGate }), BASE)).toBeNull();
  });

  it("does not open a browser page for an ungated redirect", async () => {
    const resolveGate = vi.fn(async () => "https://x.example/");
    const fetcher: Fetcher = {
      id: "extension",
      supports: () => true,
      fetch: vi.fn(async () => page("https://voe.sx/e/1", "")),
      resolveGate,
    };
    expect(await cfg.resolveRedirect(GATE, fetcher, BASE)).toBe("https://voe.sx/e/1");
    expect(resolveGate).not.toHaveBeenCalled();
  });
});
