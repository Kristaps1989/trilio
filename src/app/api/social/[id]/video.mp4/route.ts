import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, socialPosts } from "@/db";
import { adminOrNull } from "@/app/[locale]/admin/guard";
import { postVideo } from "@/services/social/video";

// A generated Reel's video (docs/SOCIAL_PLAN.md §14). Meta fetches it from this public address
// when the post goes out, so an approved or published post's video is public; a draft's is for
// the admin only. A post without a generated video, or a server without ffmpeg, answers 404.

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new NextResponse(null, { status: 404 });
  const [p] = await db.select().from(socialPosts).where(eq(socialPosts.id, id.data));
  if (!p) return new NextResponse(null, { status: 404 });
  const open = p.status === "approved" || p.status === "published";
  if (!open && !(await adminOrNull())) return new NextResponse(null, { status: 404 });
  const video = await postVideo(db, p);
  if (!video) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(video), {
    headers: {
      "content-type": "video/mp4",
      "content-length": String(video.length),
      "cache-control": open ? "public, max-age=300" : "private, no-store",
    },
  });
}
