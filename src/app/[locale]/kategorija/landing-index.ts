import { unstable_cache } from "next/cache";
import { db } from "@/db";
import { getSubcategory } from "@/domain/questions/catalog";
import { landingIndex, type LandingIndex } from "@/services/seo/landing";

// Which landing pages keep their own address (docs/SEO_INDEXING_PLAN.md §2A),
// shared by the pages' metadata and the sitemap. Computed once an hour per
// category, like the pages themselves. Without a database (the build, a
// failing query) it is null and every page keeps its own address, as before.

export async function cachedLandingIndex(subId: string): Promise<LandingIndex | null> {
  const sub = getSubcategory(subId);
  if (!sub) return null;
  try {
    return await unstable_cache(() => landingIndex(db, sub), ["landing-index", subId], {
      revalidate: 3600,
    })();
  } catch (err) {
    console.error("landing index:", subId, (err as Error).message);
    return null;
  }
}
