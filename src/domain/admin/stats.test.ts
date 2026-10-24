import { describe, expect, it } from "vitest";
import { change, daysBetween, paidRatio, parseRange, quartiles, rangeDays, toCsv, topAnswers } from "./stats";

describe("ranges", () => {
  it("parses the period, defaulting to 30 days", () => {
    expect(parseRange("7")).toBe("7");
    expect(parseRange("today")).toBe("today");
    expect(parseRange("365")).toBe("30");
    expect(parseRange(undefined)).toBe("30");
  });
  it("gives Riga days and the previous period of the same length", () => {
    const now = new Date("2026-10-24T22:30:00Z"); // already 25 Oct in Riga
    expect(rangeDays("7", now)).toEqual({
      from: "2026-10-19",
      to: "2026-10-25",
      prevFrom: "2026-10-12",
      prevTo: "2026-10-18",
      days: 7,
    });
    expect(rangeDays("today", now)).toMatchObject({
      from: "2026-10-25",
      to: "2026-10-25",
      prevTo: "2026-10-24",
    });
  });
  it("lists every day for charts", () => {
    expect(daysBetween("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
    expect(daysBetween("2026-11-02", "2026-11-01")).toEqual([]);
  });
});

describe("numbers", () => {
  it("compares with the previous period", () => {
    expect(change(150, 100)).toBe(50);
    expect(change(50, 100)).toBe(-50);
    expect(change(5, 0)).toBeNull();
  });
  it("computes quartiles", () => {
    expect(quartiles([])).toBeNull();
    expect(quartiles([40000])).toEqual({ q1: 40000, median: 40000, q3: 40000 });
    expect(quartiles([100, 400, 200, 300])).toEqual({ q1: 175, median: 250, q3: 325 });
  });
  it("paid ÷ sent", () => {
    expect(paidRatio(3, 12)).toBe(25);
    expect(paidRatio(0, 0)).toBeNull();
  });
});

describe("topAnswers", () => {
  it("counts each option, multi-choice too, most common first", () => {
    const r = topAnswers(
      [
        { size: "186", doors: "one", features: ["nofrost", "display"] },
        { size: "186", features: ["nofrost"] },
        { size: "200", extra: { nested: true } },
      ],
      2,
    );
    expect(r).toEqual([
      {
        question: "size",
        total: 3,
        options: [
          { option: "186", count: 2 },
          { option: "200", count: 1 },
        ],
      },
      {
        question: "features",
        total: 2,
        options: [
          { option: "nofrost", count: 2 },
          { option: "display", count: 1 },
        ],
      },
      { question: "doors", total: 1, options: [{ option: "one", count: 1 }] },
    ]);
  });
});

describe("toCsv", () => {
  it("quotes, escapes and defuses formulas", () => {
    expect(
      toCsv(
        ["a", "b"],
        [
          ["x,y", 'say "hi"'],
          [null, 3],
          ["=SUM(A1)", -2],
        ],
      ),
    ).toBe('a,b\r\n"x,y","say ""hi"""\r\n,3\r\n\'=SUM(A1),-2\r\n');
  });
});
