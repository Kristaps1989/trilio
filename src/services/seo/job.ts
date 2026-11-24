import type { Db } from "@/db/client";
import { rigaDay } from "@/domain/analytics/visits";
import { appliesItself } from "@/domain/ads/guardrails";
import { getSettings } from "@/services/ads/account";
import { createCaller, type StructuredCaller } from "@/services/llm/client";
import { runSeoAgent, seoOverrideFor, seoRunDue, type SeoRun } from "./agent";
import { landingTemplateMeta } from "./landing-meta";

/** The weekly run's day and hour (Riga): Monday, after the Google optimiser has pulled Search Console. */
export const SEO_RUN = { weekday: "Mon", hour: 7 };

const riga = (d: Date) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Riga",
      weekday: "short",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { weekday: String(parts.weekday), hour: Number(parts.hour) };
};

/**
 * The scheduler's hook for the SEO agent: once on Mondays from 07:00 Riga time (or now with
 * `force`). A checked text goes live by itself in the owner's "manage" mode; in any other
 * mode it waits on Reklāma → SEO for approval.
 */
export async function runSeoJob(
  db: Db,
  opts: { force?: boolean; now?: Date; caller?: StructuredCaller } = {},
): Promise<SeoRun | null> {
  const now = opts.now ?? new Date();
  const clock = riga(now);
  if (!opts.force && (clock.weekday !== SEO_RUN.weekday || clock.hour < SEO_RUN.hour)) return null;
  if (!opts.force && !(await seoRunDue(db, rigaDay(now)))) return null;
  const settings = await getSettings(db);
  const year = Number(rigaDay(now).slice(0, 4));
  return runSeoAgent(db, {
    caller: opts.caller ?? createCaller(db),
    apply: appliesItself({ ...settings, autoActions: [] }, "seo"),
    // What the page shows today: the agent's last kept text, or the template's.
    current: async (path) => {
      const o = await seoOverrideFor(db, path);
      return o ? { title: o.title, description: o.description } : landingTemplateMeta(path, year);
    },
    now,
  });
}
