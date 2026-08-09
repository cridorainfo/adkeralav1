import crypto from 'crypto';

/**
 * Constant-time string comparison for secrets (device token hashes, admin/bus static keys) —
 * plain `===` short-circuits on the first differing byte, which is a textbook timing side
 * channel for anyone comparing over a network. Impractical to exploit against these particular
 * values in practice (network jitter dwarfs the signal; the token-hash cases are SHA-256 outputs,
 * so a successful byte-by-byte reconstruction still wouldn't yield a usable preimage token) — this
 * is defense-in-depth, not a response to an active exploit. See the security audit's finding.
 *
 * `crypto.timingSafeEqual` itself throws on mismatched lengths, which would leak length via a
 * thrown-vs-not branch — hash both operands to a fixed size first so every call compares
 * equal-length buffers regardless of the inputs' own lengths.
 */
export function timingSafeEqual(a, b) {
  const bufA = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const bufB = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}
