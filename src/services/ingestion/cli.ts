import "dotenv/config";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { createDb } from "@/db/client";
import { stores } from "@/db/schema";
import { createCaller, extractionEnabled } from "@/services/llm/client";
import { runExtractionJob } from "@/services/llm/extract-job";
import { ingestAllActive, ingestStore } from "./run";

// `npm run ingest -- all` or `npm run ingest -- <store-slug> [path/to/local-feed.xml]`
// The optional local file lets a partner's sample feed be tested before a URL exists.

async function main() {
  const [target, localFile] = process.argv.slice(2);
  if (!target) {
    console.error("usage: npm run ingest -- <store-slug|all> [local-feed-file]");
    process.exit(2);
  }
  const { db, client } = createDb();
  try {
    if (target === "all") {
      console.table(await ingestAllActive(db));
      // The Railway cron service runs this; new products get attributes when extraction is on.
      if (extractionEnabled()) console.table(await runExtractionJob(db, createCaller(db)));
      return;
    }
    const [store] = await db.select().from(stores).where(eq(stores.slug, target));
    if (!store) throw new Error(`unknown store ${target}`);
    const result = await ingestStore(
      db,
      store,
      localFile ? { loadBody: async () => readFileSync(localFile, "utf8") } : {},
    );
    const { rejectedSample, ...summary } = result;
    console.table(summary);
    if (rejectedSample.length) console.log("rejected (first 20):", rejectedSample);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
