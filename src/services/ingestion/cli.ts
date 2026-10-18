import "dotenv/config";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { createDb } from "@/db/client";
import { stores } from "@/db/schema";
import { runAllJobs } from "@/services/jobs/all";
import { renormaliseProducts } from "./renormalise";
import { ingestStore } from "./run";

// `npm run ingest -- all [--force]`, `npm run ingest -- renormalise`
// or `npm run ingest -- <store-slug> [path/to/local-feed.xml]`
// The optional local file lets a partner's sample feed be tested before a URL exists.

async function main() {
  const [target, localFile] = process.argv.slice(2);
  if (!target) {
    console.error("usage: npm run ingest -- <store-slug|all|renormalise> [local-feed-file]");
    process.exit(2);
  }
  const { db, client } = createDb();
  try {
    if (target === "renormalise") {
      console.log("attributes re-derived for", await renormaliseProducts(db), "products");
      return;
    }
    if (target === "all") {
      // The web service schedules the same job; by default only shops that are due run.
      const result = await runAllJobs(db, { force: localFile === "--force" });
      if (!result) {
        console.log("no shop is due (each runs every 4 hours); use --force to run all now");
        return;
      }
      const { stores: results, ...rest } = result;
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
