import { subcategoryAttrs } from "./attributes";

// Card titles must say what the product is (docs/FILTERS_PLAN.md §2.8):
// tet.lv lists "Indesit C YSD 83D WW EE" with no product type. When the
// name does not contain one of the category's own words, the type is put
// after the brand: "Indesit veļas žāvētājs C YSD 83D WW EE".

/** True when the shop's name already says what the product is. */
export function nameHasType(name: string, subcategoryId: string): boolean {
  const stems = subcategoryAttrs(subcategoryId)?.sanity.stems ?? [];
  return stems.some((s) => new RegExp(s, "i").test(name));
}

/** Longer than this, a cleaned name gives way to "{Brand} {type} {model}". */
export const MAX_NAME_LENGTH = 48;

const capitalise = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

/**
 * The shop's title without feed noise (docs/TRUST_POLISH_PLAN.md §3): the
 * spec tail after " | ", an EAN in brackets, a trailing " - Friteris" type
 * repeat, a doubled word ("Tristar Tristar") and shouting ("DREAME" →
 * "Dreame"; codes with digits stay as written). A name that is still long,
 * mostly capitals, or starts with words in another language before the
 * brand is rebuilt from the brand and the model code. Display only; the
 * stored name is never changed.
 */
export function cleanName(name: string, brand = "", modelCode = ""): string {
  const original = name.trim();
  let s = original
    .split(/\s+\|\s+/)[0]!
    .replace(/\s*\(\s*\d{8,14}\s*\)/g, "")
    .replace(/\s+[-–]\s+[^\d\s,]+(?:\s[^\d\s,]+)?$/u, "")
    .replace(/[\s,;|–-]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  s = s
    .split(" ")
    .filter((w, i, all) => i === 0 || w.length < 3 || w.toLowerCase() !== all[i - 1]!.toLowerCase())
    .join(" ");
  // Shouting is judged on words without digits: "Bosch KGN39VLEB" is a code, "DREAME" is shouting.
  const letters = original
    .split(/[\s/|,()]+/)
    .filter((w) => !/\d/.test(w))
    .join("")
    .replace(/[^\p{L}]/gu, "");
  const shouting = letters.length >= 6 && letters.replace(/[^\p{Lu}]/gu, "").length / letters.length > 0.7;
  s = s.replace(/\S+/g, (w) =>
    w.length > 3 &&
    !/\d/.test(w) &&
    /\p{L}/u.test(w) &&
    w === w.toUpperCase() &&
    (shouting || w.toLowerCase() === brand.trim().toLowerCase())
      ? capitalise(w)
      : w,
  );

  const b = brand.trim();
  const code = modelCode.trim();
  const at = b ? s.toLowerCase().indexOf(b.toLowerCase()) : -1;
  // Words before the brand that are not the category's Latvian type word: "Frytkownica beztłuszczowa Tristar …".
  const foreignLead =
    at > 0 && !/[āčēģīķļņšūž]/iu.test(s.slice(0, at)) && /[^\x00-\x7F]/u.test(s.slice(0, at));
  if (b && code && (shouting || foreignLead || s.length > MAX_NAME_LENGTH)) {
    if (foreignLead && !shouting) {
      const rest = s.slice(at + b.length).trim();
      const rebuilt = `${canonicalBrand(b)} ${rest}`.trim();
      const withCode = rebuilt.toLowerCase().includes(code.toLowerCase()) ? rebuilt : `${rebuilt} ${code}`;
      if (withCode.length <= MAX_NAME_LENGTH) return withCode;
    }
    return `${canonicalBrand(b)} ${code}`;
  }
  return s;
}

/** "Dreame AF30-WH": brand and model code, for naming a product inside a sentence. */
export function shortName(name: string, brand: string, modelCode: string): string {
  const code = modelCode.trim();
  if (brand && code) return `${canonicalBrand(brand)} ${code}`;
  return cleanName(name, brand, modelCode);
}

/** The model code without a trailing colour or finish suffix: "AF30-WH" and "AF30" are one model. */
export function modelStem(modelCode: string): string {
  return modelCode
    .toUpperCase()
    .replace(/[-\s/]+[A-Z]{1,3}$/, "")
    .replace(/[^A-Z0-9]/g, "");
}

/** True when two products are colour or finish variants of one model. */
export function sameModel(
  a: { brand: string; modelCode: string; name: string },
  b: { brand: string; modelCode: string; name: string },
): boolean {
  if (a.brand.trim().toLowerCase() !== b.brand.trim().toLowerCase()) return false;
  if (a.modelCode && b.modelCode) {
    const sa = modelStem(a.modelCode);
    const sb = modelStem(b.modelCode);
    if (sa && sb && sa === sb) return true;
  }
  // A model code written into the other's name: "AIR FRYER/AF30 DREAME AF30" and model "AF30-WH".
  const words = (n: string) =>
    new Set(
      n
        .toUpperCase()
        .split(/[^A-Z0-9]+/)
        .filter((w) => /\d/.test(w)),
    );
  const stemA = a.modelCode ? modelStem(a.modelCode) : "";
  const stemB = b.modelCode ? modelStem(b.modelCode) : "";
  return (!!stemA && words(b.name).has(stemA)) || (!!stemB && words(a.name).has(stemB));
}

/** The display name: the cleaned shop name, with the type label inserted after the brand when missing. */
export function displayName(
  rawName: string,
  brand: string,
  subcategoryId: string,
  typeLabel: string,
  modelCode = "",
): string {
  const name = cleanName(rawName, brand, modelCode);
  if (!typeLabel || nameHasType(name, subcategoryId)) return name;
  const trimmed = name.trim();
  if (brand && trimmed.toLowerCase().startsWith(brand.toLowerCase() + " ")) {
    return `${trimmed.slice(0, brand.length)} ${typeLabel} ${trimmed.slice(brand.length + 1)}`;
  }
  return brand ? `${brand} ${typeLabel} ${trimmed}` : `${typeLabel} ${trimmed}`;
}

/**
 * One spelling per brand for display: shops write "SAMSUNG", "Samsung" or
 * "samsung". Known brands use the spelling of the brand table; others are
 * title-cased unless they are a short acronym such as LG or AEG.
 */
export function canonicalBrand(raw: string, known: readonly string[] = []): string {
  const trimmed = raw.trim();
  const hit = known.find((k) => k.toLowerCase() === trimmed.toLowerCase());
  if (hit) return hit;
  if (trimmed.length <= 3) return trimmed.toUpperCase();
  if (trimmed === trimmed.toUpperCase() || trimmed === trimmed.toLowerCase())
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  return trimmed;
}
