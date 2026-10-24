import { subcategoryAttrs } from "./attributes";

// EPREL, the EU energy-label database (eprel.ec.europa.eu): the strongest
// source for the facts a label states (docs/ATTRIBUTES.md, source priority 6).
// Pure: the job fetches records; this module decides which EPREL product
// groups a subcategory belongs to, whether a record is the same product, and
// what it says in our attribute vocabulary. Field names were taken from real
// records (src/domain/catalog/__fixtures__/eprel.json).

export type EprelRecord = Record<string, unknown>;

/** EPREL product groups (the API's url_code) per subcategory, newest regulation first. */
export const EPREL_GROUPS: Record<string, string[]> = {
  fridge: ["refrigeratingappliances2019", "refrigeratingappliances"],
  freezer: ["refrigeratingappliances2019", "refrigeratingappliances"],
  washer: ["washingmachines2019", "washerdriers2019", "washingmachines", "washerdriers"],
  dryer: ["tumbledryers20232534", "tumbledriers"],
  dish: ["dishwashers2019", "dishwashers"],
  oven: ["ovens"],
  hood: ["rangehoods"],
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const first = (...vs: unknown[]): number | null => {
  for (const v of vs) {
    const n = num(v);
    if (n !== null) return n;
  }
  return null;
};

/** Letters and digits only, upper case: "KGN39VL-CT " and "kgn39vlct" are the same model. */
export function normaliseModel(model: string): string {
  return model.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * True when an EPREL record is the shop's product: a published, verified
 * record of the same brand whose model identifier is the shop's model code
 * (suppliers sometimes add a suffix such as an article number: "BDIS36020 7657503935").
 */
export function sameProduct(record: EprelRecord, product: { brand: string; modelCode: string }): boolean {
  if (record.status !== undefined && record.status !== "PUBLISHED") return false;
  if (record.blocked === true) return false;
  const brand = str(record.supplierOrTrademark) ?? str(record.brandName);
  const model = str(record.modelIdentifier);
  if (!brand || !model) return false;
  const b1 = normaliseModel(brand);
  const b2 = normaliseModel(product.brand);
  if (!b1 || !b2 || !(b1.includes(b2) || b2.includes(b1))) return false;
  const m1 = normaliseModel(model);
  const m2 = normaliseModel(product.modelCode);
  if (m2.length < 4) return false;
  return m1 === m2 || m1.startsWith(m2) || m2.startsWith(m1);
}

/** Centimetres from an EPREL dimension: refrigerating appliances state mm, the other groups cm. */
function cm(value: unknown, group: string): number | null {
  const n = num(value);
  if (n === null || n <= 0) return null;
  const mm = group.startsWith("refrigerating") || n > 300;
  return Math.round((mm ? n / 10 : n) * 10) / 10;
}

function climateClass(r: EprelRecord): string | null {
  const classes = ["SN", "N", "ST", "T"].filter((c) => r[`climateClass${c}`] === true);
  return classes.length ? classes.join("-") : null;
}

/** All freezer compartments defrost automatically (EPREL defrostingType "A"): No Frost. */
function noFrost(r: EprelRecord): boolean | null {
  const compartments = Array.isArray(r.compartments) ? (r.compartments as EprelRecord[]) : [];
  const freezers = compartments.filter((c) => c.type === "FREEZER");
  if (freezers.length === 0) return null;
  if (freezers.every((c) => c.defrostingType === "A")) return true;
  if (freezers.some((c) => c.defrostingType === "M")) return false;
  return null;
}

const DRYER_TYPE: Record<string, string> = {
  ELECTRIC_HEAT_PUMP_CONDENSER: "heatpump",
  ELECTRIC_CONDENSER: "condenser",
  ELECTRIC_AIR_VENTED: "vented",
  GAS_FIRED_AIR_VENTED: "vented",
};

/** The year of an EPREL date ([2021, 9, 1] or "2021-09-01"), or null. */
function marketYear(v: unknown): number | null {
  const y = Array.isArray(v) ? num(v[0]) : typeof v === "string" ? Number(v.slice(0, 4)) : null;
  return y !== null && Number.isInteger(y) && y >= 2005 && y <= 2035 ? y : null;
}

/**
 * What the record says, as our attributes for this subcategory. Only
 * attributes the subcategory uses are returned, and only stated values: a
 * missing field is left for the other sources.
 */
export function eprelAttributes(
  subcategoryId: string,
  group: string,
  r: EprelRecord,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const put = (key: string, value: unknown) => {
    if (value !== null && value !== undefined) out[key] = value;
  };

  const energy = str(r.energyClass);
  if (energy && /^[A-G]$/.test(energy)) put("energy_class", energy);
  put("noise_db", num(r.noise));
  put("height_cm", cm(r.dimensionHeight, group));
  put("width_cm", cm(r.dimensionWidth, group));
  put("depth_cm", cm(r.dimensionDepth, group));
  // Every label group: the model's market dates, the noise class and the supplier's guarantee.
  put("model_year", marketYear(r.onMarketFirstStartDate) ?? marketYear(r.onMarketStartDate));
  if (marketYear(r.onMarketEndDate) !== null) put("discontinued", true);
  const nc = str(r.noiseClass);
  if (nc && /^[A-D]$/.test(nc)) put("noise_class", nc);
  // Months; the 2023 dryer regulation's records spell the field "guranteeDuration".
  const guarantee = first(r.guaranteeDuration, r.guranteeDuration);
  if (guarantee !== null && guarantee >= 6 && guarantee <= 360) put("warranty_months", guarantee);
  const repair = str(r.repairabilityClass);
  if (repair && /^[A-E]$/.test(repair)) put("repairability", repair);
  const builtIn = r.designType === "BUILT_IN" || r.type === "BUILT_IN";
  const freeStanding = r.designType === "FREESTANDING" || r.type === "FREE_STANDING";

  if (group.startsWith("refrigerating")) {
    put("kwh_year", first(r.energyConsAnnualV2, r.consolidatedEnergyConsAnnual, r.energyConsAnnual));
    put("fridge_volume_l", num(r.capRefrNet));
    put("freezer_volume_l", num(r.capFreezeNet));
    put(
      "volume_l",
      subcategoryId === "freezer" ? first(r.capFreezeNet, r.totalVolume) : first(r.totalVolume, r.capRefrNet),
    );
    put("climate_class", climateClass(r));
    if (/SN/.test(climateClass(r) ?? "")) put("garage_ok", true);
    put("no_frost", noFrost(r));
    if (builtIn) put(subcategoryId === "freezer" ? "form" : "install", "builtin");
    else if (freeStanding && subcategoryId === "fridge") put("install", "free");
  } else if (group.startsWith("washingmachines") || group.startsWith("washerdriers")) {
    put("capacity_kg", num(r.ratedCapacity) ?? num(r.ratedCapacityWash));
    put("spin_rpm", first(r.spinSpeedRated, r.maxSpinSpeed));
    put("energy_kwh_100", first(r.energyConsPer100Cycle, r.energyConsPer100CycleWash));
    put("water_l_cycle", num(r.waterCons) ?? num(r.waterConsWash));
    put("programme_min", num(r.programmeDurationRated));
    put("moisture_pct", first(r.moistureRated, r.moisture));
    put("washer_dryer", group.startsWith("washerdriers"));
    if (builtIn) put("install", "builtin");
    else if (freeStanding) put("install", "free");
  } else if (group.startsWith("tumbledr")) {
    put("capacity_kg", num(r.ratedCapacity));
    const tech = str(r.technology);
    if (tech && DRYER_TYPE[tech]) put("dryer_type", DRYER_TYPE[tech]);
    put("programme_min", first(r.programDurationRated, r.programmeDurationRated));
    const cond = str(r.condensationEfficiencyClass);
    if (cond && /^[A-D]$/.test(cond)) put("condensation_cls", cond);
  } else if (group.startsWith("dishwashers")) {
    put("place_settings", num(r.ratedCapacity));
    put("energy_kwh_100", first(r.energyCons100, r.energyConsPer100Cycle));
    put("water_l_cycle", num(r.waterCons));
    put("programme_min", first(r.programmeDuration, r.programmeDurationRated));
    const h = cm(r.dimensionHeight, group);
    if (builtIn) put("install", "builtin");
    else if (h !== null && h <= 60) put("install", "tabletop");
    else if (freeStanding) put("install", "free");
  } else if (group === "ovens") {
    const cavities = Array.isArray(r.cavities) ? (r.cavities as EprelRecord[]) : [];
    put("volume_l", first(r.volume, ...cavities.map((c) => c.volume)));
  } else if (group === "rangehoods") {
    put("airflow_m3h", first(r.maxAirFlow, r.airFlowMax, r.fluidDynamicEfficiencyAirflow));
  }

  // Derived like the shop path (normalise.ts): a year is 220 washing or 280 dishwashing cycles.
  if (typeof out.energy_kwh_100 === "number" && out.kwh_year === undefined) {
    if (subcategoryId === "washer") out.kwh_year = Math.round(out.energy_kwh_100 * 2.2);
    if (subcategoryId === "dish") out.kwh_year = Math.round(out.energy_kwh_100 * 2.8);
  }

  // Keep what this subcategory uses (plus the physical facts every row may carry).
  const sub = subcategoryAttrs(subcategoryId);
  const keep = new Set([
    ...(sub?.key ?? []),
    ...Object.keys(sub?.enums ?? {}),
    "height_cm",
    "width_cm",
    "depth_cm",
    "kwh_year",
    "energy_kwh_100",
    "fridge_volume_l",
    "freezer_volume_l",
  ]);
  return Object.fromEntries(Object.entries(out).filter(([k]) => keep.has(k)));
}

/** The registration number, for the product's EPREL link. */
export function registrationNumber(r: EprelRecord): string | null {
  const n = r.eprelRegistrationNumber ?? r.registrationNumber;
  return typeof n === "string" || typeof n === "number" ? String(n) : null;
}
