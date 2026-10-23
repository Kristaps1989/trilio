import { and, asc, eq, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { eprelLookups, products } from "@/db/schema";
import { EPREL_GROUPS } from "@/domain/catalog/eprel";
import { mergeAttributes } from "@/domain/catalog/normalise";
import { getSubcategory } from "@/domain/questions/catalog";
import { type StructuredCaller, llmModel } from "./client";
import { extractProduct, missingKeys } from "./extract";

// Background job: fill attribute gaps that the spec table, feed and rules left.
// Extracted values carry the source "claude", the weakest, so a later spec
// table or EPREL record replaces them and they never overwrite better data.
// Runs after ingestion (cron) or from the CLI. Each product is extracted
// once; re-extraction happens only when `extracted_at` is cleared by hand.
// Costs (docs/PICTURES_AND_LLM_PLAN.md §3): a product with no gaps gets no
// call, the call asks only for the missing keys, energy-label products wait
// for their EPREL lookup first. (The per-subcategory prompts are too short for
// prompt caching; see docs/PROMPT_CACHING_PLAN.md.)

export type ExtractJobResult = {
  scanned: number;
  extracted: number;
  skipped: number;
  /** Already complete from the spec table, feed, rules or EPREL: no call made. */
  notNeeded: number;
  failed: number;
  lowConfidence: number;
};

export const LOW_CONFIDENCE = 60;
/** How long an energy-label product waits for its EPREL lookup before extraction runs anyway. */
export const EPREL_WAIT_MS = 3 * 24 * 3600_000;

export async function runExtractionJob(
  db: Db,
  caller: StructuredCaller,
  opts: { limit?: number; concurrency?: number; subcategoryId?: string; now?: Date } = {},
): Promise<ExtractJobResult> {
  const limit = opts.limit ?? 200;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, 8));
  const result: ExtractJobResult = {
    scanned: 0,
    extracted: 0,
    skipped: 0,
    notNeeded: 0,
    failed: 0,
    lowConfidence: 0,
  };
  const waitedSince = new Date((opts.now ?? new Date()).getTime() - EPREL_WAIT_MS);
  const ready = or(
    notInArray(products.subcategoryId, Object.keys(EPREL_GROUPS)),
    sql`exists (select 1 from ${eprelLookups} where ${eprelLookups.productId} = ${products.id})`,
    lt(products.createdAt, waitedSince),
  );

  const pending = await db
    .select({
      id: products.id,
      name: products.name,
      specs: products.specs,
      description: products.description,
      subcategoryId: products.subcategoryId,
      attributes: products.attributes,
      attributeSources: products.attributeSources,
      specTable: products.specTable,
    })
    .from(products)
    .where(
      and(
        isNull(products.extractedAt),
        ready,
        opts.subcategoryId ? eq(products.subcategoryId, opts.subcategoryId) : undefined,
      ),
    )
    .orderBy(asc(products.subcategoryId), asc(products.createdAt))
    .limit(limit);
  result.scanned = pending.length;

  const queue = [...pending];
  async function worker() {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const sub = getSubcategory(p.subcategoryId);
      if (!sub || (!p.description && !p.specs && !p.specTable)) {
        // Nothing to read from: mark as done so it is not retried every run.
        await db
          .update(products)
          .set({ extractedAt: new Date(), extractionConfidence: 0, extractionModel: "none" })
          .where(eq(products.id, p.id));
        result.skipped++;
        continue;
      }
      const missing = missingKeys(sub.id, p.attributes);
      if (missing.length === 0) {
        await db
          .update(products)
          .set({ extractedAt: new Date(), extractionModel: "not-needed" })
          .where(eq(products.id, p.id));
        result.notNeeded++;
        continue;
      }
      const extracted = await extractProduct(
        { name: p.name, specs: p.specs, description: p.description, specTable: p.specTable },
        sub,
        caller,
        missing,
      );
      if (!extracted) {
        result.failed++;
        continue; // left for the next run (cap, transient error)
      }
      const merged = mergeAttributes(
        { attributes: p.attributes, sources: p.attributeSources },
        {
          attributes: extracted.attributes,
          sources: Object.fromEntries(Object.keys(extracted.attributes).map((k) => [k, "claude"])),
        },
      );
      await db
        .update(products)
        .set({
          attributes: merged.attributes,
          attributeSources: merged.sources,
          extractedAt: new Date(),
          extractionConfidence: extracted.confidence,
          extractionModel: llmModel(),
          updatedAt: new Date(),
        })
        .where(eq(products.id, p.id));
      result.extracted++;
      if (extracted.confidence < LOW_CONFIDENCE) result.lowConfidence++;
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return result;
}
