import raw from "../../../data/categories.json";
import rawEn from "../../../data/categories.en.json";
import {
  CatalogSchema,
  type Catalog,
  type Group,
  type Option,
  type Question,
  type Subcategory,
} from "./schema";
import { CatalogTextSchema, type CatalogText } from "./text-schema";

// Parsed once at module load; a malformed file fails fast at startup and in
// the categories.test.ts unit test.
export const catalog: Catalog = CatalogSchema.parse(raw);

/**
 * Languages the catalog text exists in. "lv" is categories.json itself;
 * "en" overlays data/categories.en.json (docs/ENGLISH_AND_ACCESSIBILITY_PLAN.md
 * §4.4). Only text changes: ids, rules and budgets are the same in every
 * language, so answers and saved searches work across languages.
 */
export type CatalogLang = "lv" | "en";

export const catalogText: CatalogText = CatalogTextSchema.parse(rawEn);

type TextOf<T> = Partial<Record<keyof T, string>>;
const pick = <T extends object>(base: T, over: TextOf<T> | undefined): T => {
  if (!over) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over))
    if (typeof v === "string" && v) (out as Record<string, unknown>)[k] = v;
  return out;
};

function translate(base: Catalog, text: CatalogText): Catalog {
  return {
    ...base,
    groups: base.groups.map((g) => ({
      ...pick(g, text.groups[g.id]),
      subcategories: g.subcategories.map((s) => {
        const st = text.subcategories[s.id];
        return {
          ...pick(s, st && { label: st.label, description: st.description }),
          questions: s.questions.map((q): Question => {
            const qt = st?.questions?.[q.id];
            return {
              ...pick(q, qt && { title: qt.title, why: qt.why, help: qt.help }),
              options: q.options.map((o): Option => pick(o, qt?.options?.[o.value])),
            };
          }),
        };
      }),
    })),
  };
}

const catalogs: Record<CatalogLang, Catalog> = { lv: catalog, en: translate(catalog, catalogText) };

type Index = Map<string, { group: Group; sub: Subcategory }>;
const indexes = {} as Record<CatalogLang, Index>;
for (const lang of Object.keys(catalogs) as CatalogLang[]) {
  const index: Index = new Map();
  for (const group of catalogs[lang].groups) {
    for (const sub of group.subcategories) index.set(sub.id, { group, sub });
  }
  indexes[lang] = index;
}

/** The catalog with its text in a language. */
export function catalogIn(lang: CatalogLang = "lv"): Catalog {
  return catalogs[lang];
}

export function getGroup(id: string, lang: CatalogLang = "lv"): Group | undefined {
  return catalogs[lang].groups.find((g) => g.id === id);
}

export function getSubcategory(id: string, lang: CatalogLang = "lv"): Subcategory | undefined {
  return indexes[lang].get(id)?.sub;
}

export function getGroupOfSubcategory(id: string, lang: CatalogLang = "lv"): Group | undefined {
  return indexes[lang].get(id)?.group;
}

export function allSubcategories(lang: CatalogLang = "lv"): Subcategory[] {
  return [...indexes[lang].values()].map((x) => x.sub);
}

/** Local free-text routing from the regex table; the LLM path is used only when this returns null. */
export function detectSubcategory(text: string): string | null {
  const t = text.toLowerCase();
  for (const rule of catalog.free_text_detection) {
    if (new RegExp(rule.regex, "i").test(t)) return rule.subcategory;
  }
  return null;
}
