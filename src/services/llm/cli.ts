import "dotenv/config";
import { createDb } from "@/db/client";
import { createCaller, extractionEnabled } from "./client";
import { runExtractionJob } from "./extract-job";

// `npm run extract -- [limit] [subcategoryId]` — fills attributes/tags for
// products not yet extracted. Needs ANTHROPIC_API_KEY and FEATURE_LLM_EXTRACT=1.

async function main() {
  const [limitArg, subcategoryId] = process.argv.slice(2);
  if (!extractionEnabled()) {
    console.error("extraction is off: set FEATURE_LLM_EXTRACT=1 and ANTHROPIC_API_KEY");
    process.exit(2);
  }
  const { db, client } = createDb();
  try {
    const result = await runExtractionJob(db, createCaller(db), {
      limit: limitArg ? Number(limitArg) : undefined,
      subcategoryId,
    });
    console.table(result);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
