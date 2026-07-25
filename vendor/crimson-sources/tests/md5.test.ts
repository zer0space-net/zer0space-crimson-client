/*
 * Vendored MD5 (src/crypto/md5.ts) — the EVP_BytesToKey KDF behind the
 * ScreenScape CryptoJS envelope. WebCrypto omits MD5, so this hand-rolled impl
 * is pinned against the RFC 1321 known vectors.
 */
import { describe, expect, it } from "vitest";

import { md5 } from "../src/crypto/md5";

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function md5hex(s: string): string {
  return hex(md5(new TextEncoder().encode(s)));
}

describe("md5", () => {
  it("matches RFC 1321 test vectors", () => {
    expect(md5hex("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5hex("a")).toBe("0cc175b9c0f1b6a831c399e269772661");
    expect(md5hex("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5hex("message digest")).toBe("f96b697d7cb7938d525a2f31aaf161d0");
    expect(md5hex("The quick brown fox jumps over the lazy dog")).toBe(
      "9e107d9d372bb6826bd81d3542a419d6",
    );
  });
  it("handles inputs around the 56-byte padding boundary", () => {
    // These lengths exercise the pad-to-56-then-append-length path, including the
    // case that forces a whole extra block (56/62 bytes).
    expect(md5hex("a".repeat(55))).toBe("ef1772b6dff9a122358552954ad0df65");
    expect(md5hex("a".repeat(56))).toBe("3b0c8ac703f828b04c6c197006d17218");
    expect(md5hex("a".repeat(62))).toBe("24612f0ce2c9d2cf2b022ef1e027a54f");
  });
});
