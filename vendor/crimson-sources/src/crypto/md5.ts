/*
 * Compact MD5 (bytes -> 16 bytes). Vendored solely because CryptoJS's
 * `AES.decrypt(ciphertext, passphraseString)` derives its key/iv with OpenSSL
 * `EVP_BytesToKey`, which is MD5-based — and WebCrypto deliberately omits MD5. The
 * ScreenScape envelope ([[screenscape-source]]) is the only consumer; this is the
 * inverse-cipher KDF helper, nothing security-sensitive runs on MD5 itself.
 *
 * Standard RFC 1321 implementation, validated against known vectors
 * (md5("") = d41d8cd98f00b204e9800998ecf8427e).
 */

function rotl(x: number, c: number): number {
  return (x << c) | (x >>> (32 - c));
}

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const K = (() => {
  const k = new Uint32Array(64);
  for (let i = 0; i < 64; i++) k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0;
  return k;
})();

export function md5(input: Uint8Array): Uint8Array {
  const origLen = input.length;
  const bitLen = origLen * 8;
  // pad: 0x80, then zeros to 56 mod 64, then 8-byte little-endian length.
  const padLen = ((56 - ((origLen + 1) % 64)) + 64) % 64;
  const total = origLen + 1 + padLen + 8;
  const msg = new Uint8Array(total);
  msg.set(input);
  msg[origLen] = 0x80;
  // 64-bit little-endian bit length (high 32 bits effectively 0 for our inputs).
  const lenLo = bitLen >>> 0;
  const lenHi = Math.floor(bitLen / 2 ** 32) >>> 0;
  msg[total - 8] = lenLo & 0xff;
  msg[total - 7] = (lenLo >>> 8) & 0xff;
  msg[total - 6] = (lenLo >>> 16) & 0xff;
  msg[total - 5] = (lenLo >>> 24) & 0xff;
  msg[total - 4] = lenHi & 0xff;
  msg[total - 3] = (lenHi >>> 8) & 0xff;
  msg[total - 2] = (lenHi >>> 16) & 0xff;
  msg[total - 1] = (lenHi >>> 24) & 0xff;

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);

  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      M[i] = (msg[j]! | (msg[j + 1]! << 8) | (msg[j + 2]! << 16) | (msg[j + 3]! << 24)) >>> 0;
    }
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) {
        f = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        f = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        f = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      f = (f + A + K[i]! + M[g]!) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotl(f, S[i]!)) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const words = [a0, b0, c0, d0];
  for (let i = 0; i < 4; i++) {
    out[i * 4] = words[i]! & 0xff;
    out[i * 4 + 1] = (words[i]! >>> 8) & 0xff;
    out[i * 4 + 2] = (words[i]! >>> 16) & 0xff;
    out[i * 4 + 3] = (words[i]! >>> 24) & 0xff;
  }
  return out;
}
