import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";

// Railway healthcheck target. 200 only when the app can reach the database,
// so a deploy with a bad DATABASE_URL is rolled back instead of going live.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error("db timeout")), 5_000)),
    ]);
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
