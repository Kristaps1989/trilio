import type { Db } from "@/db/client";
import { siteUrl } from "@/services/ads/account";
import { createCaller } from "@/services/llm/client";
import { socialProvider } from "./index";
import { draftUpcoming, publishDue, syncInsights, type SocialDeps } from "./posts";

// The scheduler's hook (docs/SOCIAL_PLAN.md §7): every tick drafts the coming
// day's slots, sends what is due and, once a day, pulls the numbers. With
// FEATURE_SOCIAL off nothing runs at all.

export function socialDeps(db: Db): SocialDeps | null {
  const provider = socialProvider();
  if (!provider) return null;
  return { provider, baseUrl: siteUrl(), caller: process.env.ANTHROPIC_API_KEY ? createCaller(db) : null };
}

export async function runSocialJob(db: Db, now = new Date()) {
  const deps = socialDeps(db);
  if (!deps) return null;
  const drafted = await draftUpcoming(db, deps, now);
  const sent = await publishDue(db, deps, now);
  const insights = await syncInsights(db, deps, now);
  return { drafted, ...sent, insights };
}
