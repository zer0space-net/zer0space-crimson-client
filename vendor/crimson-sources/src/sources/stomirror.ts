/*
 * s.to IP-mirror discovery source (client port of scrapers/stomirror_scraper.py).
 *
 * A byte-for-byte clone of s.to's stack served over plain HTTP with no Cloudflare
 * and no Turnstile, so its `/r?t=` links 302 straight to voe.sx/vidmoly — the
 * inherited s.to config's genuine-3xx path resolves here where it stalls on s.to
 * proper. Reuses every bit of the s.to skeleton; only the origin differs. The host
 * is an IP literal that rotates; `STOMIRROR_BASE` overrides it (read off the page's
 * Vite env when present) without a code change.
 */
import { createStoFamilySource } from "./stoFamily";
import { makeStoConfig } from "./sto";

function mirrorBase(): string {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string> }).env;
    const override = env?.["VITE_STOMIRROR_BASE"];
    if (override) return override.replace(/\/+$/, "");
  } catch {
    /* no import.meta.env in this context */
  }
  return "http://186.2.175.5";
}

export const stomirror = createStoFamilySource(makeStoConfig("stomirror", mirrorBase()), "s.to (mirror)");
