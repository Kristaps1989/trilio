import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { eprelLookups, products, stores } from "@/db/schema";
import { gtinCheckDigit } from "@/domain/catalog/ean";
import { upsertOffers } from "@/services/ingestion/upsert";
import type { StructuredCaller, StructuredRequest } from "./client";
import { EPREL_WAIT_MS, runExtractionJob } from "./extract-job";

// Integration: the cost rules of docs/PICTURES_AND_LLM_PLAN.md §3. A complete
// product gets no call, a call asks only for what is missing, and an
// energy-label product waits for its EPREL lookup (or three days).

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;
const ean = (n: number) => {
  const body = String(990000000950 + n);
  return body + gtinCheckDigit(body);
};

run("runExtractionJob", () => {
  let db: Db;
  let end: () => Promise<void>;
  let storeId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const created = createDb(url!);
    db = created.db;
    end = () => created.client.end();
    await db.delete(stores).where(eq(stores.slug, "extract_job_store"));
    for (let n = 1; n <= 5; n++) await db.delete(products).where(eq(products.ean, ean(n)));
    const [s] = await db
      .insert(stores)
      .values({ slug: "extract_job_store", displayName: "Extract Store", feedType: "sample" })
      .returning();
    storeId = s!.id;
    const row = (n: number, sub: string, model: string, attributes: Record<string, unknown>) => ({
      externalId: `xj-${n}`,
      ean: ean(n),
      brand: "Testbrand",
      modelCode: model,
      name: `Testbrand ${model}`,
      description: "Jauda 2200 W, tilpums 1,7 l, nerūsējošs tērauds.",
      subcategoryId: sub,
      attributes,
      tags: [],
      specs: null,
      kwhYear: null,
      rating: null,
      imageUrl: null,
      condition: "new" as const,
      grade: null,
      warrantyMonths: null,
      priceCents: 3000,
      // Out of stock for the fridge that must wait: the EPREL job only looks up products
      // in stock, so its test (sharing this database, in parallel) cannot mark it as checked.
      stock: model === "XJFRIDGENEW" ? ("out" as const) : ("in" as const),
      deliveryEtaDays: null,
      url: `https://example.invalid/xj-${n}`,
    });
    await upsertOffers(db, { id: storeId }, [
      row(1, "kettle", "XJCOMPLETE", {
        material: "steel",
        temp_control: false,
        volume_l: 1.7,
        power_w: 2200,
      }),
      row(2, "kettle", "XJGAPS", { volume_l: 1.7 }),
      row(3, "fridge", "XJFRIDGENEW", {}),
      row(4, "fridge", "XJFRIDGELOOKED", {}),
      row(5, "fridge", "XJFRIDGEOLD", {}),
    ]);
    for (const p of await db
      .select()
      .from(products)
      .where(
        inArray(products.modelCode, ["XJCOMPLETE", "XJGAPS", "XJFRIDGENEW", "XJFRIDGELOOKED", "XJFRIDGEOLD"]),
      ))
      ids[p.modelCode] = p.id;
    await db.insert(eprelLookups).values({ productId: ids.XJFRIDGELOOKED!, status: "not_found" });
    await db
      .update(products)
      .set({ createdAt: new Date(Date.now() - EPREL_WAIT_MS - 3600_000) })
      .where(eq(products.id, ids.XJFRIDGEOLD!));
  });

  afterAll(async () => {
    await db.delete(products).where(inArray(products.id, Object.values(ids)));
    await db.delete(stores).where(eq(stores.id, storeId));
    await end();
  });

  it("skips complete products, asks only for missing keys, and lets label products wait for EPREL", async () => {
    const asked: string[] = [];
    const caller: StructuredCaller = async <T>(req: StructuredRequest<T>) => {
      asked.push(req.user);
      return {
        ok: true,
        value: { attributes: [{ key: "power_w", value: 2200 }], confidence: 90 } as T,
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    };

    await runExtractionJob(db, caller, { subcategoryId: "kettle" });
    const mine = asked.filter((u) => u.includes("Testbrand"));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toContain("XJGAPS");
    expect(mine[0]).toMatch(/Report only these keys: material, temp_control, power_w\./);

    const [complete] = await db.select().from(products).where(eq(products.id, ids.XJCOMPLETE!));
    expect(complete!.extractionModel).toBe("not-needed");
    expect(complete!.extractedAt).not.toBeNull();
    const [gaps] = await db.select().from(products).where(eq(products.id, ids.XJGAPS!));
    expect(gaps!.attributes).toMatchObject({ volume_l: 1.7, power_w: 2200 });
    expect(gaps!.attributeSources).toMatchObject({ power_w: "claude" });

    asked.length = 0;
    await runExtractionJob(db, caller, { subcategoryId: "fridge" });
    const fridges = asked.filter((u) => u.includes("Testbrand")).join("\n");
    expect(fridges).toContain("XJFRIDGELOOKED");
    expect(fridges).toContain("XJFRIDGEOLD");
    expect(fridges).not.toContain("XJFRIDGENEW");
    const [waiting] = await db.select().from(products).where(eq(products.id, ids.XJFRIDGENEW!));
    expect(waiting!.extractedAt).toBeNull();
  });
});
