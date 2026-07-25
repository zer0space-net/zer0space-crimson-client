/*
 * Base64 helpers (src/util/base64.ts) — used to decode the AnimeSuge
 * `data-embed-id` / aniwatch `data-hash` markers and inside the ScreenScape
 * crypto. Standard + url-safe round-trips and malformed-input handling are pinned.
 */
import { describe, expect, it } from "vitest";

import {
  b64DecodeText,
  b64ToBytes,
  b64UrlEncodeText,
  binaryToBytes,
  bytesToBinary,
} from "../src/util/base64";

describe("b64DecodeText", () => {
  it("decodes standard base64 to UTF-8", () => {
    // btoa("Crimson") === "Q3JpbXNvbg=="
    expect(b64DecodeText("Q3JpbXNvbg==")).toBe("Crimson");
  });
  it("decodes url-safe base64 with stripped padding", () => {
    // url-safe, no padding: "ab+c/d" style — use a value with - and _ .
    const std = btoa("subs?ok>>"); // contains chars that map to +,/ after encode
    const urlsafe = std.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(b64DecodeText(urlsafe)).toBe("subs?ok>>");
  });
  it("returns null on malformed input", () => {
    expect(b64ToBytes("")).toBeNull();
    expect(b64DecodeText("!!!not base64!!!")).toBeNull();
  });
});

describe("b64UrlEncodeText round-trip", () => {
  it("encodes to url-safe (no +,/,=) and decodes back", () => {
    const text = "Frieren: Beyond Journey's End ✦";
    const enc = b64UrlEncodeText(text);
    expect(enc).not.toMatch(/[+/=]/);
    expect(b64DecodeText(enc)).toBe(text);
  });
});

describe("binaryToBytes / bytesToBinary", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 65, 66]);
    expect(binaryToBytes(bytesToBinary(bytes))).toEqual(bytes);
  });
});
