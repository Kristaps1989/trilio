import { describe, expect, it } from "vitest";
import fixtures from "@/services/ingestion/specs/__fixtures__/pages.json";
import {
  excludedByName,
  mergeAttributes,
  normaliseProduct,
  parseEnergyClass,
  parseQuantity,
  sanityCheck,
} from "./normalise";

type Page = {
  id: string;
  subcategory: string;
  name: string;
  description: string | null;
  url: string;
  priceCents: number;
  specTable: Record<string, string>;
};
const pages = fixtures.products as unknown as Page[];
const page = (id: string) => pages.find((p) => p.id === id)!;
const norm = (p: Page) =>
  normaliseProduct(p.subcategory, {
    name: p.name,
    category: decodeURIComponent(p.url).toLowerCase(),
    description: p.description,
    specTable: p.specTable,
  });

describe("parseQuantity", () => {
  it.each([
    ["185,5 cm", "cm", 185.5],
    ["840 mm", "cm", 84],
    ["1 855 mm", "cm", 185.5],
    ["344 l", "l", 344],
    ["1,2 kW", "w", 1200],
    ["8kg", "kg", 8],
    ["1200apgr./ min", "rpm", 1200],
    ["Ražotājs informāciju nav norādījis l", "l", null],
    ["9000 cm", "cm", null],
  ])("%s (%s) → %s", (value, unit, expected) => {
    expect(parseQuantity(value, unit)).toBe(expected);
  });
  it("takes the largest value of a range when asked", () => {
    expect(parseQuantity("108 - 162 m³/h", "m3h", "max")).toBe(162);
    expect(parseQuantity("49 līdz 58 dB", "db", "max")).toBe(58);
  });
});

describe("parseEnergyClass", () => {
  it("accepts the 2021 A–G scale only", () => {
    expect(parseEnergyClass("E")).toBe("E");
    expect(parseEnergyClass("C ")).toBe("C");
    expect(parseEnergyClass("A+++")).toBeNull();
  });
});

describe("normaliseProduct on real shop pages", () => {
  it("euronics fridge: size, volume, energy and form from the spec table", () => {
    const n = norm(page("euronics-fridge"));
    expect(n.attributes).toMatchObject({
      height_cm: 143.6,
      width_cm: 55,
      volume_l: 206,
      energy_class: "E",
      form: "combi",
    });
    expect(n.sources.height_cm).toBe("spec_table");
  });
  it("tet fridge: model-only name still gets its form and size", () => {
    expect(norm(page("tet-fridge")).attributes).toMatchObject({
      height_cm: 177,
      form: "combi",
      energy_class: "E",
    });
  });
  it("m79 fridge: total volume label, top freezer → combi", () => {
    const n = norm(page("m79-fridge"));
    expect(n.attributes).toMatchObject({ volume_l: 119, freezer_volume_l: 14, form: "combi" });
  });
  it("adds fridge + freezer volume when no total is given", () => {
    const n = normaliseProduct("fridge", {
      name: "X",
      specTable: { "ledusskapja tilpums": "230 l", "saldētavas tilpums": "114 l", augstums: "185 cm" },
    });
    expect(n.attributes.volume_l).toBe(344);
  });
  it("m79 washer without a spec block: reads 'Label value' segments of the name", () => {
    expect(norm(page("m79-washer")).attributes).toMatchObject({
      loading: "front",
      capacity_kg: 7,
      depth_cm: 54,
    });
  });
  it("tet washer: front loading, capacity, depth and per-100-cycles energy converted to a year", () => {
    expect(norm(page("tet-washer")).attributes).toMatchObject({
      loading: "front",
      capacity_kg: 8,
      depth_cm: 47.5,
      energy_kwh_100: 42,
      kwh_year: 92,
      washer_dryer: false,
    });
  });
  it("tet dishwasher: free-standing, 15 place settings, third basket, auto-open", () => {
    expect(norm(page("tet-dish")).attributes).toMatchObject({
      install: "free",
      place_settings: 15,
      third_basket: true,
      auto_open: true,
    });
  });
  it("m79 dishwasher: built-in from the placement row", () => {
    expect(norm(page("m79-dish")).attributes).toMatchObject({ install: "builtin", integration: "full" });
  });
  it("tet cooker with an oven is a cooker, not a hob", () => {
    expect(norm(page("tet-hob")).attributes.hob_type).toBe("cooker");
  });
  it("coffee machines: grinder means automatic even when a drip tray is mentioned", () => {
    expect(norm(page("tet-coffee")).attributes.coffee_type).toBe("auto");
    expect(norm(page("m79-coffee")).attributes).toMatchObject({ coffee_type: "auto", tank_l: 1.5 });
  });
  it("freezer: an 85 cm cabinet freezer is upright and garage-capable from its climate class", () => {
    expect(norm(page("euronics-freezer")).attributes).toMatchObject({
      form: "upright",
      garage_ok: true,
      volume_l: 107,
    });
  });
  it("hood: airflow takes the top of the range", () => {
    expect(norm(page("m79-hood")).attributes).toMatchObject({
      airflow_m3h: 352,
      recirculation: true,
      hood_type: "builtin",
    });
  });
  it("every fixture of a main category gets its type", () => {
    const typed: Record<string, string> = {
      fridge: "form",
      freezer: "form",
      washer: "loading",
      dryer: "dryer_type",
      hob: "hob_type",
      hood: "hood_type",
      micro: "install",
      vacuum: "vacuum_type",
      coffee: "coffee_type",
    };
    for (const p of pages) {
      const key = typed[p.subcategory];
      if (!key || !sanityCheck(p.subcategory, p, p.priceCents, norm(p)).ok) continue;
      expect(norm(p).attributes[key], `${p.id} ${key}`).toBeDefined();
    }
  });
});

