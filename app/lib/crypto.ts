import crypto from "node:crypto";

// At-rest encryption for integration secrets (access tokens, API keys, webhook
// URLs). Server-only — never import into a client component. AES-256-GCM with a
// random 96-bit IV per value. The 32-byte AES key is derived (SHA-256) from
// SHIELDFLOW_ENCRYPTION_KEY, so the env var can be any strong secret/passphrase
// — a long random value (e.g. `openssl rand -base64 32`) is best.
//
// Stored format: `v1:<iv_b64>:<tag_b64>:<ciphertext_b64>`. The version prefix
// lets us rotate the scheme later, and lets decryptSecret tell an encrypted value
// from a legacy plaintext one.

const PREFIX = "v1";

export const ENCRYPTION_NOT_CONFIGURED =
  "Encryption isn't configured on the server — secrets can't be stored securely yet. Set SHIELDFLOW_ENCRYPTION_KEY and try again.";

export class EncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionError";
  }
}

function getKey(): Buffer | null {
  const raw = process.env.SHIELDFLOW_ENCRYPTION_KEY;
  if (!raw || raw.trim() === "") return null;
  // Derive a 32-byte AES-256 key from the configured secret. Accepts any
  // length/charset, so the env var can be a passphrase or a random base64 string.
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

export function isEncryptionConfigured(): boolean {
  return getKey() !== null;
}

/** Encrypt a secret for at-rest storage. Throws (fail closed) if the key is missing. */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  if (!key) throw new EncryptionError(ENCRYPTION_NOT_CONFIGURED);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

/**
 * Decrypt a stored secret. A value NOT prefixed `v1:` is treated as legacy
 * plaintext and returned unchanged, so existing rows keep working until the next
 * reconnect re-encrypts them. A `v1:` value with a missing/invalid key, or that
 * fails authentication (tampered/corrupt), throws — the caller flags the
 * integration for reconnect and must never log the value.
 */
export function decryptSecret(payload: string): string {
  if (!payload.startsWith(`${PREFIX}:`)) return payload; // legacy plaintext
  const key = getKey();
  if (!key) throw new EncryptionError(ENCRYPTION_NOT_CONFIGURED);
  const parts = payload.split(":");
  if (parts.length !== 4) throw new EncryptionError("Malformed ciphertext.");
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Encrypt if the key is configured, otherwise return plaintext. Use ONLY for
 * internal token-refresh writes during a sync, where breaking an in-flight sync
 * over a config gap would be worse than matching the row's existing (legacy)
 * representation. User-initiated connects use encryptSecret (fail closed).
 */
export function encryptIfConfigured(plaintext: string): string {
  return isEncryptionConfigured() ? encryptSecret(plaintext) : plaintext;
}
