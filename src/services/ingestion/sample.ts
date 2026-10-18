import { z } from "zod";
import { brandFromName, normalizeEan } from "@/domain/catalog/ean";
import { acceptRow, type AdapterStore, type FeedAdapter, type ParseResult } from "./types";

// Adapter for data/sample-products.json (design-phase sample data). Each
// product carries its attributes in the data/attributes.json vocabulary, the
// same representation ingestion produces. Used by the seed script and by
// tests; never by production ingestion.

// Out-of-stock sample offers carry `price_eur: null`; they are skipped, not rejected.
const OfferSchema = z.object({
  store: z.string(),
  price_eur: z.number().nullable(),
  stock: z.enum(["in", "soon", "out"]),
});

const Base = z.object({
  id: z.string(),
  c: z.enum(["new", "refurb"]),
  name: z.string(),
  m: z.string(),
  ean: z.union([z.string(), z.number()]),
  s: z.number(),
  kwh_year: z.number().nullable().optional(),
  g: z.string().optional(),
  wr: z.string().optional(),
  nw: z.number().optional(),
  offers: z.array(OfferSchema),
});

const Generic = Base.extend({
  sub: z.string(),
  gen: z.literal(true).optional(),
  specs: z.string().optional(),
  tags: z.array(z.string()).optional(),
  attrs: z.record(z.string(), z.unknown()).optional(),
});

const SampleFile = z.object({ note: z.string().optional(), products: z.array(z.unknown()) });

function warrantyMonths(text: string | undefined): number | null {
  const m = text?.match(/(\d+)\s*mēn/);
  return m ? Number(m[1]) : null;
}

export const sampleAdapter: FeedAdapter = {
  type: "sample",
  parse(body: string, store: AdapterStore): ParseResult {
    const result: ParseResult = { offers: [], rejected: [] };
    const file = SampleFile.safeParse(JSON.parse(body));
    if (!file.success) {
      result.rejected.push({ reason: "file: " + file.error.message, raw: null });
      return result;
    }

    for (const raw of file.data.products) {
      const parsed = Generic.safeParse(raw);
      if (!parsed.success) {
        result.rejected.push({ reason: "unknown product shape", raw });
        continue;
      }
      const base = parsed.data;
      const product = {
        subcategoryId: base.sub,
        attributes: base.attrs ?? {},
        tags: base.tags ?? [],
        specs: base.specs ?? "",
      };

      const ean = normalizeEan(base.ean);
      const condition = base.c === "refurb" ? "refurbished" : "new";
      for (const o of base.offers) {
        if (o.store !== store.slug || o.price_eur === null) continue;
        acceptRow(
          result,
          {
            externalId: base.id,
            ean,
            brand: brandFromName(base.name),
            modelCode: base.m,
            name: base.name,
            description: null,
            subcategoryId: product.subcategoryId,
            attributes: product.attributes,
            tags: product.tags,
            specs: product.specs,
            kwhYear: base.kwh_year ?? null,
            rating: Math.round(base.s * 10),
            imageUrl: null,
            condition,
            grade: base.g ?? null,
            warrantyMonths: warrantyMonths(base.wr),
            priceCents: Math.round(o.price_eur * 100),
            stock: o.stock,
            deliveryEtaDays: null,
            url: `https://example.invalid/${store.slug}/${encodeURIComponent(base.id)}`,
          },
          raw,
        );
      }
    }
    return result;
  },
};
