import brandTable from "../../../data/brands.json";
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
// Windows-1252 code points 0x80–0x9F, for undoing a feed's UTF-8 read as Windows-1252.
const CP1252: Record<string, number> = {
  "€": 0x80,
  "‚": 0x82,
  ƒ: 0x83,
  "„": 0x84,
  "…": 0x85,
  "†": 0x86,
  "‡": 0x87,
  ˆ: 0x88,
  "‰": 0x89,
  Š: 0x8a,
  "‹": 0x8b,
  Œ: 0x8c,
  Ž: 0x8e,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "˜": 0x98,
  "™": 0x99,
  š: 0x9a,
  "›": 0x9b,
  œ: 0x9c,
  ž: 0x9e,
  Ÿ: 0x9f,
};
const MOJIBAKE = /[ÃÄÅÆÐÑ][\u0080-\u00BF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/;

/**
 * "biaÅ‚y" → "biały": UTF-8 that a shop's feed decoded as Windows-1252.
 * Only when the whole string re-encodes to valid UTF-8; anything else is left as it is.
 */
export function repairMojibake(text: string): string {
  if (!MOJIBAKE.test(text)) return text;
  const bytes: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const b = cp <= 0xff ? cp : CP1252[ch];
    if (b === undefined) return text;
    bytes.push(b);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return text;
  }
}

export function cleanName(name: string, brand = "", modelCode = ""): string {
  const original = repairMojibake(name.trim());
  const b0 = brand.trim();
  const code0 = modelCode.trim();
  // A name that is only the brand or only the model code says nothing alone: "Brand Model".
  const bare = original.toLowerCase();
  if (b0 && (bare === b0.toLowerCase() || (code0 && bare === code0.toLowerCase())))
    return code0 ? `${canonicalBrand(b0)} ${code0}` : canonicalBrand(b0);
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
  // The model code as the title writes it ("RK4100"), when the shop's model field has it in lower case.
  const codeAsWritten =
    s.split(/\s+/).find((w) => w.replace(/[^\p{L}\d-]/gu, "").toLowerCase() === code.toLowerCase()) ?? code;
  if (b && code && (shouting || foreignLead || s.length > MAX_NAME_LENGTH)) {
    if (foreignLead && !shouting) {
      const rest = s.slice(at + b.length).trim();
      const rebuilt = `${canonicalBrand(b)} ${rest}`.trim();
      const withCode = rebuilt.toLowerCase().includes(code.toLowerCase())
        ? rebuilt
        : `${rebuilt} ${codeAsWritten}`;
      if (withCode.length <= MAX_NAME_LENGTH) return withCode;
    }
    return `${canonicalBrand(b)} ${codeAsWritten}`;
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

/** Brands the brand table knows (graded or skipped): a title that contains one names its brand. */
const KNOWN_BRANDS: readonly string[] = [
  ...Object.keys((brandTable as { brands?: Record<string, unknown> }).brands ?? {}),
  ...Object.keys((brandTable as { skipped?: Record<string, unknown> }).skipped ?? {}),
];

/** Latvian letters: a word with one is the product type ("Elektriskā tējkanna"), not a brand. */
const LATVIAN = /[āčēģīķļņšūž]/i;

/** True when a stored brand is really the first word of a Latvian product type (an old guess). */
export function brandIsTypeWord(brand: string): boolean {
  return LATVIAN.test(brand);
}

/**
 * The brand when the shop gives none (m79.lv's product data has no brand):
 * a known brand in the title; else the capitalised word just before the
 * model code ("Elektriskā tējkanna Concept RK4100" → "Concept"); else the
 * first capitalised word that is not Latvian; else the first word.
 */
export function brandFromTitle(
  title: string,
  modelCode = "",
  known: readonly string[] = KNOWN_BRANDS,
): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const bare = (w: string) => w.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, "");
  for (const w of words) {
    const hit = known.find((k) => k.toLowerCase() === bare(w).toLowerCase());
    if (hit) return hit;
  }
  const looksLikeBrand = (w: string) =>
    /^\p{Lu}/u.test(w) && !LATVIAN.test(w) && !/\d/.test(w) && w.length >= 2;
  const code = modelCode.trim().toLowerCase();
  if (code) {
    const at = words.findIndex((w) => bare(w).toLowerCase() === code);
    if (at > 0 && looksLikeBrand(bare(words[at - 1]!))) return bare(words[at - 1]!);
  }
  const first = words.map(bare).find(looksLikeBrand);
  return first ?? bare(words[0]!);
}
