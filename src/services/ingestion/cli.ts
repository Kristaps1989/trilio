import "dotenv/config";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { createDb } from "@/db/client";
import { stores } from "@/db/schema";
import { ingestRecentlyRan, runAllJobs } from "@/services/jobs/all";
import { ingestStore } from "./run";

// `npm run ingest -- all [--force]` or `npm run ingest -- <store-slug> [path/to/local-feed.xml]`
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
      // The web service schedules the same job; skip if it started one recently.
      if (localFile !== "--force" && (await ingestRecentlyRan(db))) {
        console.log(
          "an ingestion run is going or finished in the last 4 hours; skipping (use --force to run anyway)",
        );
        return;
      }
      const { stores: results, ...rest } = await runAllJobs(db);
      console.table(results.map((r) => ({ ...r, rejectedSample: r.rejectedSample.length })));
      console.log(rest);
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
