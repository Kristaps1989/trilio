import { describe, expect, it } from "vitest";
import {
  cleanName,
  displayName,
  modelStem,
  nameHasType,
  repairMojibake,
  sameModel,
  shortName,
} from "./naming";

describe("displayName (§2.8: the name says what the product is)", () => {
  it("adds the type after the brand when the shop's name has none", () => {
    expect(displayName("Indesit C YSD 83D WW EE", "Indesit", "dryer", "veļas žāvētājs")).toBe(
      "Indesit veļas žāvētājs C YSD 83D WW EE",
    );
  });
  it("leaves names that already say it", () => {
    expect(nameHasType("Bomann KS 2194 kombinētais ledusskapis", "fridge")).toBe(true);
    expect(displayName("Beko ledusskapis RCSA", "Beko", "fridge", "ledusskapis")).toBe(
      "Beko ledusskapis RCSA",
    );
  });
});

describe("cleanName (docs/TRUST_POLISH_PLAN.md §3)", () => {
  it("cuts the spec tail, the doubled brand and rebuilds a foreign-language title", () => {
    expect(
      cleanName(
        "Frytkownica beztłuszczowa Tristar Tristar Digital Airfryer | FR-9073 | Jauda 1800 W | Tilpums 9 L | Karstā gaisa tehnoloģija | Melns",
        "Tristar",
        "FR-9073",
      ),
    ).toBe("Tristar Digital Airfryer FR-9073");
  });
  it("turns a shouting title with an EAN into brand and model", () => {
    expect(cleanName("AIR FRYER/AF30 DREAME AF30 (6978515256110)", "DREAME", "AF30")).toBe("Dreame AF30");
  });
  it("drops a trailing type repeat and keeps the rest as written", () => {
    expect(cleanName("Tefal fritieris Principio, 1000 W, melna - Friteris", "Tefal", "")).toBe(
      "Tefal fritieris Principio, 1000 W, melna",
    );
    expect(cleanName("Dreame Air Fryer DZ30-BK Black", "Dreame", "DZ30-BK")).toBe(
      "Dreame Air Fryer DZ30-BK Black",
    );
  });
  it("leaves model codes alone and does not call a code shouting", () => {
    expect(cleanName("Bosch KGN39VLEB ledusskapis", "Bosch", "KGN39VLEB")).toBe(
      "Bosch KGN39VLEB ledusskapis",
    );
    expect(cleanName("Indesit C YSD 83D WW EE", "Indesit", "")).toBe("Indesit C YSD 83D WW EE");
  });
  it("rebuilds a name still too long from brand and model", () => {
    const long =
      "Bosch Serie 6 veļas mašīna ar priekšējo ielādi 9 kg 1400 apgr./min balta ar tvaika funkciju";
    expect(cleanName(long, "Bosch", "WGG2440MSN")).toBe("Bosch WGG2440MSN");
  });
});

describe("names that say nothing alone (docs/SEO_INDEXING_PLAN.md §2B)", () => {
  it("repairs UTF-8 a feed read as Windows-1252, and leaves real text alone", () => {
    expect(repairMojibake("Xiaomi Portable Blender EU biaÅ‚y")).toBe("Xiaomi Portable Blender EU biały");
    expect(repairMojibake("Ä¶Ä«mija")).toBe("Ķīmija");
    expect(repairMojibake("Gorenje Maizes gatavotājs BM910WII")).toBe("Gorenje Maizes gatavotājs BM910WII");
    expect(repairMojibake("Å")).toBe("Å");
  });
  it("turns a bare model code or a bare brand into brand and model", () => {
    expect(cleanName("AF1409DW", "Ariete", "AF1409DW")).toBe("Ariete AF1409DW");
    expect(cleanName("Caso", "CASO", "AF 600")).toBe("Caso AF 600");
    expect(cleanName("Caso", "Caso", "")).toBe("Caso");
    expect(displayName("AF1409DW", "Ariete", "airfryer", "karstā gaisa friteris", "AF1409DW")).toBe(
      "Ariete karstā gaisa friteris AF1409DW",
    );
  });
});

describe("shortName and sameModel", () => {
  it("names a product by brand and model inside a sentence", () => {
    expect(shortName("Dreame Air Fryer AF30-WH White", "DREAME", "AF30-WH")).toBe("Dreame AF30-WH");
    expect(shortName("Tefal fritieris Principio - Friteris", "Tefal", "")).toBe("Tefal fritieris Principio");
  });
  it("treats colour variants as one model, other models as different", () => {
    const pick = { brand: "Dreame", modelCode: "AF30-WH", name: "Dreame Air Fryer AF30-WH White" };
    expect(sameModel(pick, { brand: "DREAME", modelCode: "AF30-BK", name: "x" })).toBe(true);
    expect(sameModel(pick, { brand: "Dreame", modelCode: "", name: "AIR FRYER/AF30 DREAME AF30" })).toBe(
      true,
    );
    expect(sameModel(pick, { brand: "Dreame", modelCode: "DZ30-BK", name: "Dreame DZ30" })).toBe(false);
    expect(sameModel(pick, { brand: "Tristar", modelCode: "AF30", name: "x" })).toBe(false);
    expect(modelStem("FR-9073")).toBe("FR9073");
  });
});
