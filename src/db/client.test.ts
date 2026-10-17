import { describe, expect, it } from "vitest";
import { BUILD_PLACEHOLDER_URL, connectionString } from "./client";

describe("connectionString", () => {
  it("uses DATABASE_URL when set", () => {
    expect(connectionString({ DATABASE_URL: "postgres://a@b/c" })).toBe("postgres://a@b/c");
  });

  it("lets `next build` run without a database", () => {
    expect(connectionString({ NEXT_PHASE: "phase-production-build" })).toBe(BUILD_PLACEHOLDER_URL);
  });

  it("refuses to run without DATABASE_URL outside the build", () => {
    expect(() => connectionString({})).toThrow(/DATABASE_URL is not set/);
    expect(() => connectionString({ NEXT_PHASE: "phase-production-server" })).toThrow(/DATABASE_URL/);
  });
});
