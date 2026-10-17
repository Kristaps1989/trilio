import { describe, expect, it } from "vitest";
import { addInterval, nextRetryAt } from "./dates";

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("addInterval", () => {
  it("adds months with day clamping", () => {
    expect(iso(addInterval(new Date("2026-01-31T10:00:00Z"), "month"))).toBe("2026-02-28");
    expect(iso(addInterval(new Date("2028-01-31T10:00:00Z"), "month"))).toBe("2028-02-29");
    expect(iso(addInterval(new Date("2026-03-15T10:00:00Z"), "month"))).toBe("2026-04-15");
    expect(iso(addInterval(new Date("2026-12-15T10:00:00Z"), "month"))).toBe("2027-01-15");
  });
  it("adds years with leap-day clamping and keeps the time of day", () => {
    expect(iso(addInterval(new Date("2028-02-29T10:00:00Z"), "year"))).toBe("2029-02-28");
    expect(addInterval(new Date("2026-10-17T07:30:00Z"), "year").toISOString()).toBe(
      "2027-10-17T07:30:00.000Z",
    );
  });
});

describe("nextRetryAt", () => {
  it("retries after 1, 3 and 5 days, then gives up", () => {
    const from = new Date("2026-11-01T00:00:00Z");
    expect(iso(nextRetryAt(1, from)!)).toBe("2026-11-02");
    expect(iso(nextRetryAt(2, from)!)).toBe("2026-11-04");
    expect(iso(nextRetryAt(3, from)!)).toBe("2026-11-06");
    expect(nextRetryAt(4, from)).toBeNull();
  });
});
