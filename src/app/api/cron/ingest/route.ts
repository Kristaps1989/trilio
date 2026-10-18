import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { purgeOldWaitlistLeads } from "@/db/queries/waitlist";
import { ingestAllActive } from "@/services/ingestion/run";
import { createCaller, extractionEnabled } from "@/services/llm/client";
import { runExtractionJob } from "@/services/llm/extract-job";
import { appBaseUrl } from "@/services/payments";
import { runRadarJob } from "@/services/radar/job";
import { radarTexts } from "@/services/texts";

// Called by the scheduler (Vercel Cron or an external cron) with
// `Authorization: Bearer $CRON_SECRET`. Runs every active partner feed.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !header.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: Request) {
  if (!authorized(request)) return new NextResponse(null, { status: 401 });
  // Scraped shops take tens of minutes at a polite pace; the cron service
  // (`npm run ingest -- all`) runs those, not this HTTP request.
  const results = await ingestAllActive(db, { skipFeedTypes: ["scrape"] });
  // New products get attributes/tags from the extraction job (docs/LLM.md) when it is enabled.
  const extraction = extractionEnabled() ? await runExtractionJob(db, createCaller(db)) : null;
  // Price radar: evaluate every active radar against the fresh prices (docs/DATA_MODEL.md).
  const radar = await runRadarJob(db, { baseUrl: appBaseUrl(), texts: radarTexts() });
  // Privacy policy retention: waitlist entries older than 12 months.
  const waitlistPurged = await purgeOldWaitlistLeads(db);
  // Rejected samples stay in the log, not in the HTTP response.
  return NextResponse.json({
    ok: results.every((r) => r.ok),
    stores: results.map((r) => ({ ...r, rejectedSample: undefined })),
    extraction,
    radar,
    waitlistPurged,
  });
}

export function GET(request: Request) {
  return POST(request);
}
