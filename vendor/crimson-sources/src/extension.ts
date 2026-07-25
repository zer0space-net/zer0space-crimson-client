/*
 * crimson-extension bridge detection.
 *
 * The companion extension (../crimson-extension) injects a frozen MAIN-world API
 * at `window.CrimsonExtension`. Detection needs no extension id — we just read
 * the global. This module is the *only* place crimson-sources touches that
 * global, so the rest of the engine works against the typed `ExtensionBridge`.
 *
 * See crimson-extension/README.md for the contract this mirrors.
 */
import type { ExtensionBridge } from "./types";

declare global {
  interface Window {
    CrimsonExtension?: ExtensionBridge;
  }
}

/** The extension bridge if the companion is installed, else null. Synchronous. */
export function getExtensionBridge(): ExtensionBridge | null {
  if (typeof window === "undefined") return null;
  const ext = window.CrimsonExtension;
  return ext && ext.available ? ext : null;
}

/**
 * The async half of the handshake. The companion injects its MAIN-world API as an
 * *external* script at document_start (content.js appends a `<script src=…>`), so
 * that global loads asynchronously — on a cold load straight onto a /watch route,
 * page code can run `getExtensionBridge()` and see `undefined` purely because the
 * inject hasn't finished yet, not because the extension is absent.
 *
 * inpage.js fires a one-shot `crimson-extension-ready` event the moment it's up.
 * We resolve immediately if the bridge is already there, otherwise we wait for
 * that event, racing it against a short timeout so a genuinely-absent extension
 * doesn't stall startup (it just resolves `null` and the host stays on E0).
 */
export function waitForExtensionBridge(timeoutMs = 1500): Promise<ExtensionBridge | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const immediate = getExtensionBridge();
  if (immediate) return Promise.resolve(immediate);

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("crimson-extension-ready", onReady);
      clearTimeout(timer);
      resolve(getExtensionBridge());
    };
    const onReady: EventListener = () => finish();
    window.addEventListener("crimson-extension-ready", onReady, { once: true });
    const timer = setTimeout(finish, timeoutMs);
  });
}

/**
 * Resolve whether the extension is present *and* the user has toggled it on.
 * `enabled` is user-controlled (the one red button), so a present-but-off
 * extension must be treated as absent for routing — we fall back to E2/E0.
 */
export async function probeExtension(
  bridge: ExtensionBridge | null,
): Promise<{ bridge: ExtensionBridge | null; enabled: boolean }> {
  if (!bridge) return { bridge: null, enabled: false };
  try {
    const hello = await bridge.hello();
    return { bridge, enabled: Boolean(hello.ok && hello.enabled) };
  } catch {
    return { bridge, enabled: false };
  }
}
