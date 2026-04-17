/**
 * GitHub Secrets encryption — libsodium sealed_box (X25519 + XSalsa20-Poly1305).
 *
 * SECURITY: plaintext secrets are encrypted client→server via HTTPS, then
 * re-encrypted server-side with the repo's public key before being stored.
 * No plaintext is ever logged or persisted on this server.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
// Loaded via require to avoid Turbopack ESM resolution issues with the WASM binary
let sodiumCache: any = null;

async function getSodium(): Promise<any> {
  if (sodiumCache) return sodiumCache;
  // Dynamic require keeps this out of the module graph for edge runtimes
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('libsodium-wrappers');
  await mod.ready;
  sodiumCache = mod;
  return mod;
}

/**
 * Encrypt `secretValue` so it can be stored as a GitHub repo secret.
 * @param secretValue  Plaintext string
 * @param publicKeyB64 Repo public key returned by GET /repos/{owner}/{repo}/actions/secrets/public-key
 */
export async function encryptSecret(
  secretValue: string,
  publicKeyB64: string,
): Promise<string> {
  const sodium       = await getSodium();
  const keyBytes     = sodium.from_base64(publicKeyB64, sodium.base64_variants.ORIGINAL);
  const messageBytes = sodium.from_string(secretValue);
  const encrypted    = sodium.crypto_box_seal(messageBytes, keyBytes);
  return sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);
}

/**
 * Encrypt a binary buffer (e.g. a .jks keystore).
 * Buffer is base64-encoded first, then that string is encrypted.
 */
export async function encryptBinarySecret(
  buffer: Buffer,
  publicKeyB64: string,
): Promise<string> {
  return encryptSecret(buffer.toString('base64'), publicKeyB64);
}
