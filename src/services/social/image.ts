import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, socialPosts } from "@/db";
import type { PostCard } from "@/domain/social/captions";
import { adminOrNull } from "@/app/[locale]/admin/guard";
import { renderPostJpeg, slidesOf, type Shape } from "@/services/social/render";

// The image of one post or carousel slide (docs/SOCIAL_PLAN.md §7). Meta
// fetches it from the public URL when the post goes out, so an approved or
// published post's images are public; a draft's are for the admin only.

/** Recently drawn images, oldest first; an edited card has a new key. */
const rendered = new Map<string, Buffer>();
const MAX_CACHED = 60;

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** The JPEG of one slide (1 = the first, the only one for a single image), or a 404. */
export async function postImage(rawId: string, n: number, shape: Shape = "portrait"): Promise<NextResponse> {
  const id = z.uuid().safeParse(rawId);
  if (!id.success) return new NextResponse(null, { status: 404 });
  const [p] = await db.select().from(socialPosts).where(eq(socialPosts.id, id.data));
  if (!p || p.videoUrl) return new NextResponse(null, { status: 404 });
  const open = p.status === "approved" || p.status === "published";
  if (!open && !(await adminOrNull())) return new NextResponse(null, { status: 404 });
  const slides = slidesOf(p.card as unknown as PostCard);
  const slide = slides[n - 1];
  if (!slide) return new NextResponse(null, { status: 404 });
  // A link preview is one picture: the first slide, without a carousel's counter.
  // Drawn once per card and kept: Facebook's crawler leaves out a picture that is slow to come.
  const key = `${p.id}:${n}:${shape}:${hash(JSON.stringify(p.card))}`;
  let jpeg = rendered.get(key);
  if (!jpeg) {
    jpeg =
      shape === "link"
        ? await renderPostJpeg(slide, 0, 1, shape)
        : await renderPostJpeg(slide, n - 1, slides.length, shape);
    rendered.set(key, jpeg);
    while (rendered.size > MAX_CACHED) rendered.delete(rendered.keys().next().value!);
  }
  return new NextResponse(new Uint8Array(jpeg), {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": open ? "public, max-age=300" : "private, no-store",
    },
  });
}
