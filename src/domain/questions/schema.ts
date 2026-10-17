import { z } from "zod";

// Zod schema for data/categories.json. See docs/QUESTION_SCHEMA.md.
// This file has no UI or DB imports: it is shared by the engine, the seed
// script, the server actions and the validation test.

const nullableString = z.string().nullable().optional();

export const OptionSchema = z
  .object({
    value: z.string().min(1),
    label: z.string().min(1),
    sublabel: nullableString,
    card_reason: nullableString,
    table_value: nullableString,
    passthrough: z.boolean().optional(),
    exclusive: z.boolean().optional(),
    implies: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const ShowIfSchema = z.union([
  z.object({ q: z.string().min(1), in: z.array(z.string()).min(1) }).strict(),
  z.object({ q: z.string().min(1), notIn: z.array(z.string()).min(1) }).strict(),
]);

export const NumberInputSchema = z
  .object({
    min: z.number(),
    max: z.number(),
    default: z.number(),
    unit: z.string(),
    step: z.number().positive().default(1),
  })
  .strict();

export const QuestionSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    why: nullableString,
    type: z.enum(["single", "multi", "number"]).default("single"),
    max_select: z.number().int().min(1).optional(),
    hard_filter: z.boolean(),
    showIf: ShowIfSchema.optional(),
    help: z.string().optional(),
    input: NumberInputSchema.optional(),
    options: z.array(OptionSchema),
  })
  .strict()
  .superRefine((q, ctx) => {
    const values = q.options.map((o) => o.value);
    if (new Set(values).size !== values.length) {
      ctx.addIssue({ code: "custom", message: `duplicate option values in ${q.id}` });
    }
    if (q.type === "number") {
      if (!q.input) ctx.addIssue({ code: "custom", message: `${q.id}: number question needs input` });
      if (q.options.length) ctx.addIssue({ code: "custom", message: `${q.id}: number question has options` });
    } else if (q.options.length < 2) {
      ctx.addIssue({ code: "custom", message: `${q.id}: needs at least two options` });
    }
    if (q.type === "multi" && !q.max_select) {
      ctx.addIssue({ code: "custom", message: `${q.id}: multi question needs max_select` });
    }
    if (q.type !== "multi" && q.options.some((o) => o.exclusive)) {
      ctx.addIssue({ code: "custom", message: `${q.id}: exclusive is only for multi` });
    }
  });

export const SubcategorySchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: nullableString,
    custom_flow: z.boolean().optional(),
    budget_steps_eur: z.array(z.number().int().positive()).min(1),
    compare_row_labels: z.array(z.string()),
    questions: z.array(QuestionSchema),
  })
  .strict()
  .superRefine((s, ctx) => {
    const ids = s.questions.map((q) => q.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: `${s.id}: duplicate question ids` });
    const index = new Map(ids.map((id, i) => [id, i]));
    for (const q of s.questions) {
      if (q.showIf) {
        const ref = index.get(q.showIf.q);
        if (ref === undefined)
          ctx.addIssue({
            code: "custom",
            message: `${s.id}.${q.id}: showIf references unknown ${q.showIf.q}`,
          });
        else if (ref >= index.get(q.id)!)
          ctx.addIssue({
            code: "custom",
            message: `${s.id}.${q.id}: showIf must reference an earlier question`,
          });
      }
      for (const o of q.options) {
        for (const [target, value] of Object.entries(o.implies ?? {})) {
          const tq = s.questions.find((x) => x.id === target);
          if (!tq)
            ctx.addIssue({
              code: "custom",
              message: `${s.id}.${q.id}.${o.value}: implies unknown ${target}`,
            });
          else if (!tq.options.some((x) => x.value === value))
            ctx.addIssue({
              code: "custom",
              message: `${s.id}.${q.id}.${o.value}: implies unknown value ${target}=${value}`,
            });
        }
      }
    }
  });

export const GroupSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    icon_svg_path: z.string().optional(),
    subcategories: z.array(SubcategorySchema),
  })
  .strict();

export const CatalogSchema = z
  .object({
    note: z.string().optional(),
    groups: z.array(GroupSchema).min(1),
    free_text_detection: z.array(z.object({ subcategory: z.string(), regex: z.string() }).strict()),
  })
  .strict();

export type Option = z.infer<typeof OptionSchema>;
export type ShowIf = z.infer<typeof ShowIfSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type Subcategory = z.infer<typeof SubcategorySchema>;
export type Group = z.infer<typeof GroupSchema>;
export type Catalog = z.infer<typeof CatalogSchema>;

/** A single answer: one value, a list (multi) or a number. */
export type AnswerValue = string | string[] | number;
export type Answers = Record<string, AnswerValue>;
