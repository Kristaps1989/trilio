import "dotenv/config";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "./client";
import { stores } from "./schema";
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
        defaultDeliveryDays: s.defaultDeliveryDays ?? 3,
        active: s.active,
      })
      .onConflictDoUpdate({
        target: stores.slug,
        // Only descriptive fields; feed URL, affiliate template and active flag are operated in the DB.
        set: { displayName: s.displayName, feedType: s.feedType, imageHosts: s.imageHosts ?? [] },
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

async function main() {
  const { db, client } = createDb();
  await upsertStores(db, [...SAMPLE_STORES, ...PARTNER_STORES]);
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
