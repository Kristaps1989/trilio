import { describe, expect, it } from "vitest";
import { statsAuthorised } from "./stats-api";

describe("the statistics API token", () => {
  const token = "t".repeat(32);
  it("opens only with the configured bearer token", () => {
    expect(statsAuthorised(`Bearer ${token}`, token)).toBe(true);
    expect(statsAuthorised(`bearer ${token}`, token)).toBe(true);
    expect(statsAuthorised(`Bearer ${token}x`, token)).toBe(false);
    expect(statsAuthorised(token, token)).toBe(false);
    expect(statsAuthorised(null, token)).toBe(false);
  });
  it("is closed while no token, or too short a token, is configured", () => {
    expect(statsAuthorised("Bearer ", "")).toBe(false);
    expect(statsAuthorised("Bearer x", undefined)).toBe(false);
    expect(statsAuthorised("Bearer short", "short")).toBe(false);
  });
});
