import { z } from "zod";

// The shape of a translation of data/categories.json (data/categories.en.json):
// only the text fields, keyed by ids. Unknown ids are caught by
// catalog.test.ts, so a renamed question cannot leave a stale translation.

const text = z.string().min(1).optional();

export const OptionTextSchema = z
  .object({ label: text, sublabel: text, card_reason: text, table_value: text })
  .strict();

export const QuestionTextSchema = z
  .object({
    title: text,
    why: text,
    help: text,
    options: z.record(z.string(), OptionTextSchema).optional(),
  })
  .strict();

export const SubcategoryTextSchema = z
  .object({
    label: text,
    description: text,
    questions: z.record(z.string(), QuestionTextSchema).optional(),
  })
  .strict();

export const CatalogTextSchema = z
  .object({
    note: z.string().optional(),
    groups: z.record(z.string(), z.object({ label: text }).strict()),
    subcategories: z.record(z.string(), SubcategoryTextSchema),
  })
  .strict();

export type CatalogText = z.infer<typeof CatalogTextSchema>;
