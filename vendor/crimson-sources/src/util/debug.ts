/*
 * Lightweight debug logging for the client source engine.
 *
 * Off by default (silent in prod). The verbose step-by-step trace is turned on by
 * either:
 *   • localStorage 'crimson:sources:debug' = '1'   (per-browser, no rebuild), or
 *   • createEngine({ debug: true })                (the host wires its own flag).
 *
 * Failures are ALWAYS surfaced via `dwarn` regardless of the flag. The engine used
 * to swallow every source error with a bare `.catch(() => [])`, which is precisely
 * what made the live shakeout impossible to diagnose ("it doesn't even log
 * something"). The flag only gates the verbose trace (which source matched what,
 * which hoster resolved, where VOE decoded), not the error surface.
 */

let enabled = false;
try {
  if (typeof localStorage !== "undefined" && localStorage.getItem("crimson:sources:debug") === "1") {
    enabled = true;
  }
} catch {
  /* no localStorage (SSR / sandbox) — stays off */
}

/** Turn the verbose trace on (createEngine calls this from its `debug` opt). The
 *  localStorage opt-in and the host opt-in are OR-ed: either one enables it. */
export function setDebug(on: boolean): void {
  if (on) enabled = true;
}

export function isDebug(): boolean {
  return enabled;
}

/** Verbose step trace — emitted only when debug is on. */
export function dlog(...args: unknown[]): void {
  if (enabled) console.info("[crimson-sources]", ...args);
}

/** Always-on warning. Source failures must never be silent again. */
export function dwarn(...args: unknown[]): void {
  console.warn("[crimson-sources]", ...args);
}
