import { describe, expect, it } from "vitest";
import { brandFromName, gtinCheckDigit, modelKey, normalizeEan, normalizeModelCode } from "./ean";

describe("normalizeEan", () => {
  it("accepts a valid GTIN-13 and strips separators", () => {
    expect(normalizeEan("4003174289161")).toBe("4003174289161");
    expect(normalizeEan("4003 174 289 161")).toBe("4003174289161");
    expect(normalizeEan(4003174289161)).toBe("4003174289161");
  });
  it("rejects a wrong check digit", () => {
    expect(normalizeEan("4003174289162")).toBeNull();
  });
  it("pads UPC-A and GTIN-8 to 13 digits", () => {
    expect(normalizeEan("036000291452")).toBe("0036000291452");
    expect(normalizeEan("96385074")).toBe("0000096385074");
  });
  it("keeps GTIN-14 at 14 digits", () => {
    const body = "1400317428916";
    const code = body + gtinCheckDigit(body);
    expect(normalizeEan(code)).toBe(code);
  });
  it("rejects garbage, empty and all-zero codes", () => {
    expect(normalizeEan("")).toBeNull();
    expect(normalizeEan(null)).toBeNull();
    expect(normalizeEan("abc")).toBeNull();
    expect(normalizeEan("0000000000000")).toBeNull();
    expect(normalizeEan("12345")).toBeNull();
  });
});

describe("model identity", () => {
  it("normalises model codes", () => {
    expect(normalizeModelCode("kgn 39-vlct")).toBe("KGN39VLCT");
    expect(normalizeModelCode("RB34C672ESA/EF")).toBe("RB34C672ESAEF");
  });
  it("builds a brand+model key", () => {
    expect(modelKey("Bosch", "KGN39VLCT")).toBe("bosch:KGN39VLCT");
    expect(modelKey(" BOSCH ", "kgn39vlct")).toBe("bosch:KGN39VLCT");
  });
  it("takes the brand from the name", () => {
    expect(brandFromName("Bosch Serie 4 kombinētais")).toBe("Bosch");
    expect(brandFromName("Samsung, No Frost")).toBe("Samsung");
  });
});
