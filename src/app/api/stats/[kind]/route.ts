import { NextResponse } from "next/server";
import { db } from "@/db";
import { siteStatsJson, statsAuthorised, tvStatsJson } from "@/services/admin/stats-api";

// GET /api/stats/tv?periods=7 and /api/stats/site?periods=7 (src/services/admin/stats-api.ts):
// the admin's aggregates as JSON for the owner's assistant, with
// "Authorization: Bearer <STATS_API_TOKEN>". Without the variable set, or
// with a wrong token, the address does not exist (404).

export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ kind: string }> }) {
  if (!statsAuthorised(request.headers.get("authorization"))) return new NextResponse(null, { status: 404 });
  const { kind } = await ctx.params;
  const periods = new URL(request.url).searchParams.get("periods");
  const body =
    kind === "tv"
      ? await tvStatsJson(db, periods)
      : kind === "site"
        ? await siteStatsJson(db, periods)
        : null;
  if (!body) return new NextResponse(null, { status: 404 });
  return NextResponse.json(body, {
    headers: { "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}
