import { describe, expect, it } from "vitest";
import { schedulerEnabled } from "./scheduler";

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
