import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { products } from "@/db/schema";
import { mergeAttributes } from "@/domain/catalog/normalise";
import { getSubcategory } from "@/domain/questions/catalog";
import { type StructuredCaller, llmModel } from "./client";
import { extractProduct } from "./extract";

// Background job: fill attribute gaps that the spec table, feed and rules left.
// Extracted values carry the source "claude", the weakest, so a later spec
// table or EPREL record replaces them and they never overwrite better data.
// Runs after ingestion (cron) or from the CLI. Each product is extracted
// once; re-extraction happens only when `extracted_at` is cleared by hand.

export type ExtractJobResult = {
  scanned: number;
  extracted: number;
  skipped: number;
  failed: number;
  lowConfidence: number;
};

export const LOW_CONFIDENCE = 60;

export async function runExtractionJob(
  db: Db,
  caller: StructuredCaller,
  opts: { limit?: number; concurrency?: number; subcategoryId?: string } = {},
): Promise<ExtractJobResult> {
  const limit = opts.limit ?? 200;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, 8));
  const result: ExtractJobResult = { scanned: 0, extracted: 0, skipped: 0, failed: 0, lowConfidence: 0 };

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
      opts.subcategoryId
        ? and(isNull(products.extractedAt), eq(products.subcategoryId, opts.subcategoryId))
        : isNull(products.extractedAt),
    )
    .orderBy(asc(products.createdAt))
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
      const extracted = await extractProduct(
        { name: p.name, specs: p.specs, description: p.description, specTable: p.specTable },
        sub,
        caller,
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
