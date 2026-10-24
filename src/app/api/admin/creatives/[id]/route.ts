import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { adCreatives, db } from "@/db";
import { adminOrNull } from "@/app/[locale]/admin/guard";
import { liveFacts, renderCreative } from "@/services/ads/creatives";

// The preview of one image creative, rendered from the brand template with
// today's numbers; admin only (docs/GROWTH_PLAN.md, Phase 3).

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adminOrNull())) return new NextResponse(null, { status: 404 });
  const id = z
    .string()
    .uuid()
    .safeParse((await params).id);
  if (!id.success) return new NextResponse(null, { status: 404 });
  const [c] = await db.select().from(adCreatives).where(eq(adCreatives.id, id.data));
  if (!c || c.kind !== "image") return new NextResponse(null, { status: 404 });
  const res = await renderCreative(c, await liveFacts(db, c.subcategoryId));
  return new NextResponse(res.body, {
    headers: { "content-type": "image/png", "cache-control": "private, no-store" },
  });
}
