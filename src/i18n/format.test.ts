import { describe, expect, it } from "vitest";
import {
  categoryGender,
  formatCm,
  formatDateDative,
  formatDateNominative,
  formatDateShort,
  formatDayLocative,
  formatDb,
  formatEur,
  formatEurDelta,
  formatInt,
  formatLitres,
  formatNumber,
  formatPlain,
  formatRating,
} from "./format";

const TS = " "; // thin space
const NB = " ";

describe("formatEur", () => {
  it("drops cents for whole euros and puts a non-breaking space before €", () => {
    expect(formatEur(59900)).toBe(`599${NB}€`);
  });
  it("groups thousands with a thin space", () => {
    expect(formatEur(107900)).toBe(`1${TS}079${NB}€`);
    expect(formatEur(123456700)).toBe(`1${TS}234${TS}567${NB}€`);
  });
  it("uses a decimal comma for cents", () => {
    expect(formatEur(1990)).toBe(`19,90${NB}€`);
    expect(formatEur(5)).toBe(`0,05${NB}€`);
  });
  it("handles zero and negatives", () => {
    expect(formatEur(0)).toBe(`0${NB}€`);
    expect(formatEur(-2500)).toBe(`−25${NB}€`);
  });
});

describe("formatEurDelta", () => {
  it("prefixes positive deltas with +", () => {
    expect(formatEurDelta(18000)).toBe(`+180${NB}€`);
    expect(formatEurDelta(-5000)).toBe(`−50${NB}€`);
  });
});

describe("numbers", () => {
  it("formatInt groups", () => {
    expect(formatInt(999)).toBe("999");
    expect(formatInt(1000)).toBe(`1${TS}000`);
  });
  it("formatNumber uses comma", () => {
    expect(formatNumber(59.5)).toBe("59,5");
    expect(formatNumber(8.6)).toBe("8,6");
    expect(formatRating(8.55)).toBe("8,6");
  });
  it("formatCm", () => {
    expect(formatCm(59.5)).toBe(`59,5${NB}cm`);
    expect(formatCm(60)).toBe(`60${NB}cm`);
  });
});

describe("formatDateDative", () => {
  it("uses dative weekday and month", () => {
    // 2026-10-21 is a Wednesday.
    expect(formatDateDative(new Date(2026, 9, 21))).toBe("trešdienai, 21. oktobrim");
    expect(formatDateDative(new Date(2026, 0, 5))).toBe("pirmdienai, 5. janvārim");
  });
});

describe("categoryGender", () => {
  it("agrees with the head noun of the category label", () => {
    for (const l of [
      "Ledusskapji",
      "Sendviču tosteri",
      "Taukvāres katli un karstā gaisa friteri",
      "Trimmeri un matu mašīnas",
    ])
      expect(categoryGender(l)).toBe("m");
    for (const l of [
      "Saldētavas",
      "Tējkannas",
      "Plītis un plīts virsmas",
      "Mikroviļņu krāsnis",
      "Elektriskās zobu birstes",
    ])
      expect(categoryGender(l)).toBe("f");
  });
});

describe("English formats (docs/ENGLISH_AND_ACCESSIBILITY_PLAN.md §4.3)", () => {
  it("puts € in front, groups with commas and uses a decimal point", () => {
    expect(formatEur(59900, "en")).toBe("€599");
    expect(formatEur(107900, "en")).toBe("€1,079");
    expect(formatEur(1990, "en")).toBe("€19.90");
    expect(formatEur(-18000, "en")).toBe("−€180");
    expect(formatEurDelta(18000, "en")).toBe("+€180");
    expect(formatInt(1234567, "en")).toBe("1,234,567");
    expect(formatNumber(59.5, 1, "en")).toBe("59.5");
    expect(formatRating(8.6, "en")).toBe("8.6");
    expect(formatCm(59.5, "en")).toBe(`59.5${NB}cm`);
    expect(formatLitres(1200, "en")).toBe(`1,200${NB}L`);
    expect(formatDb(38, "en")).toBe(`38${NB}dB`);
    expect(formatPlain(0.5, "en")).toBe("0.5");
  });
  it("writes dates the British way, without day-month ambiguity", () => {
    const d = new Date(2026, 9, 28);
    expect(formatDateDative(d, "en")).toBe("Wednesday, 28 October");
    expect(formatDateNominative(d, "en")).toBe("Wednesday, 28 October");
    expect(formatDayLocative(d, "en")).toBe("28 October");
    expect(formatDateShort(d, "en")).toBe("28 Oct 2026");
  });
  it("keeps the Latvian forms for lv and outside a request", () => {
    const d = new Date(2026, 9, 28);
    expect(formatDateDative(d, "lv")).toBe("trešdienai, 28. oktobrim");
    expect(formatDateNominative(d)).toBe("trešdiena, 28. oktobris");
    expect(formatDayLocative(d)).toBe("28. oktobrī");
    expect(formatDateShort(d)).toBe("28.10.2026");
    expect(formatPlain(0.5)).toBe("0,5");
    expect(formatEur(107900, "lv")).toBe(`1${TS}079${NB}€`);
  });
});
