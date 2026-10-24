import { describe, expect, it } from "vitest";
import { nextReviewDay, reviewDue } from "./optimiser";

// Claude reviews weekly by default (owner, 24 Oct 2026); the code-only parts run daily.

describe("review schedule", () => {
  const weekly = { reviewCadence: "weekly", reviewWeekday: 1 };
  it("is due on the owner's weekday, or every day when chosen", () => {
    expect(reviewDue(weekly, 1)).toBe(true);
    expect(reviewDue(weekly, 2)).toBe(false);
    expect(reviewDue({ reviewCadence: "daily", reviewWeekday: 1 }, 4)).toBe(true);
  });
  it("names the next review day in Riga time", () => {
    const saturday = new Date("2026-10-24T10:00:00Z");
    expect(nextReviewDay(weekly, saturday, false)).toBe("2026-10-26");
    const monday = new Date("2026-10-26T10:00:00Z");
    expect(nextReviewDay(weekly, monday, false)).toBe("2026-10-26");
    expect(nextReviewDay(weekly, monday, true)).toBe("2026-11-02");
    expect(nextReviewDay({ reviewCadence: "weekly", reviewWeekday: 3 }, monday, true)).toBe("2026-10-28");
    expect(nextReviewDay({ reviewCadence: "daily", reviewWeekday: 1 }, monday, true)).toBe("2026-10-27");
  });
});
