import { and, eq, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { socialImages, socialPosts } from "@/db/schema";
import type { PostCard } from "@/domain/social/captions";
import { renderPostJpeg, slidesOf, type Shape } from "@/services/social/render";

// A post's slide pictures, drawn once and stored (docs/FACEBOOK_CAROUSEL_PLAN.md §6).

/** Recently drawn images, oldest first; an edited card has a new key. */
const rendered = new Map<string, Buffer>();
const MAX_CACHED = 60;

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

type PostRow = typeof socialPosts.$inferSelect;

/**
 * One slide's JPEG, drawn once per card and kept (docs/FACEBOOK_CAROUSEL_PLAN.md §6):
 * this instance's memory first, then the copy stored in the database (the same
 * bytes on every instance and after a restart), and only then a render, which is
 * stored for the others. Facebook fetches a card's picture once, when the post is
 * made, and leaves out one that is slow to come; a stored picture never is.
 */
export async function slideJpeg(database: Db, p: PostRow, n: number, shape: Shape): Promise<Buffer | null> {
  const slides = slidesOf(p.card as unknown as PostCard);
  const slide = slides[n - 1];
  if (!slide) return null;
  const cardHash = hash(JSON.stringify(p.card));
  const key = `${p.id}:${n}:${shape}:${cardHash}`;
  const cached = rendered.get(key);
  if (cached) return cached;
  const [stored] = await database
    .select({ jpeg: socialImages.jpeg, cardHash: socialImages.cardHash })
    .from(socialImages)
    .where(and(eq(socialImages.postId, p.id), eq(socialImages.n, n), eq(socialImages.shape, shape)))
    .catch(() => []);
  let jpeg: Buffer | null = stored && stored.cardHash === cardHash ? Buffer.from(stored.jpeg) : null;
  if (!jpeg) {
    // A link preview is one picture: the first slide, without a carousel's counter.
    jpeg =
      shape === "link"
        ? await renderPostJpeg(slide, 0, 1, shape)
        : await renderPostJpeg(slide, n - 1, slides.length, shape);
    await database
      .insert(socialImages)
      .values({ postId: p.id, n, shape, cardHash, jpeg })
      .onConflictDoUpdate({
        target: [socialImages.postId, socialImages.n, socialImages.shape],
        set: { cardHash, jpeg, createdAt: new Date() },
      })
      .catch((err) => console.error("social image: not stored", (err as Error).message));
  }
  rendered.set(key, jpeg);
  while (rendered.size > MAX_CACHED) rendered.delete(rendered.keys().next().value!);
  return jpeg;
}

/**
 * Draws and stores every picture a post will be fetched for, before it is sent:
 * each slide upright (Instagram, the photo post) and, for a carousel, square (the
 * Facebook cards); a single post's link preview. Returns how many are ready.
 */
export async function preparePostImages(database: Db, p: PostRow): Promise<number> {
  if (p.videoUrl) return 0;
  const count = slidesOf(p.card as unknown as PostCard).length;
  const jobs: [number, Shape][] = [];
  for (let n = 1; n <= count; n++) {
    jobs.push([n, "portrait"]);
    if (count > 1) jobs.push([n, "square"]);
  }
  if (count <= 1) jobs.push([1, "link"]);
  let ready = 0;
  // One at a time: drawing is heavy, and a small instance drawing five at once is what made them slow.
  for (const [n, shape] of jobs) if (await slideJpeg(database, p, n, shape).catch(() => null)) ready++;
  return ready;
}

/** Housekeeping: stored pictures of posts older than 120 days are deleted (a re-post draws them again). */
export async function purgeSocialImages(database: Db, now = new Date()): Promise<number> {
  const rows = await database
    .delete(socialImages)
    .where(lt(socialImages.createdAt, new Date(now.getTime() - 120 * 86_400_000)))
    .returning({ id: socialImages.postId });
  return rows.length;
}
