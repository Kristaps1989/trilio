import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { products } from "@/db/schema";
import { getSubcategory } from "@/domain/questions/catalog";
import { type StructuredCaller, llmModel } from "./client";
import { extractProduct, mergeExtraction } from "./extract";

// Background job: fill attributes and tags for products that have none yet.
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
      tags: products.tags,
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
      if (!sub || (!p.description && !p.specs)) {
        // Nothing to read from: mark as done so it is not retried every run.
        await db
          .update(products)
          .set({ extractedAt: new Date(), extractionConfidence: 0, extractionModel: "none" })
          .where(eq(products.id, p.id));
        result.skipped++;
        continue;
      }
      const extracted = await extractProduct(
        { name: p.name, specs: p.specs, description: p.description },
        sub,
        caller,
      );
      if (!extracted) {
        result.failed++;
        continue; // left for the next run (cap, transient error)
      }
      const merged = mergeExtraction({ attributes: p.attributes, tags: p.tags }, extracted);
      await db
        .update(products)
        .set({
          attributes: merged.attributes,
          tags: merged.tags,
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
