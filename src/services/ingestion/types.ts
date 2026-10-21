import { z } from "zod";
import { SAMPLE_PATH } from "@/domain/catalog/media";

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
  description: z.string().nullable().default(null),
  subcategoryId: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()).default({}),
  /** Where each attribute came from (normalise.ts AttributeSource). */
  attributeSources: z.record(z.string(), z.string()).default({}),
  /** The shop's spec table as read (label → value), kept for re-normalising and extraction. */
  specTable: z.record(z.string(), z.string()).nullable().default(null),
  tags: z.array(z.string()).default([]),
  specs: z.string().nullable().default(null),
  kwhYear: z.number().int().nonnegative().nullable().default(null),
  rating: z.number().int().min(0).max(100).nullable().default(null),
  /** A shop photo (https), or a local /sample/ file in the design sample data. */
  imageUrl: z
    .union([z.string().url(), z.string().regex(SAMPLE_PATH)])
    .nullable()
    .default(null),
  /** EPREL product "<group>/<registration>": only sample data states it; the EPREL job sets it for shop products. */
  eprelId: z
    .string()
    .regex(/^[a-z0-9]+\/\d+$/)
    .nullable()
    .default(null),
  condition: z.enum(["new", "refurbished"]).default("new"),
  grade: z.string().nullable().default(null),
  warrantyMonths: z.number().int().nonnegative().nullable().default(null),
  priceCents: z.number().int().positive(),
  stock: z.enum(["in", "soon", "out"]),
  deliveryEtaDays: z.number().int().nonnegative().nullable().default(null),
  url: z.string().url(),
});

export type NormalisedOffer = z.infer<typeof NormalisedOfferSchema>;

/** What upsertOffers accepts: provenance and the spec table are optional (sample data, tests). */
export type UpsertRow = Omit<NormalisedOffer, "attributeSources" | "specTable" | "eprelId"> &
  Partial<Pick<NormalisedOffer, "attributeSources" | "specTable" | "eprelId">>;

export type Rejected = { reason: string; raw: unknown };

export type ParseResult = { offers: NormalisedOffer[]; rejected: Rejected[] };

export type AdapterStore = {
  slug: string;
  /** Maps a feed's category labels to our subcategory ids; configured per store. */
  categoryMap?: Record<string, string>;
  /**
   * Only the store's category_map decides the subcategory (no free-text
   * fallback). Used for scraped pages, where a loose match would pull in
   * accessories and spare parts.
   */
  strictCategories?: boolean;
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
