import { z } from "zod";
import { brandFromName, normalizeEan } from "@/domain/catalog/ean";
import { acceptRow, type AdapterStore, type FeedAdapter, type ParseResult } from "./types";

// Adapter for data/sample-products.json (design-phase sample data). It
// normalises the three product shapes (generic / fridge / vacuum) into the
// one attributes + tags representation the ranking code reads. Used by the
// seed script and by tests; never by production ingestion.

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
  specs: z.string(),
  tags: z.array(z.string()),
});

const Fridge = Base.extend({
  t: z.enum(["free", "builtin"]),
  fz: z.boolean(),
  nf: z.boolean(),
  w: z.number(),
  h: z.number(),
  v: z.number(),
  en: z.string(),
  db: z.number(),
});

const Vacuum = Base.extend({
  t: z.enum(["robot", "stick", "classic"]),
  run: z.number(),
  db: z.number(),
  mop: z.boolean(),
  pet: z.boolean(),
});

const SampleFile = z.object({ note: z.string().optional(), products: z.array(z.unknown()) });

/** Width > 62 cm is wide; ≤ 90 cm tall is compact; < 178 is mid; otherwise tall (from the prototype). */
export function fridgeSizeClass(w: number, h: number): "compact" | "mid" | "tall" | "wide" {
  if (w > 62) return "wide";
  if (h <= 90) return "compact";
  if (h < 178) return "mid";
  return "tall";
}

function warrantyMonths(text: string | undefined): number | null {
  const m = text?.match(/(\d+)\s*mēn/);
  return m ? Number(m[1]) : null;
}

function fridgeTags(p: z.infer<typeof Fridge>): string[] {
  const size = fridgeSizeClass(p.w, p.h);
  const tags = [p.t, size, p.fz ? "yes" : "no"];
  if (p.nf) tags.push("nofrost");
  if (p.h <= 186) tags.push("le186");
  if (p.db <= 38) tags.push("quiet");
  if (["A", "B", "C", "D"].includes(p.en)) tags.push("energy");
  return tags;
}

function vacuumTags(p: z.infer<typeof Vacuum>): string[] {
  const type = p.t === "classic" ? "corded" : p.t;
  const tags = [type];
  if (p.mop) tags.push("yes");
  if (p.pet) tags.push("pets");
  if (p.db <= 70) tags.push("quiet");
  if (p.run >= 60) tags.push("runtime");
  return tags;
}

function fridgeSpecs(p: z.infer<typeof Fridge>): string {
  return `${p.h} × ${p.w} cm · ${p.v} L · klase ${p.en} · ${p.db} dB${p.nf ? " · No Frost" : ""}`;
}

function vacuumSpecs(p: z.infer<typeof Vacuum>): string {
  return `${p.run} min · ${p.db} dB${p.mop ? " · mazgā" : ""}${p.pet ? " · birste dzīvniekiem" : ""}`;
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
      let product: {
        subcategoryId: string;
        attributes: Record<string, unknown>;
        tags: string[];
        specs: string;
      };
      let base: z.infer<typeof Base>;

      const generic = Generic.safeParse(raw);
      const fridge = Fridge.safeParse(raw);
      const vacuum = Vacuum.safeParse(raw);
      if (generic.success) {
        base = generic.data;
        product = {
          subcategoryId: generic.data.sub,
          attributes: {},
          tags: generic.data.tags,
          specs: generic.data.specs,
        };
      } else if (fridge.success) {
        const p = fridge.data;
        base = p;
        product = {
          subcategoryId: "fridge",
          attributes: {
            type: p.t,
            width_cm: p.w,
            height_cm: p.h,
            volume_l: p.v,
            energy_class: p.en,
            noise_db: p.db,
            no_frost: p.nf,
            freezer: p.fz,
            size_class: fridgeSizeClass(p.w, p.h),
          },
          tags: fridgeTags(p),
          specs: fridgeSpecs(p),
        };
      } else if (vacuum.success) {
        const p = vacuum.data;
        base = p;
        product = {
          subcategoryId: "vacuum",
          attributes: {
            type: p.t === "classic" ? "corded" : p.t,
            run_min: p.run,
            noise_db: p.db,
            mop: p.mop,
            pet_brush: p.pet,
          },
          tags: vacuumTags(p),
          specs: vacuumSpecs(p),
        };
      } else {
        result.rejected.push({ reason: "unknown product shape", raw });
        continue;
      }

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
