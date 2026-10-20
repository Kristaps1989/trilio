import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { eprelLookups, offers, products } from "@/db/schema";
import {
  EPREL_GROUPS,
  eprelAttributes,
  registrationNumber,
  sameProduct,
  type EprelRecord,
} from "@/domain/catalog/eprel";
import { mergeAttributes } from "@/domain/catalog/normalise";
import { EprelError, type EprelClient } from "./client";

// Fills product attributes from EPREL (docs/ATTRIBUTES.md, source priority 6,
// above shop spec tables). Each run checks a batch of products in the label
// categories: never-checked first, then old lookups. By EAN first (free), then
// by brand and model when EPREL_API_KEY is set. A record only counts when its
// brand and model match the product. Runs from the web service's scheduler
// and `npm run ingest -- eprel`.

export type EprelJobResult = { checked: number; found: number; notFound: number; errors: number };

const DAY = 86_400_000;
/** When to ask again: a found record quarterly, a miss monthly, an error the next day. */
const RECHECK = { found: 90 * DAY, not_found: 30 * DAY, error: DAY };

async function due(db: Db, limit: number, now: Date) {
  const subs = Object.keys(EPREL_GROUPS);
  const before = (ms: number) => new Date(now.getTime() - ms);
  return db
    .select({
      id: products.id,
      subcategoryId: products.subcategoryId,
      brand: products.brand,
      modelCode: products.modelCode,
      ean: products.ean,
      attributes: products.attributes,
      attributeSources: products.attributeSources,
    })
    .from(products)
    .leftJoin(eprelLookups, eq(eprelLookups.productId, products.id))
    .where(
      and(
        inArray(products.subcategoryId, subs),
        // Only what shoppers can buy: a product with an offer in stock somewhere.
        sql`exists (select 1 from ${offers} where ${offers.productId} = ${products.id} and ${offers.stock} <> 'out')`,
        or(
          isNull(eprelLookups.productId),
          and(eq(eprelLookups.status, "found"), lt(eprelLookups.checkedAt, before(RECHECK.found))),
          and(eq(eprelLookups.status, "not_found"), lt(eprelLookups.checkedAt, before(RECHECK.not_found))),
          and(eq(eprelLookups.status, "error"), lt(eprelLookups.checkedAt, before(RECHECK.error))),
        ),
      ),
    )
    .orderBy(sql`${eprelLookups.checkedAt} asc nulls first`)
    .limit(limit);
}

type Found = { record: EprelRecord; group: string; method: "gtin" | "model" };

/** The product's EPREL record: by EAN, then by model in each of its groups. */
export async function findRecord(
  client: EprelClient,
  p: { subcategoryId: string; brand: string; modelCode: string; ean: string | null },
): Promise<Found | null> {
  const groups = EPREL_GROUPS[p.subcategoryId] ?? [];
  if (p.ean) {
    for (const r of await client.byGtin(p.ean)) {
      const group = typeof r.productGroup === "string" ? r.productGroup : null;
      // An EAN names one product; the brand check guards against a shop's wrong EAN.
      if (
        group &&
        groups.includes(group) &&
        sameProduct(r, { brand: p.brand, modelCode: String(r.modelIdentifier ?? "") })
      )
        return { record: r, group, method: "gtin" };
    }
  }
  if (client.canSearch) {
    for (const group of groups) {
      const hit = (await client.searchModel(group, p.modelCode)).find((r) => sameProduct(r, p));
      if (hit) return { record: hit, group, method: "model" };
    }
  }
  return null;
}

export async function runEprelJob(
  db: Db,
  opts: { client: EprelClient; limit?: number; delayMs?: number; now?: Date; log?: Pick<Console, "warn"> },
): Promise<EprelJobResult> {
  const now = opts.now ?? new Date();
  const delay = opts.delayMs ?? 400;
  const result: EprelJobResult = { checked: 0, found: 0, notFound: 0, errors: 0 };
  const rows = await due(db, opts.limit ?? 150, now);

  for (const p of rows) {
    result.checked++;
    let status: "found" | "not_found" | "error" = "not_found";
    let found: Found | null = null;
    try {
      found = await findRecord(opts.client, p);
      status = found ? "found" : "not_found";
    } catch (err) {
      status = "error";
      result.errors++;
      (opts.log ?? console).warn("eprel:", p.id, (err as Error).message);
      // A refused key would fail every lookup: stop and try again next run.
      if (err instanceof EprelError && err.status === 403) break;
    }

    if (found) {
      result.found++;
      const attrs = eprelAttributes(p.subcategoryId, found.group, found.record);
      // A refresh replaces the previous EPREL values instead of keeping them as equals.
      const current = { attributes: { ...p.attributes }, sources: { ...p.attributeSources } };
      for (const [k, s] of Object.entries(current.sources)) {
        if (s === "eprel") {
          delete current.attributes[k];
          delete current.sources[k];
        }
      }
      const merged = mergeAttributes(current, {
        attributes: attrs,
        sources: Object.fromEntries(Object.keys(attrs).map((k) => [k, "eprel"])),
      });
      const kwh = merged.sources.kwh_year === "eprel" ? merged.attributes.kwh_year : undefined;
      await db
        .update(products)
        .set({
          attributes: merged.attributes,
          attributeSources: merged.sources,
          ...(typeof kwh === "number" ? { kwhYear: Math.round(kwh) } : {}),
        })
        .where(eq(products.id, p.id));
    } else if (status === "not_found") {
      result.notFound++;
    }

    const lookup = {
      status,
      method: found?.method ?? null,
      productGroup: found?.group ?? null,
      registrationNumber: found ? registrationNumber(found.record) : null,
      record: found?.record ?? null,
      checkedAt: now,
    };
    await db
      .insert(eprelLookups)
      .values({ productId: p.id, ...lookup })
      .onConflictDoUpdate({ target: eprelLookups.productId, set: lookup });
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  }
  return result;
}
