import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, socialPosts } from "@/db";
import type { PostCard } from "@/domain/social/captions";
import { adminOrNull } from "@/app/[locale]/admin/guard";
import { renderPostJpeg } from "@/services/social/render";

// The image of one post (docs/SOCIAL_PLAN.md §7). Meta fetches it from here
// when the post goes out, so an approved or published post's image is
// public; a draft is shown to the admin only. The id is a random UUID.

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new NextResponse(null, { status: 404 });
  const [p] = await db.select().from(socialPosts).where(eq(socialPosts.id, id.data));
  if (!p || p.videoUrl) return new NextResponse(null, { status: 404 });
  const open = p.status === "approved" || p.status === "published";
  if (!open && !(await adminOrNull())) return new NextResponse(null, { status: 404 });
  const jpeg = await renderPostJpeg(p.card as unknown as PostCard);
  return new NextResponse(new Uint8Array(jpeg), {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": open ? "public, max-age=300" : "private, no-store",
    },
  });
}
