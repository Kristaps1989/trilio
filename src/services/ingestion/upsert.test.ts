import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { offers, priceSnapshots, products, stores } from "@/db/schema";
import { gtinCheckDigit } from "@/domain/catalog/ean";
import { VERSION_KEY } from "./renormalise";
import { markUnseenOutOfStock, upsertOffers, withCategory } from "./upsert";
import type { UpsertRow } from "./types";

// Integration test against the database in DATABASE_URL (CI starts Postgres).
// Rows are namespaced with "test:" so the test is safe on a seeded database.

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;

// A GTIN that no real feed will carry, so the test never touches seeded rows.
const EAN = "990000000001" + gtinCheckDigit("990000000001");

function row(overrides: Partial<UpsertRow>): UpsertRow {
  return {
    externalId: "test:x1",
    ean: EAN,
    brand: "TestBrand",
    modelCode: "TB-100",
    name: "TestBrand TB-100",
    description: null,
    subcategoryId: "kettle",
    attributes: { volume_l: 1.7 },
    tags: ["fast"],
    specs: "1,7 L",
    kwhYear: null,
    rating: 80,
    imageUrl: null,
    condition: "new",
    grade: null,
    warrantyMonths: null,
    priceCents: 4999,
    stock: "in",
    deliveryEtaDays: null,
    url: "https://example.invalid/p/1",
    ...overrides,
  };
}

run("upsertOffers", () => {
  let db: Db;
  let end: () => Promise<void>;
  let storeId: string;

  async function cleanup() {
    await db.delete(products).where(like(products.brand, "TestBrand%"));
    await db.delete(stores).where(eq(stores.slug, "test_store"));
  }

  beforeAll(async () => {
    const created = createDb(url);
    db = created.db;
    end = () => created.client.end();
    await cleanup();
    const [s] = await db
      .insert(stores)
      .values({ slug: "test_store", displayName: "Test", feedType: "sample" })
      .returning({ id: stores.id });
    storeId = s!.id;
  });

  afterAll(async () => {
    await cleanup();
    await end();
  });

  it("creates a product and offer, writes a snapshot, and updates price on the next run", async () => {
    const first = await upsertOffers(db, { id: storeId }, [row({})], new Date("2026-10-01T08:00:00Z"));
    expect(first).toEqual({ productsCreated: 1, offersUpserted: 1, snapshots: 1 });

    const second = await upsertOffers(
      db,
      { id: storeId },
      [row({ priceCents: 4499, stock: "soon" })],
      new Date("2026-10-02T08:00:00Z"),
    );
    expect(second).toEqual({ productsCreated: 0, offersUpserted: 1, snapshots: 1 });

    const [product] = await db.select().from(products).where(eq(products.ean, EAN));
    const storeOffers = await db.select().from(offers).where(eq(offers.productId, product!.id));
    expect(storeOffers).toHaveLength(1);
    expect(storeOffers[0]!.priceCents).toBe(4499);
    expect(storeOffers[0]!.stock).toBe("soon");

    const snaps = await db
      .select()
      .from(priceSnapshots)
      .where(eq(priceSnapshots.offerId, storeOffers[0]!.id));
    expect(snaps.map((s) => s.priceCents).sort()).toEqual([4499, 4999]);
  });

  it("resolves the same product by EAN and by brand+model key, and keeps refurbished separate", async () => {
    await upsertOffers(
      db,
      { id: storeId },
      [
        row({ externalId: "test:x2", ean: null, modelCode: "tb 100" }), // no EAN → model key
        row({
          externalId: "test:x3",
          condition: "refurbished",
          grade: "A",
          warrantyMonths: 12,
          priceCents: 2999,
        }),
      ],
      new Date("2026-10-03T08:00:00Z"),
    );
    const [product] = await db.select().from(products).where(eq(products.ean, EAN));
    const all = await db.select().from(offers).where(eq(offers.productId, product!.id));
    expect(all).toHaveLength(3);
    expect(all.filter((o) => o.condition === "refurbished")).toHaveLength(1);
    const tbProducts = await db.select().from(products).where(like(products.brand, "TestBrand%"));
    expect(tbProducts).toHaveLength(1);
  });

  it("keeps every shop's category and marks the product for re-deriving when a new one arrives", async () => {
    await upsertOffers(db, { id: storeId }, [row({ externalId: "test:c1", shopCategory: "tējkannas" })]);
    const [p1] = await db.select().from(products).where(eq(products.ean, EAN));
    expect(p1!.shopCategories).toContain("tējkannas");
    await db
      .update(products)
      .set({ attributeSources: { ...p1!.attributeSources, [VERSION_KEY]: "v-test" } })
      .where(eq(products.id, p1!.id));
    // The same category again changes nothing.
    await upsertOffers(db, { id: storeId }, [row({ externalId: "test:c1", shopCategory: "Tējkannas" })]);
    const [p2] = await db.select().from(products).where(eq(products.ean, EAN));
    expect(p2!.attributeSources[VERSION_KEY]).toBe("v-test");
    // A new one is new evidence: the product is stale until renormalise re-derives it.
    await upsertOffers(db, { id: storeId }, [
      row({ externalId: "test:c2", shopCategory: "elektriskās tējkannas" }),
    ]);
    const [p3] = await db.select().from(products).where(eq(products.ean, EAN));
    expect(p3!.shopCategories).toEqual(expect.arrayContaining(["tējkannas", "elektriskās tējkannas"]));
    expect(p3!.attributeSources[VERSION_KEY]).toBe("");
  });

  it("adds a category once, case-insensitively, and keeps at most eight", () => {
    expect(withCategory(["a"], "A")).toEqual(["a"]);
    expect(withCategory(["a"], " ")).toEqual(["a"]);
    expect(withCategory(["a"], null)).toEqual(["a"]);
    expect(withCategory(["1", "2", "3", "4", "5", "6", "7", "8"], "9")).toHaveLength(8);
  });

  it("refurbished rows do not overwrite product data", async () => {
    await upsertOffers(
      db,
      { id: storeId },
      [row({ externalId: "test:x3", condition: "refurbished", name: "WRONG NAME", tags: [] })],
      new Date("2026-10-03T08:00:00Z"),
    );
    const [product] = await db.select().from(products).where(eq(products.ean, EAN));
    expect(product!.name).toBe("TestBrand TB-100");
    expect(product!.tags).toEqual(["fast"]);
  });

  it("marks offers unseen for a day as out of stock", async () => {
    const now = new Date("2026-10-05T08:00:00Z");
    await upsertOffers(db, { id: storeId }, [row({ externalId: "test:x1" })], now);
    const changed = await markUnseenOutOfStock(db, { id: storeId }, now);
    const [product] = await db.select().from(products).where(eq(products.ean, EAN));
    const all = await db.select().from(offers).where(eq(offers.productId, product!.id));
    const byExt = Object.fromEntries(all.map((o) => [o.externalId, o.stock]));
    expect(byExt["test:x1"]).toBe("in");
    expect(byExt["test:x2"]).toBe("out");
    expect(byExt["test:x3"]).toBe("out");
    expect(changed).toBe(2);
    expect(
      await db
        .select()
        .from(offers)
        .where(inArray(offers.externalId, ["test:x2", "test:x3"])),
    ).toHaveLength(2);
  });
});
