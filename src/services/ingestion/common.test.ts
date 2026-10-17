import { describe, expect, it } from "vitest";
import { mapCategory, parseAvailability, parseCondition, parsePriceCents } from "./common";

describe("parsePriceCents", () => {
  it("accepts the price formats shops actually send", () => {
    expect(parsePriceCents("699.00 EUR")).toBe(69900);
    expect(parsePriceCents("699,00 EUR")).toBe(69900);
    expect(parsePriceCents("1 079,00 EUR")).toBe(107900);
    expect(parsePriceCents("1.079,00 EUR")).toBe(107900);
    expect(parsePriceCents("1079.5")).toBe(107950);
    expect(parsePriceCents("649 €")).toBe(64900);
  });
  it("rejects other currencies, zero and junk", () => {
    expect(parsePriceCents("699.00 USD")).toBeNull();
    expect(parsePriceCents("0")).toBeNull();
    expect(parsePriceCents("")).toBeNull();
    expect(parsePriceCents(undefined)).toBeNull();
    expect(parsePriceCents("free")).toBeNull();
  });
});

describe("parseAvailability / parseCondition", () => {
  it("normalises Google and Latvian variants", () => {
    expect(parseAvailability("in stock")).toBe("in");
    expect(parseAvailability("in_stock")).toBe("in");
    expect(parseAvailability("Ir noliktavā")).toBe("in");
    expect(parseAvailability("preorder")).toBe("soon");
    expect(parseAvailability("out of stock")).toBe("out");
    expect(parseAvailability("maybe")).toBeNull();
    expect(parseCondition(undefined)).toBe("new");
    expect(parseCondition("Refurbished")).toBe("refurbished");
    expect(parseCondition("used")).toBe("refurbished");
    expect(parseCondition("broken")).toBeNull();
  });
});

describe("mapCategory", () => {
  it("uses the store map (full path or last segment), then the regex table, else null", () => {
    const store = {
      slug: "s",
      categoryMap: { "Sadzīves tehnika > Ledusskapji": "fridge", Saldētavas: "freezer" },
    };
    expect(mapCategory({ product_type: "sadzīves tehnika > ledusskapji" }, store)).toBe("fridge");
    expect(mapCategory({ product_type: "Virtuve > Saldētavas" }, store)).toBe("freezer");
    expect(mapCategory({ product_type: "Rokas blenderi" }, store)).toBe("handblender");
    expect(mapCategory({ product_type: "Televizori" }, store)).toBeNull();
    expect(mapCategory({}, store)).toBeNull();
  });
  it("ignores map targets that are not real subcategories", () => {
    expect(
      mapCategory({ product_type: "X" }, { slug: "s", categoryMap: { X: "not-a-subcategory" } }),
    ).toBeNull();
  });
});
