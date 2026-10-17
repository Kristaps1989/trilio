import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM for secrets at rest (recurring billing tokens). Key from
// PAYMENT_TOKEN_KEY (64 hex chars). Output: base64url(iv ‖ tag ‖ ciphertext).

export function keyFromEnv(env: Record<string, string | undefined> = process.env): Buffer {
  const hex = env.PAYMENT_TOKEN_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("PAYMENT_TOKEN_KEY must be 64 hex characters");
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plain: string, key: Buffer = keyFromEnv()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]).toString("base64url");
}

export function decryptSecret(encoded: string, key: Buffer = keyFromEnv()): string {
  const buf = Buffer.from(encoded, "base64url");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
