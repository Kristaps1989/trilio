import { z } from "zod";

// Zod schema for data/categories.json. See docs/QUESTION_SCHEMA.md.
// This file has no UI or DB imports: it is shared by the engine, the seed
// script, the server actions and the validation test.

const nullableString = z.string().nullable().optional();

/**
 * One condition on a product attribute (data/attributes.json). All given
 * comparisons must hold. A product without the attribute is "unknown", which
 * the ranking treats per docs/FILTERS_PLAN.md §2.2.
 */
export const MatchCondSchema = z
  .object({
    attr: z.string().min(1),
    eq: z.union([z.string(), z.number(), z.boolean()]).optional(),
    in: z.array(z.string()).min(1).optional(),
    lte: z.number().optional(),
    gte: z.number().optional(),
  })
  .strict();

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
    /** Conditions a product must meet for this answer (all of them). */
    match: z.array(MatchCondSchema).min(1).optional(),
    /** Picture-card drawing (src/ui/illustrations). */
    illustration: z.string().optional(),
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
    /** Attribute the number is compared with, and the allowed gap (niche height: up to 6 cm lower, 0,5 cm higher). */
    attr: z.string().optional(),
    toleranceBelow: z.number().nonnegative().optional(),
    toleranceAbove: z.number().nonnegative().optional(),
  })
  .strict();

/** A min–max slider over one attribute. `bound: "max"` shows one handle (an upper limit). */
export const RangeSchema = z
  .object({
    attr: z.string().min(1),
    unit: z.string(),
    min: z.number(),
    max: z.number(),
    step: z.number().positive().default(1),
    bound: z.enum(["max", "both"]).default("both"),
    presets: z.array(z.number()).optional(),
    toleranceAbove: z.number().nonnegative().optional(),
  })
  .strict();

export const QuestionSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    why: nullableString,
    type: z.enum(["single", "multi", "number", "range"]).default("single"),
    /**
     * "flow": asked before results; only for questions that decide fit, set
     * the price or the kind of product (core rule 1, docs/FILTERS_PLAN.md).
     * "results": a chip on the results page.
     */
    stage: z.enum(["flow", "results"]).default("flow"),
    up_front_reason: z.enum(["fit", "price", "kind"]).optional(),
    max_select: z.number().int().min(1).optional(),
    hard_filter: z.boolean(),
    showIf: ShowIfSchema.optional(),
    help: z.string().optional(),
    input: NumberInputSchema.optional(),
    range: RangeSchema.optional(),
    options: z.array(OptionSchema),
  })
  .strict()
  .superRefine((q, ctx) => {
    const values = q.options.map((o) => o.value);
    if (new Set(values).size !== values.length) {
      ctx.addIssue({ code: "custom", message: `duplicate option values in ${q.id}` });
    }
    if (q.stage === "flow" && !q.up_front_reason) {
      ctx.addIssue({ code: "custom", message: `${q.id}: a flow question needs up_front_reason` });
    }
    if (q.type === "number") {
      if (!q.input) ctx.addIssue({ code: "custom", message: `${q.id}: number question needs input` });
      if (q.options.length) ctx.addIssue({ code: "custom", message: `${q.id}: number question has options` });
    } else if (q.type === "range") {
      if (!q.range) ctx.addIssue({ code: "custom", message: `${q.id}: range question needs range` });
      if (q.options.length) ctx.addIssue({ code: "custom", message: `${q.id}: range question has options` });
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
    /** Drawing for the subcategory tile (src/ui/illustrations), one per subcategory. */
    illustration: z.string().optional(),
    budget_steps_eur: z.array(z.number().int().positive()).min(1),
    /** Attribute keys shown in the compare table and used by the upgrade delta, in order. */
    compare: z.array(z.string()),
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

export type MatchCond = z.infer<typeof MatchCondSchema>;
export type Range = z.infer<typeof RangeSchema>;
export type Option = z.infer<typeof OptionSchema>;
export type ShowIf = z.infer<typeof ShowIfSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type Subcategory = z.infer<typeof SubcategorySchema>;
export type Group = z.infer<typeof GroupSchema>;
export type Catalog = z.infer<typeof CatalogSchema>;

/** A range answer; a missing bound means "no limit". */
export type RangeAnswer = { min?: number; max?: number };

/** A single answer: one value, a list (multi), a number or a range. */
export type AnswerValue = string | string[] | number | RangeAnswer;
export type Answers = Record<string, AnswerValue>;
