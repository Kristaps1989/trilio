import { NextResponse } from "next/server";
import { postImage } from "@/services/social/image";

// One slide of a carousel post (docs/SOCIAL_PLAN.md §3): /api/social/{id}/2/image.jpg.

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params;
  const i = Number(n);
  if (!Number.isInteger(i) || i < 1 || i > 10) return new NextResponse(null, { status: 404 });
  return postImage(id, i);
}
