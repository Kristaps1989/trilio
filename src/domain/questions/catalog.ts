import raw from "../../../data/categories.json";
import { CatalogSchema, type Catalog, type Group, type Subcategory } from "./schema";

// Parsed once at module load; a malformed file fails fast at startup and in
// the categories.test.ts unit test.
export const catalog: Catalog = CatalogSchema.parse(raw);

const subIndex = new Map<string, { group: Group; sub: Subcategory }>();
for (const group of catalog.groups) {
  for (const sub of group.subcategories) subIndex.set(sub.id, { group, sub });
}

export function getGroup(id: string): Group | undefined {
  return catalog.groups.find((g) => g.id === id);
}

export function getSubcategory(id: string): Subcategory | undefined {
  return subIndex.get(id)?.sub;
}

export function getGroupOfSubcategory(id: string): Group | undefined {
  return subIndex.get(id)?.group;
}

export function allSubcategories(): Subcategory[] {
  return [...subIndex.values()].map((x) => x.sub);
}

/** Local free-text routing from the regex table; the LLM path is used only when this returns null. */
export function detectSubcategory(text: string): string | null {
  const t = text.toLowerCase();
  for (const rule of catalog.free_text_detection) {
    if (new RegExp(rule.regex, "i").test(t)) return rule.subcategory;
  }
  return null;
}
