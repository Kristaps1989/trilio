import { describe, expect, it } from "vitest";
import { addWorkingDays, deliveryDate, urgencyDate, workingDaysUntil } from "./delivery";
import { easterSunday, holidays, isWorkingDay, key, weekday } from "./holidays";

const d = (y: number, m: number, dd: number) => ({ y, m, d: dd });

describe("holidays", () => {
  it("computes Easter correctly", () => {
    expect(key(easterSunday(2026))).toBe("2026-04-05");
    expect(key(easterSunday(2027))).toBe("2027-03-28");
    expect(key(easterSunday(2024))).toBe("2024-03-31");
  });

  it("Latvian holidays include Midsummer, 18 November and the Monday after a weekend 4 May / 18 November", () => {
    const lv = holidays("LV", 2026).map(key);
    expect(lv).toContain("2026-06-23");
    expect(lv).toContain("2026-06-24");
    expect(lv).toContain("2026-11-18");
    expect(lv).toContain("2026-04-03"); // Good Friday
    expect(lv).toContain("2026-04-06"); // Easter Monday
    // 4 May 2024 was a Saturday → Monday 6 May observed
    expect(holidays("LV", 2024).map(key)).toContain("2024-05-06");
    // 18 November 2028 is a Saturday → Monday 20 November
    expect(holidays("LV", 2028).map(key)).toContain("2028-11-20");
  });

  it("Lithuania and Estonia have their own days", () => {
    expect(holidays("LT", 2026).map(key)).toContain("2026-02-16");
    expect(holidays("LT", 2026).map(key)).toContain("2026-07-06");
    expect(holidays("EE", 2026).map(key)).toContain("2026-02-24");
    expect(holidays("EE", 2026).map(key)).toContain("2026-05-24"); // Pentecost 2026
    expect(holidays("EE", 2026).map(key)).not.toContain("2026-04-06"); // no Easter Monday in EE
  });

  it("weekends and holidays are not working days", () => {
    expect(weekday(d(2026, 10, 17))).toBe(6); // Saturday
    expect(isWorkingDay("LV", d(2026, 10, 17))).toBe(false);
    expect(isWorkingDay("LV", d(2026, 10, 19))).toBe(true);
    expect(isWorkingDay("LV", d(2026, 11, 18))).toBe(false);
    expect(isWorkingDay("LT", d(2026, 11, 18))).toBe(true);
  });
});

describe("addWorkingDays", () => {
  it("skips weekends", () => {
    // Friday 16 Oct 2026 + 3 working days = Wednesday 21 Oct
    expect(key(addWorkingDays(d(2026, 10, 16), 3, "LV"))).toBe("2026-10-21");
    // Sunday 18 Oct + 3 = Wednesday 21 Oct (spec example: "piegāde līdz trešdienai, 21. oktobrim")
    expect(key(addWorkingDays(d(2026, 10, 18), 3, "LV"))).toBe("2026-10-21");
  });
  it("skips holidays", () => {
    // Monday 16 Nov 2026 + 3 working days: 17, (18 holiday), 19, 20 → Friday 20 Nov
    expect(key(addWorkingDays(d(2026, 11, 16), 3, "LV"))).toBe("2026-11-20");
    // Same in Lithuania where 18 Nov is a working day → Thursday 19 Nov
    expect(key(addWorkingDays(d(2026, 11, 16), 3, "LT"))).toBe("2026-11-19");
    // Across Midsummer: Monday 22 Jun 2026 + 2 → 26 Jun (23, 24 off; 25 = day 1, 26 = day 2)
    expect(key(addWorkingDays(d(2026, 6, 22), 2, "LV"))).toBe("2026-06-26");
  });
  it("zero days is the same day", () => {
    expect(key(addWorkingDays(d(2026, 10, 17), 0, "LV"))).toBe("2026-10-17");
  });
});

describe("urgency and delivery dates", () => {
  const sunday = new Date(Date.UTC(2026, 9, 18, 15, 0, 0));
  it("asap is 3 working days, two weeks is 5", () => {
    expect(urgencyDate("asap", sunday, "LV").toISOString().slice(0, 10)).toBe("2026-10-21");
    expect(urgencyDate("two_weeks", sunday, "LV").toISOString().slice(0, 10)).toBe("2026-10-23");
  });
  it("prefers the shop ETA, falls back to the store default, adds a week for 'soon', none for 'out'", () => {
    const base = { deliveryEtaDays: null, storeDefaultDeliveryDays: 3, stock: "in" as const };
    expect(deliveryDate(base, sunday, "LV")!.toISOString().slice(0, 10)).toBe("2026-10-21");
    expect(
      deliveryDate({ ...base, deliveryEtaDays: 1 }, sunday, "LV")!
        .toISOString()
        .slice(0, 10),
    ).toBe("2026-10-19");
    expect(workingDaysUntil({ ...base, stock: "soon" })).toBe(10);
    expect(deliveryDate({ ...base, stock: "out" }, sunday, "LV")).toBeNull();
    expect(workingDaysUntil({ ...base, stock: "out" })).toBeNull();
  });
});
