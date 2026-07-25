/*
 * ScreenScape request-signing + response-decryption — client port of
 * resolvers/_screenscape_crypto.py (itself ported from the site's obfuscated
 * bundle, validated live). See [[screenscape-source]].
 *
 * No hardcoded site secret is needed: every key is either client-chosen (the
 * bootstrap nonce) or server-issued (the responseKey). The four baked constants
 * decoded from the bundle (`_C`/`_F`/`_I`/`_D`) feed the envelope key-derivation;
 * if ScreenScape rotates them, decryption returns null (no crash) and they need
 * re-extracting. HMAC-SHA256 / SHA-256 run on WebCrypto; the AES step is in ./aes.
 */
import { decryptOpenssl } from "./aes";
import { b64UrlNoPad, binaryToBytes } from "../util/base64";

// --- baked constants (decoded from the bundle's nested obfuscation) ----------
const _C = "K6o2H6-HjcoLvK9s_UgpYN53hh5WAJKceUmxCWNxrDbSO-kxngeLxb0Iw7ecup0J";
const _F = "jgLO6amYCY1tHtx65dxrg_Xc8OCvAz0yQQXgGC__G9d3TAVze4bk9ZQqa5o7VZqk";
const _I = 24; // hex chars of the derived key seeding the second XOR pass
const _D = 16; // length of the SHA-256-derived XOR pad

const B36 = "0123456789abcdefghijklmnopqrstuvwxyz";
const B64_ALPHABET = new Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".split(""));

// --- primitives --------------------------------------------------------------

function b36(n: number): string {
  if (n === 0) return "0";
  let out = "";
  while (n > 0) {
    out = B36[n % 36]! + out;
    n = Math.floor(n / 36);
  }
  return out;
}

function nowMs(): number {
  return Date.now();
}

function randHex(nBytes: number): string {
  const bytes = new Uint8Array(nBytes);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 9 random bytes as hex — the bundle's `u()`. */
function nonce(): string {
  return randHex(9);
}

/** `l(e)`: base64url with padding stripped. */
function b64url(s: string): string {
  return b64UrlNoPad(s);
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(message: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return toHex(sig);
}

/** `p(e, r)`: first 24 hex chars of HMAC-SHA256(message, key). */
async function hmac24(message: string, key: string): Promise<string> {
  return (await hmacHex(message, key)).slice(0, _I);
}

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return toHex(buf);
}

/** JSON identical to JS `JSON.stringify` (compact, key order preserved). The
 *  payloads are all ASCII, so this matches the bundle byte-for-byte. */
function jsonCompact(obj: unknown): string {
  return JSON.stringify(obj);
}

/** `o(e)`: CryptoJS `enc.Base64.parse(e).toString(enc.Utf8)` — drop non-alphabet
 *  chars, fix padding, base64-decode, UTF-8 decode. */
function cryptojsB64ToUtf8(s: string): string {
  let clean = "";
  for (const ch of s) if (B64_ALPHABET.has(ch)) clean += ch;
  clean += "=".repeat((4 - (clean.length % 4)) % 4);
  return new TextDecoder("utf-8").decode(binaryToBytes(atob(clean)));
}

/** `n(e, x)`: per-code-point XOR, `pad` cycled. */
function xor(text: string, pad: string): string {
  if (!pad) return text;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    out += String.fromCharCode(text.charCodeAt(i) ^ pad.charCodeAt(i % pad.length));
  }
  return out;
}

// --- bootstrap token (keyed by the client-chosen bootstrap nonce) ------------

/** 24-byte hex sent as `x-screenscape-bootstrap` + used to decrypt the response. */
export function newBootstrapNonce(): string {
  return randHex(24);
}

/** `createTokenRouteCode(secret)` -> path segment for the bootstrap POST. */
export async function tokenRouteCode(secret: string): Promise<string> {
  const payload = `token.${b36(nowMs())}.${nonce()}`;
  return `${b64url(payload)}.${await hmac24(payload, secret)}`;
}

// --- per-session request signers (keyed by the server-issued responseKey) ----

export async function serverRouteRequestId(responseKey: string): Promise<string> {
  const payload = jsonCompact({ k: "route", v: "server", t: nowMs(), n: nonce() });
  return `${b64url(payload)}.${await hmac24(payload, responseKey)}`;
}

export async function serverRequestId(server: string, responseKey: string): Promise<string> {
  const payload = `${server}.${b36(nowMs())}.${nonce()}`;
  return `${b64url(payload)}.${await hmac24(payload, responseKey)}`;
}

export async function tmdbRequestId(
  tmdbId: string,
  season: number | null,
  episode: number | null,
  responseKey: string,
): Promise<string> {
  const payload = jsonCompact({
    k: "tmdb",
    t: nowMs(),
    n: nonce(),
    tmdbId: String(tmdbId),
    season,
    episode,
  });
  return `${b64url(payload)}.${await hmac24(payload, responseKey)}`;
}

/** Deterministic primitives exposed for parity tests against the Python port. */
export const __internals = { b36, b64url, hmac24, sha256hex, cryptojsB64ToUtf8, xor };

// --- cipher context + envelope decryption ------------------------------------

export function buildCipherContext(path: string, sortedQuery: string, method = "GET"): string {
  return `${method.toUpperCase()}:${path}?${sortedQuery}`;
}

export interface Envelope {
  d: string;
  s: string;
}

export function isEncryptedEnvelope(obj: unknown): obj is Envelope {
  return (
    typeof obj === "object" &&
    obj !== null &&
    typeof (obj as Envelope).d === "string" &&
    typeof (obj as Envelope).s === "string"
  );
}

/**
 * `decryptApiBody(env, key, context)`. Returns the decoded JSON, or null when the
 * HMAC check fails / payload is malformed (never throws).
 */
export async function decryptEnvelope(env: Envelope, key: string, context: string): Promise<any | null> {
  try {
    const a = await sha256hex(`${key}|${context}|${_C}`);
    const expect = await hmacHex(env.d, a);
    if (expect !== env.s) return null;
    const s = cryptojsB64ToUtf8(env.d);
    const sep = s.indexOf(":");
    if (sep < 0) return null;
    const h = s.slice(0, sep);
    const l = s.slice(sep + 1);
    const u = a.slice(0, _I);
    const p = (await sha256hex(`${_F}:${h}:${a}`)).slice(0, _D);
    const v = xor(l, p).split("").reverse().join("");
    const decoded = cryptojsB64ToUtf8(xor(v, u));
    const plaintext = await decryptOpenssl(decoded, a);
    return JSON.parse(plaintext);
  } catch {
    return null;
  }
}
