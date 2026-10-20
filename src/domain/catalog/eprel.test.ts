import { describe, expect, it } from "vitest";
import fixtures from "./__fixtures__/eprel.json";
import { eprelAttributes, normaliseModel, registrationNumber, sameProduct, type EprelRecord } from "./eprel";

// Real EPREL records (fetched 20 Oct 2026): the field names and units below
// are what the API returns, so a mapping mistake shows up here.

const rec = (id: string) => (fixtures.records as Record<string, EprelRecord>)[id]!;

describe("eprelAttributes", () => {
  it("reads a built-in two-door fridge (dimensions in mm)", () => {
    expect(
      eprelAttributes("fridge", "refrigeratingappliances2019", rec("refrigeratingappliances2019-380048")),
    ).toEqual(
      expect.objectContaining({
        energy_class: "E",
        noise_db: 35,
        height_cm: 177.2,
        width_cm: 54.1,
        depth_cm: 54.8,
        kwh_year: 234,
        fridge_volume_l: 184,
        freezer_volume_l: 76,
        volume_l: 260,
        no_frost: true,
        install: "builtin",
      }),
    );
  });

  it("reads a built-in freezer as the freezer form, with its climate class", () => {
    const a = eprelAttributes(
      "freezer",
      "refrigeratingappliances2019",
      rec("refrigeratingappliances2019-1462715"),
    );
    expect(a).toMatchObject({
      form: "builtin",
      volume_l: 212,
      climate_class: "SN-T",
      garage_ok: true,
      height_cm: 177.2,
    });
  });

  it("reads dishwashers (dimensions in cm) and derives kWh a year from the label's 100 cycles", () => {
    const beko = eprelAttributes("dish", "dishwashers2019", rec("dishwashers2019-1063221"));
    expect(beko).toMatchObject({
      energy_class: "E",
      noise_db: 47,
      place_settings: 10,
      width_cm: 45,
      height_cm: 82,
      install: "builtin",
      energy_kwh_100: 76,
      kwh_year: 213,
    });
    expect(eprelAttributes("dish", "dishwashers2019", rec("dishwashers2019-1273558"))).toMatchObject({
      energy_class: "B",
      noise_db: 38,
      place_settings: 14,
      width_cm: 60,
    });
  });

  it("reads a washing machine", () => {
    expect(
      eprelAttributes("washer", "washingmachines2019", rec("washingmachines2019-1232090")),
    ).toMatchObject({
      energy_class: "B",
      capacity_kg: 7,
      spin_rpm: 1151,
      noise_db: 78,
      depth_cm: 44,
      install: "free",
      washer_dryer: false,
      kwh_year: 114,
    });
  });

  it("reads a heat-pump dryer", () => {
    expect(
      eprelAttributes("dryer", "tumbledryers20232534", rec("tumbledryers20232534-2187031")),
    ).toMatchObject({
      energy_class: "C",
      capacity_kg: 8,
      dryer_type: "heatpump",
      noise_db: 64,
    });
  });

  it("returns only attributes the subcategory uses", () => {
    const a = eprelAttributes("dryer", "tumbledryers20232534", rec("tumbledryers20232534-2187031"));
    expect(a.place_settings).toBeUndefined();
    expect(
      Object.keys(eprelAttributes("kettle", "dishwashers2019", rec("dishwashers2019-1063221"))),
    ).not.toContain("place_settings");
  });
});

describe("sameProduct", () => {
  const fridge = rec("refrigeratingappliances2019-380048");
  it("matches brand and model code, ignoring case, spaces and an added article number", () => {
    expect(sameProduct(fridge, { brand: "BOSCH", modelCode: "kin86vfe0" })).toBe(true);
    expect(sameProduct(rec("dishwashers2019-1063221"), { brand: "Beko", modelCode: "BDIS36020" })).toBe(true);
  });
  it("rejects another brand, another model, a too-short code or an unpublished record", () => {
    expect(sameProduct(fridge, { brand: "Siemens", modelCode: "KIN86VFE0" })).toBe(false);
    expect(sameProduct(fridge, { brand: "Bosch", modelCode: "KIN86VFE1" })).toBe(false);
    expect(sameProduct(fridge, { brand: "Bosch", modelCode: "KIN" })).toBe(false);
    expect(sameProduct({ ...fridge, status: "DRAFT" }, { brand: "Bosch", modelCode: "KIN86VFE0" })).toBe(
      false,
    );
  });
});

describe("helpers", () => {
  it("normalise model codes and read the registration number", () => {
    expect(normaliseModel(" KGN39VL-CT ")).toBe("KGN39VLCT");
    expect(registrationNumber(rec("dishwashers2019-1273558"))).toBe("1273558");
  });
});
