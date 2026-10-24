import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { runHousekeeping } from "@/services/jobs/housekeeping";

// The scheduler runs this every 15 minutes in production; the route lets a
// separate cron service (or a test) run it with `Authorization: Bearer $CRON_SECRET`.

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
  const result = await runHousekeeping(db);
  return NextResponse.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
}
