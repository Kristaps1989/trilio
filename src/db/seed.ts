import "dotenv/config";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "./client";
import { plans, stores } from "./schema";
import { PARTNER_STORES, SAMPLE_STORES, type StoreSeed } from "./stores";
import { sampleAdapter } from "@/services/ingestion/sample";
import { upsertOffers } from "@/services/ingestion/upsert";

// `npm run db:seed` — idempotent. Upserts store configuration and ingests
// data/sample-products.json through the same pipeline a real feed uses.
// Categories are not seeded: data/categories.json is their source of truth.

export async function upsertStores(db: Db, seeds: StoreSeed[]) {
  for (const s of seeds) {
    await db
      .insert(stores)
      .values({
        slug: s.slug,
        displayName: s.displayName,
        feedType: s.feedType,
        feedUrl: s.feedUrl ?? null,
        affiliateTemplateUrl: s.affiliateTemplateUrl ?? null,
        imageHosts: s.imageHosts ?? [],
        categoryMap: s.categoryMap ?? {},
        scrapeConfig: s.scrapeConfig ?? null,
        defaultDeliveryDays: s.defaultDeliveryDays ?? 3,
        active: s.active,
      })
      .onConflictDoUpdate({
        target: stores.slug,
        // Descriptive fields and reviewed crawl config. Feed URL, affiliate template and
        // the active flag are operated in the DB (docs/RUNBOOK.md).
        set: {
          displayName: s.displayName,
          feedType: s.feedType,
          imageHosts: s.imageHosts ?? [],
          ...(s.categoryMap ? { categoryMap: s.categoryMap } : {}),
          ...(s.scrapeConfig ? { scrapeConfig: s.scrapeConfig } : {}),
        },
      });
  }
}

export async function seedSampleProducts(db: Db, body: string) {
  const summary: Record<string, unknown> = {};
  for (const s of SAMPLE_STORES) {
    const [store] = await db.select().from(stores).where(eq(stores.slug, s.slug));
    if (!store) throw new Error(`store ${s.slug} missing`);
    const parsed = sampleAdapter.parse(body, { slug: s.slug });
    const stats = await upsertOffers(db, store, parsed.offers);
    summary[s.slug] = { offers: parsed.offers.length, rejected: parsed.rejected.length, ...stats };
    if (parsed.rejected.length) console.warn(s.slug, "rejected:", parsed.rejected.slice(0, 3));
  }
  return summary;
}

/** The paid plan is removed (owner, 30 Oct 2026; docs/PRICE_NOTIFY_PLAN.md §4): any plan rows left are switched off. */
export async function retirePlans(db: Db) {
  await db.update(plans).set({ active: false });
}

/**
 * Production (`npm run db:release` at Railway start) sets SEED_SAMPLE_DATA=0: partner stores
 * only, no placeholder shops. Local development and CI keep the samples.
 */
export function seedSampleData(env: Record<string, string | undefined> = process.env): boolean {
  return env.SEED_SAMPLE_DATA !== "0";
}

async function main() {
  const { db, client } = createDb();
  const withSamples = seedSampleData();
  await upsertStores(db, withSamples ? [...SAMPLE_STORES, ...PARTNER_STORES] : PARTNER_STORES);
  await retirePlans(db);
  if (!withSamples) {
    console.log("seeded partner stores (no sample data)");
    await client.end();
    return;
  }
  const body = readFileSync("data/sample-products.json", "utf8");
  const summary = await seedSampleProducts(db, body);
  console.table(summary);
  await client.end();
}

if (process.argv[1]?.endsWith("seed.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
