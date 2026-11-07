import { NextResponse } from "next/server";
import { postImage } from "@/services/social/image";

// One slide as a square card picture for a Facebook link carousel
// (docs/SOCIAL_PLAN.md §12): /social/{id}/2/square.jpg. Outside /api/, like
// the link preview picture: robots.txt closes /api/ and Facebook's crawler
// honours it, so a card picture there was left out (7 Nov 2026). The old
// address under /api/social/ still answers.

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params;
  const i = Number(n);
  if (!Number.isInteger(i) || i < 1 || i > 10) return new NextResponse(null, { status: 404 });
  return postImage(id, i, "square");
}
