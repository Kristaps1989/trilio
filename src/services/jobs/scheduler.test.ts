import { describe, expect, it } from "vitest";
import { adsSyncTick, schedulerEnabled } from "./scheduler";

describe("schedulerEnabled", () => {
  it("is on for Railway production by default", () => {
    expect(schedulerEnabled({ RAILWAY_ENVIRONMENT_NAME: "production" })).toBe(true);
  });
  it("is off elsewhere by default (local, CI, e2e, preview environments)", () => {
    expect(schedulerEnabled({})).toBe(false);
    expect(schedulerEnabled({ RAILWAY_ENVIRONMENT_NAME: "pr-15" })).toBe(false);
  });
  it("INGEST_SCHEDULE overrides either way", () => {
    expect(schedulerEnabled({ RAILWAY_ENVIRONMENT_NAME: "production", INGEST_SCHEDULE: "off" })).toBe(false);
    expect(schedulerEnabled({ INGEST_SCHEDULE: "on" })).toBe(true);
  });
});

describe("adsSyncTick", () => {
  it("never throws: a failing ads sync is logged, the scheduler keeps running", async () => {
    const errors: unknown[] = [];
    const broken = new Proxy({}, { get: () => () => Promise.reject(new Error("db down")) }) as never;
    await expect(
      adsSyncTick(broken, { log: () => undefined, error: (...a: unknown[]) => errors.push(a) }),
    ).resolves.toBeUndefined();
    if (process.env.FEATURE_ADS === "1") expect(errors.length).toBeGreaterThan(0);
  });
});
