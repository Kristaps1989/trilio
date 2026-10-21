import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { eprelLookups, products, stores } from "@/db/schema";
import { gtinCheckDigit } from "@/domain/catalog/ean";
import fixtures from "@/domain/catalog/__fixtures__/eprel.json";
import type { EprelRecord } from "@/domain/catalog/eprel";
import { upsertOffers } from "@/services/ingestion/upsert";
import type { EprelClient } from "./client";
import { findRecord, runEprelJob } from "./job";

// Integration: a dishwasher found in EPREL by its model gets the label's
// values (above the shop's own spec values), a product EPREL does not know is
// recorded as not found, and neither is asked again in the same month.

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;
const record = (fixtures.records as Record<string, EprelRecord>)["dishwashers2019-1273558"]!;
const EAN_FOUND = "990000000901" + gtinCheckDigit("990000000901");
const EAN_MISSING = "990000000902" + gtinCheckDigit("990000000902");

function fakeClient(): EprelClient & { searches: string[] } {
  const searches: string[] = [];
  return {
    canSearch: true,
    searches,
    async byGtin() {
      return [];
    },
    async searchModel(group, model) {
      searches.push(`${group}:${model}`);
      return group === "dishwashers2019" && model === "W8I HF58 TU UK" ? [record] : [];
    },
  };
}

describe("findRecord", () => {
  it("prefers the EAN, checks the group and brand, then searches by model", async () => {
    const client: EprelClient = {
      canSearch: false,
      async byGtin() {
        return [{ ...record, supplierOrTrademark: "Other" }, record];
      },
      async searchModel() {
        throw new Error("not used");
      },
    };
    const hit = await findRecord(client, {
      subcategoryId: "dish",
      brand: "Whirlpool",
      modelCode: "anything",
      ean: "1234567890123",
    });
    expect(hit?.method).toBe("gtin");
    expect(hit?.record.supplierOrTrademark).toBe("WHIRLPOOL");
    expect(
      await findRecord(client, { subcategoryId: "kettle", brand: "W", modelCode: "x", ean: "1" }),
    ).toBeNull();
  });
});

run("runEprelJob", () => {
  let db: Db;
  let end: () => Promise<void>;
  let storeId: string;
  let foundId: string;
  let missingId: string;

  beforeAll(async () => {
    const created = createDb(url);
    db = created.db;
    end = () => created.client.end();
    for (const ean of [EAN_FOUND, EAN_MISSING]) await db.delete(products).where(eq(products.ean, ean));
    await db.delete(stores).where(eq(stores.slug, "eprel_job_store"));
    const [s] = await db
      .insert(stores)
      .values({ slug: "eprel_job_store", displayName: "EPREL Store", feedType: "sample" })
      .returning();
    storeId = s!.id;
    const row = (ean: string, brand: string, model: string) => ({
      externalId: `ej-${ean}`,
      ean,
      brand,
      modelCode: model,
      name: `${brand} ${model} trauku mazgājamā mašīna`,
      description: null,
      subcategoryId: "dish",
      attributes: { noise_db: 44, place_settings: 13 },
      tags: [],
      specs: null,
      kwhYear: null,
      rating: 80,
      imageUrl: null,
      condition: "new" as const,
      grade: null,
      warrantyMonths: null,
      priceCents: 50000,
      stock: "in" as const,
      deliveryEtaDays: null,
      url: `https://example.invalid/${ean}`,
    });
    await upsertOffers(db, { id: storeId }, [
      row(EAN_FOUND, "Whirlpool", "W8I HF58 TU UK"),
      row(EAN_MISSING, "Whirlpool", "NOPE123"),
    ]);
    foundId = (await db.select().from(products).where(eq(products.ean, EAN_FOUND)))[0]!.id;
    missingId = (await db.select().from(products).where(eq(products.ean, EAN_MISSING)))[0]!.id;
    await db
      .update(products)
      .set({ attributeSources: { noise_db: "spec_table", place_settings: "spec_table" } })
      .where(eq(products.id, foundId));
  });

  afterAll(async () => {
    await db.delete(products).where(eq(products.id, foundId));
    await db.delete(products).where(eq(products.id, missingId));
    await db.delete(stores).where(eq(stores.id, storeId));
    await end();
  });

  it("fills label values, records misses, and does not ask again within a month", async () => {
    const client = fakeClient();
    await runEprelJob(db, { client, limit: 500, delayMs: 0 });

    const [p] = await db.select().from(products).where(eq(products.id, foundId));
    expect(p!.attributes).toMatchObject({
      noise_db: 38,
      place_settings: 14,
      energy_class: "B",
      width_cm: 60,
    });
    expect(p!.attributeSources).toMatchObject({ noise_db: "eprel", energy_class: "eprel" });
    expect(p!.kwhYear).toBe(Math.round(64 * 2.8));
    expect(p!.eprelId).toBe("dishwashers2019/1273558");
    const [hit] = await db.select().from(eprelLookups).where(eq(eprelLookups.productId, foundId));
    expect(hit).toMatchObject({ status: "found", method: "model", registrationNumber: "1273558" });
    const [miss] = await db.select().from(eprelLookups).where(eq(eprelLookups.productId, missingId));
    expect(miss!.status).toBe("not_found");

    const again = fakeClient();
    await runEprelJob(db, { client: again, limit: 500, delayMs: 0 });
    expect(again.searches.filter((s) => s.includes("W8I HF58") || s.includes("NOPE123"))).toEqual([]);
  });
});
