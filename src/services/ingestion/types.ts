import { z } from "zod";

// What every feed adapter produces. One row per offer; product identity is
// carried on each row and resolved to a product by EAN or brand+model key in
// upsert.ts. Prices are integer cents.

export const NormalisedOfferSchema = z.object({
  externalId: z.string().min(1),
  ean: z
    .string()
    .regex(/^\d{13,14}$/)
    .nullable(),
  brand: z.string().min(1),
  modelCode: z.string().min(1),
  name: z.string().min(1),
  subcategoryId: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()).default({}),
  tags: z.array(z.string()).default([]),
  specs: z.string().nullable().default(null),
  kwhYear: z.number().int().nonnegative().nullable().default(null),
  rating: z.number().int().min(0).max(100).nullable().default(null),
  imageUrl: z.string().url().nullable().default(null),
  condition: z.enum(["new", "refurbished"]).default("new"),
  grade: z.string().nullable().default(null),
  warrantyMonths: z.number().int().nonnegative().nullable().default(null),
  priceCents: z.number().int().positive(),
  stock: z.enum(["in", "soon", "out"]),
  deliveryEtaDays: z.number().int().nonnegative().nullable().default(null),
  url: z.string().url(),
});

export type NormalisedOffer = z.infer<typeof NormalisedOfferSchema>;

export type Rejected = { reason: string; raw: unknown };

export type ParseResult = { offers: NormalisedOffer[]; rejected: Rejected[] };

export type AdapterStore = {
  slug: string;
  /** Maps a feed's category labels to our subcategory ids; configured per store. */
  categoryMap?: Record<string, string>;
};

export interface FeedAdapter {
  readonly type: "sample" | "google_xml" | "csv";
  /** Parse a raw feed body. Must never throw on bad rows: they go to `rejected`. */
  parse(body: string, store: AdapterStore): ParseResult;
}

/** Validate one normalised row; adapters call this so every row leaving an adapter is well-formed. */
export function acceptRow(result: ParseResult, candidate: unknown, raw: unknown): void {
  const parsed = NormalisedOfferSchema.safeParse(candidate);
  if (parsed.success) result.offers.push(parsed.data);
  else
    result.rejected.push({
      reason: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      raw,
    });
}