describe("sanityCheck", () => {
  it("rejects a product filed under a category it does not belong to (m79 baby food maker under food processors)", () => {
    const p = page("m79-foodproc");
    expect(sanityCheck(p.subcategory, p, p.priceCents, norm(p))).toEqual({
      ok: false,
      reason: "category_mismatch",
    });
  });
  it("rejects an implausible price for the category (a €40 mini oven filed under ovens)", () => {
    const p = page("m79-oven");
    expect(sanityCheck(p.subcategory, p, p.priceCents, norm(p)).ok).toBe(false);
  });
  it("accepts a model-only name when the spec table has category-specific attributes (tet)", () => {
    const p = page("tet-vacuumsealer");
    expect(sanityCheck(p.subcategory, p, p.priceCents, norm(p)).ok).toBe(true);
  });
  it("rejects accessories by name", () => {
    expect(
      sanityCheck("dehydrator", { name: "Ezidri Snackmaker FD500, 2 gab. - Starpgrīdas" }, 2000).ok,
    ).toBe(false);
    expect(sanityCheck("coffee", { name: "LeanToys magnētiskā tāfele ar 2 magnētiem" }, 1250).ok).toBe(false);
  });
});

describe("mergeAttributes", () => {
  it("fills gaps from another shop, keeps equal-strength values, lets stronger sources win", () => {
    const merged = mergeAttributes(
      {
        attributes: { height_cm: 185, volume_l: 300 },
        sources: { height_cm: "spec_table", volume_l: "claude" },
      },
      {
        attributes: { height_cm: 186, volume_l: 310, noise_db: 35 },
        sources: { height_cm: "spec_table", volume_l: "eprel", noise_db: "spec_table" },
      },
    );
    expect(merged.attributes).toEqual({ height_cm: 185, volume_l: 310, noise_db: 35 });
    expect(merged.sources).toEqual({ height_cm: "spec_table", volume_l: "eprel", noise_db: "spec_table" });
  });
});

describe("excludedByName", () => {
  // Names as shown on trilio.lv on 23 Oct 2026.
  it("keeps replacement plates out of sandwich toasters, but not the toaster itself", () => {
    expect(excludedByName("sandwich", "Tefal Snack Collection - Maināmās vafeļu plāksnes")).toBe("accessory");
    expect(
      excludedByName("sandwich", "Tefal Snack Collection - Maināmās sendviču plāksnes kontakttosterim"),
    ).toBe("accessory");
    expect(
      excludedByName("sandwich", "Tefal Snack Colletion, 700 W, melna - Kontakttosteris/vafeļu panna"),
    ).toBeNull();
    expect(excludedByName("sandwich", "Tefal Snack Collection - Maināmā vafeļu plāksne")).toBe("accessory");
    expect(excludedByName("sandwich", "Tefal Snack Collection - Maināmās plāno vafeļu plāksnes")).toBe(
      "accessory",
    );
    expect(
      excludedByName("sandwich", "Stollar the Morning Press, 800 W - Kontakttosteris trīs vienā"),
    ).toBeNull();
    expect(excludedByName("grill", "Kontaktgrils ar maināmām plāksnēm")).toBeNull();
  });

  it("keeps hand blenders and pizza ovens out of the categories shops file them under", () => {
    expect(excludedByName("blender", "Bosch CleverMixx MSM14100")).toBe("category_mismatch");
    expect(
      excludedByName("blender", "Bosch MSM6B100 blenderis 0 L iegremdējamais blenderis 280 W balts"),
    ).toBe("category_mismatch");
    expect(excludedByName("blender", "Blendtec Designer 725, 1800 W, 2.7 L - Blenderis")).toBeNull();
    expect(excludedByName("handblender", "Bosch CleverMixx MSM14100")).toBeNull();
    expect(excludedByName("grill", "Ninja Woodfire, sarkana - Elektriskā āra picas krāsns")).toBe(
      "category_mismatch",
    );
    expect(excludedByName("grill", "Bosch TCG4104 kontakta grils")).toBeNull();
  });

  it("keeps the other accessories and look-alikes seen on trilio.lv out", () => {
    for (const [sub, name] of [
      ["airfryer", "Philips HD9925/01 Cepšanas komplekts"],
      ["airfryer", "Philips HD9953/00 Picas gatavošanas komplekts"],
      ["dehydrator", "Ezidri Snackmaker FD500, 2 gab. - Starpgredzens augļu žāvētājam"],
      ["dehydrator", "Ezidri Snackmaker FD500, 4 gab. - Cietā loksne augļu žāvētājam"],
      ["vacuumsealer", "Vakuuma blīvēšanas ruļļi, standarta, 3 gab., 20x300"],
      ["dryer", "Elektriskais dvieļu žāvētājs Navin Stugna 480*800 Sensors kreisais balts"],
    ])
      expect(excludedByName(sub!, name!), name).not.toBeNull();
    for (const [sub, name] of [
      ["airfryer", "Bosch Serie 4 MAF462B1 taukvāres katls 6,1 L 2050 W Karstā gaisa fritētājs"],
      ["dehydrator", "Sencor SFD 6500WH"],
      ["vacuumsealer", "Gorenje VS120ES vakuuma aparāts 800 milibāri Pelēks"],
      ["dryer", "LG, siltumsūkņa tehnoloģija, 9 kg, dziļums 66 cm - Veļas žāvētājs"],
    ])
      expect(excludedByName(sub!, name!), name).toBeNull();
  });
});
