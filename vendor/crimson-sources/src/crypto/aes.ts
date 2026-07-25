/*
 * CryptoJS-compatible AES decrypt — client port of resolvers/_aes.py.
 *
 * ScreenScape's API wraps responses in CryptoJS `AES.encrypt(plaintext,
 * passphraseString)`, i.e. base64 of `"Salted__" + salt(8) + ciphertext`, with the
 * key/iv derived from the passphrase by OpenSSL `EVP_BytesToKey` (MD5, 1 round),
 * AES-256-CBC, PKCS#7. The browser does the heavy lifting: WebCrypto runs AES-CBC
 * (and strips PKCS#7) natively; only the MD5 KDF is vendored (see ./md5).
 */
import { md5 } from "./md5";
import { binaryToBytes } from "../util/base64";

/** Copy a (possibly subarray-backed) Uint8Array into a standalone ArrayBuffer for
 *  the WebCrypto APIs, which want an ArrayBuffer-backed BufferSource. */
function ab(u: Uint8Array): ArrayBuffer {
  return u.slice().buffer as ArrayBuffer;
}

/** OpenSSL EVP_BytesToKey(MD5, 1 iter) — derive key(32)+iv(16) from passphrase+salt. */
function evpBytesToKey(passphrase: Uint8Array, salt: Uint8Array, keyLen = 32, ivLen = 16): { key: Uint8Array; iv: Uint8Array } {
  const out: number[] = [];
  let prev: Uint8Array = new Uint8Array(0);
  while (out.length < keyLen + ivLen) {
    const block = new Uint8Array(prev.length + passphrase.length + salt.length);
    block.set(prev, 0);
    block.set(passphrase, prev.length);
    block.set(salt, prev.length + passphrase.length);
    prev = md5(block);
    out.push(...prev);
  }
  return { key: new Uint8Array(out.slice(0, keyLen)), iv: new Uint8Array(out.slice(keyLen, keyLen + ivLen)) };
}

/**
 * Decrypt a CryptoJS `AES.encrypt(plaintext, passphraseString)` output to its
 * UTF-8 plaintext. Throws on a non-salted blob or a WebCrypto failure (bad
 * padding/key) — callers treat a throw as "couldn't decrypt".
 */
export async function decryptOpenssl(b64Cipher: string, passphrase: string): Promise<string> {
  const raw = binaryToBytes(atob(b64Cipher));
  // "Salted__" magic.
  const magic = [0x53, 0x61, 0x6c, 0x74, 0x65, 0x64, 0x5f, 0x5f];
  for (let i = 0; i < 8; i++) {
    if (raw[i] !== magic[i]) throw new Error("not an OpenSSL-salted ciphertext");
  }
  const salt = raw.slice(8, 16);
  const ct = raw.slice(16);
  const { key, iv } = evpBytesToKey(new TextEncoder().encode(passphrase), salt);

  const cryptoKey = await crypto.subtle.importKey("raw", ab(key), { name: "AES-CBC" }, false, ["decrypt"]);
  const ptBuf = await crypto.subtle.decrypt({ name: "AES-CBC", iv: ab(iv) }, cryptoKey, ab(ct));
  return new TextDecoder("utf-8").decode(new Uint8Array(ptBuf));
}
