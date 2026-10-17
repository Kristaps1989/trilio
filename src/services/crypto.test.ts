import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, keyFromEnv } from "./crypto";

describe("encryptSecret / decryptSecret", () => {
  const key = randomBytes(32);
  it("round-trips and never repeats ciphertext", () => {
    const a = encryptSecret("tok_123", key);
    const b = encryptSecret("tok_123", key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe("tok_123");
    expect(decryptSecret(b, key)).toBe("tok_123");
  });
  it("fails on a different key or tampered data", () => {
    const c = encryptSecret("tok_123", key);
    expect(() => decryptSecret(c, randomBytes(32))).toThrow();
    const tampered = Buffer.from(c, "base64url");
    tampered[tampered.length - 1]! ^= 1;
    expect(() => decryptSecret(tampered.toString("base64url"), key)).toThrow();
  });
  it("requires a 64-hex key from env", () => {
    expect(() => keyFromEnv({})).toThrow(/PAYMENT_TOKEN_KEY/);
    expect(() => keyFromEnv({ PAYMENT_TOKEN_KEY: "abc" })).toThrow(/PAYMENT_TOKEN_KEY/);
    expect(keyFromEnv({ PAYMENT_TOKEN_KEY: "ab".repeat(32) })).toHaveLength(32);
  });
});
