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

/** The display name: the shop's name, with the type label inserted after the brand when missing. */
export function displayName(name: string, brand: string, subcategoryId: string, typeLabel: string): string {
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
