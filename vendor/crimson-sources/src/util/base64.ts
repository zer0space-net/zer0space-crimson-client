/*
 * Base64 helpers shared by the markup-decoding sources (AnimeSuge `data-embed-id`,
 * aniwatch `data-hash`) and the ScreenScape crypto. Browser-native `atob`/`btoa`
 * operate on binary strings; these wrap them with UTF-8 + url-safe handling that
 * matches the backend's `base64` usage.
 */

/** Binary string (one char per byte) -> Uint8Array. */
export function binaryToBytes(bin: string): Uint8Array {
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}

/** Uint8Array -> binary string. */
export function bytesToBinary(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return bin;
}

/** Decode standard-or-urlsafe base64 to raw bytes; null on malformed input. */
export function b64ToBytes(value: string): Uint8Array | null {
  if (!value) return null;
  let s = value.replace(/-/g, "+").replace(/_/g, "/");
  s += "=".repeat((4 - (s.length % 4)) % 4); // restore stripped padding
  try {
    return binaryToBytes(atob(s));
  } catch {
    return null;
  }
}

/** Decode standard-or-urlsafe base64 to a UTF-8 string; null on malformed input. */
export function b64DecodeText(value: string): string | null {
  const bytes = b64ToBytes(value);
  if (!bytes) return null;
  try {
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return null;
  }
}

/** UTF-8 string -> url-safe base64, padding stripped (the AnimeSuge marker form). */
export function b64UrlEncodeText(text: string): string {
  const bin = bytesToBinary(new TextEncoder().encode(text));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** UTF-8 string -> standard base64, padding stripped (CryptoJS `l(e)` form). */
export function b64UrlNoPad(text: string): string {
  const bin = bytesToBinary(new TextEncoder().encode(text));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
