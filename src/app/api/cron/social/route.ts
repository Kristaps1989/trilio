import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { runSocialJob } from "@/services/social/job";

// The social posts job (docs/SOCIAL_PLAN.md §7) for an outside cron service or
// a test; the web service's own scheduler runs it every 15 minutes anyway.

export const dynamic = "force-dynamic";

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
  const result = await runSocialJob(db);
  return NextResponse.json({ ok: true, result }, { headers: { "cache-control": "no-store" } });
}
