const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ALPHABET_LEN = ALPHABET.length; // 62
const REJECTION_CEILING = Math.floor(256 / ALPHABET_LEN) * ALPHABET_LEN; // 248

/**
 * Cryptographically random base62 id. 10 chars is ~59 bits, which makes posts
 * unlisted-but-unguessable: the id is the capability.
 */
export function randomId(length = 10): string {
  if (length <= 0) return "";
  let out = "";
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    for (const byte of bytes) {
      if (byte >= REJECTION_CEILING) continue; // avoid modulo bias
      out += ALPHABET[byte % ALPHABET_LEN];
      if (out.length === length) break;
    }
  }
  return out;
}
