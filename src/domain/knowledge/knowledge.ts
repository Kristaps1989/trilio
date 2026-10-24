import { z } from "zod";
import raw from "../../../data/knowledge.json";

// Category knowledge (docs/CONFIDENCE_PLAN.md C1): which attributes decide
// whether a shopper is happy a year after buying, a plain-language line per
// feature, and the common regrets tied to an attribute. Claude drafts it,
// the owner reviews it. It only explains: every number on a card still comes
// from the product data. Pure data + zod; no UI imports.

const Text = z.object({ lv: z.string().min(1), en: z.string().min(1) }).strict();

const SubcategoryKnowledgeSchema = z
  .object({
    lifeYears: z.number().int().min(1).max(30),
    /** The attributes that matter most in daily use, most important first. */
    decides: z.array(z.object({ attr: z.string().min(1), why: Text }).strict()),
    /** A regret the data can confirm: the attribute has this value on the product. */
    watchOut: z.array(
      z
        .object({ attr: z.string().min(1), eq: z.union([z.boolean(), z.string(), z.number()]), text: Text })
        .strict(),
    ),
    /** Verdict phrases per flow question: "{answer} cilvēkiem {value} ir īstais izmērs". */
    answerPhrases: z.record(z.string(), Text),
  })
  .strict();

export const KnowledgeSchema = z
  .object({
    note: z.string().optional(),
    reviewed: z.boolean(),
    glossary: z.record(z.string(), Text),
    subcategories: z.record(z.string(), SubcategoryKnowledgeSchema),
  })
  .strict();

export type Knowledge = z.infer<typeof KnowledgeSchema>;
export type SubcategoryKnowledge = z.infer<typeof SubcategoryKnowledgeSchema>;
export type Lang = "lv" | "en";

export const knowledge: Knowledge = KnowledgeSchema.parse(raw);

const EMPTY: SubcategoryKnowledge = { lifeYears: 5, decides: [], watchOut: [], answerPhrases: {} };

/** The subcategory's knowledge; empty until the file is reviewed. */
export function knowledgeOf(subcategoryId: string, table: Knowledge = knowledge): SubcategoryKnowledge {
  if (!table.reviewed) return EMPTY;
  return table.subcategories[subcategoryId] ?? EMPTY;
}

/** The attributes that decide satisfaction, most important first. */
export function decidingAttrs(subcategoryId: string, table: Knowledge = knowledge): string[] {
  return knowledgeOf(subcategoryId, table).decides.map((d) => d.attr);
}

/** One plain-language line for a feature, or null. */
export function glossaryLine(attr: string, lang: Lang, table: Knowledge = knowledge): string | null {
  return table.glossary[attr]?.[lang] ?? null;
}

/** The category's regrets that this product's data confirms, in the page's language (§3 C4). */
export function watchOutFor(
  p: { attributes: Record<string, unknown> },
  subcategoryId: string,
  lang: Lang,
  table: Knowledge = knowledge,
): string[] {
  return knowledgeOf(subcategoryId, table)
    .watchOut.filter((w) => p.attributes[w.attr] === w.eq)
    .map((w) => w.text[lang]);
}
