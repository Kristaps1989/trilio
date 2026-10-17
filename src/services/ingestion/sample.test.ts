import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fridgeSizeClass, sampleAdapter } from "./sample";

const body = readFileSync("data/sample-products.json", "utf8");

describe("sampleAdapter", () => {
  const a = sampleAdapter.parse(body, { slug: "store_a" });

  it("rejects nothing from the shipped sample file", () => {
    expect(a.rejected).toEqual([]);
  });

  it("emits one row per offer of the requested store, skipping priceless out-of-stock rows", () => {
    expect(a.offers.length).toBeGreaterThan(200);
    expect(a.offers.every((o) => o.priceCents > 0)).toBe(true);
    const none = sampleAdapter.parse(body, { slug: "store_zzz" });
    expect(none.offers).toEqual([]);
  });

  it("normalises a fridge into attributes and question tags", () => {
    const bosch = a.offers.find((o) => o.modelCode === "KGN39VLCT")!;
    expect(bosch.subcategoryId).toBe("fridge");
    expect(bosch.ean).toBe("4003174289161");
    expect(bosch.brand).toBe("Bosch");
    expect(bosch.attributes).toMatchObject({
      height_cm: 203,
      volume_l: 363,
      energy_class: "E",
      size_class: "tall",
    });
    expect(bosch.tags).toEqual(expect.arrayContaining(["free", "tall", "yes", "nofrost", "quiet"]));
    expect(bosch.tags).not.toContain("le186");
    expect(bosch.rating).toBe(88);
    expect(bosch.priceCents).toBe(69900);
  });

  it("maps 'classic' vacuums to the corded option and keeps mop/pet flags", () => {
    const robot = a.offers.find((o) => o.modelCode === "S802-02")!;
    expect(robot.subcategoryId).toBe("vacuum");
    expect(robot.attributes).toMatchObject({ type: "robot", mop: true, pet_brush: true, run_min: 180 });
    expect(robot.tags).toEqual(expect.arrayContaining(["robot", "yes", "pets"]));
    const corded = a.offers.filter((o) => o.subcategoryId === "vacuum" && o.attributes.type === "corded");
    expect(corded.length).toBeGreaterThan(0);
    expect(corded.every((o) => o.tags.includes("corded"))).toBe(true);
  });

  it("turns refurbished entries into refurbished offers with grade and warranty", () => {
    const refurb = a.offers.filter((o) => o.condition === "refurbished");
    expect(refurb.length).toBeGreaterThan(0);
    const one = refurb.find((o) => o.modelCode === "RB34C672ESA")!;
    expect(one.grade).toMatch(/^A/);
    expect(one.warrantyMonths).toBe(12);
    // Shares the EAN with the new product so they resolve to the same product row.
    expect(a.offers.some((o) => o.ean === one.ean && o.condition === "new")).toBe(true);
  });

  it("generic products keep their tags and specs", () => {
    const freezer = a.offers.find((o) => o.subcategoryId === "freezer" && o.condition === "new")!;
    expect(freezer.tags.length).toBeGreaterThan(0);
    expect(freezer.specs).toBeTruthy();
  });
});

describe("fridgeSizeClass", () => {
  it("classifies by width then height", () => {
    expect(fridgeSizeClass(91, 178)).toBe("wide");
    expect(fridgeSizeClass(60, 85)).toBe("compact");
    expect(fridgeSizeClass(60, 160)).toBe("mid");
    expect(fridgeSizeClass(60, 178)).toBe("tall");
    expect(fridgeSizeClass(59.5, 203)).toBe("tall");
  });
});
