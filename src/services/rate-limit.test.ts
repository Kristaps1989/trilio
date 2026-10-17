import { describe, expect, it } from "vitest";
import { clientKey, createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows up to the limit per window, then refuses until the window resets", () => {
    const rl = createRateLimiter(3, 1000);
    expect(rl.allow("a", 0)).toBe(true);
    expect(rl.allow("a", 10)).toBe(true);
    expect(rl.allow("a", 20)).toBe(true);
    expect(rl.allow("a", 30)).toBe(false);
    expect(rl.allow("b", 30)).toBe(true); // other keys unaffected
    expect(rl.allow("a", 1001)).toBe(true); // window reset
  });

  it("sweeps expired entries without affecting live ones", () => {
    const rl = createRateLimiter(1, 100);
    expect(rl.allow("old", 0)).toBe(true);
    expect(rl.allow("new", 150)).toBe(true); // triggers sweep of "old"
    expect(rl.allow("old", 160)).toBe(true);
    expect(rl.allow("new", 170)).toBe(false);
  });
});

describe("clientKey", () => {
  it("takes the first forwarded address, then x-real-ip, then a shared bucket", () => {
    expect(clientKey(new Request("https://x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } }))).toBe(
      "1.2.3.4",
    );
    expect(clientKey(new Request("https://x", { headers: { "x-real-ip": "5.6.7.8" } }))).toBe("5.6.7.8");
    expect(clientKey(new Request("https://x"))).toBe("unknown");
  });
});
