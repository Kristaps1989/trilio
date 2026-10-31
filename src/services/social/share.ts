import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { socialPosts } from "@/db/schema";
import type { PostCard } from "@/domain/social/captions";

// A Facebook link post's preview (docs/SOCIAL_PLAN.md §12): Facebook reads the
// linked page's Open Graph tags. The post's link carries utm_source=facebook
// and utm_content={post id}, so the landing page can name that post's own
// picture and words instead of the site's default share image. Only for a
// post that is approved or published (its picture is public then).

export type SharePreview = {
  title: string;
  description?: string;
  image: { url: string; width: number; height: number; alt: string };
};

type Search = Record<string, string | string[] | undefined>;

export async function sharePreview(db: Db, search: Search): Promise<SharePreview | null> {
  if (search.utm_source !== "facebook") return null;
  const id = z.uuid().safeParse(search.utm_content);
  if (!id.success) return null;
  const [p] = await db
    .select({ id: socialPosts.id, card: socialPosts.card, alt: socialPosts.alt })
    .from(socialPosts)
    .where(
      and(
        eq(socialPosts.id, id.data),
        inArray(socialPosts.status, ["approved", "published"]),
        isNull(socialPosts.videoUrl),
      ),
    );
  if (!p) return null;
  const card = p.card as unknown as PostCard;
  const first = card.slides?.[0] ?? card;
  const title = [first.headline ?? first.title, first.headlineAccent].filter(Boolean).join(" ");
  const description = first.stat ? `${first.stat.label}: ${first.stat.value}` : (first.sub ?? undefined);
  return {
    title,
    ...(description ? { description } : {}),
    image: { url: `/api/social/${p.id}/link.jpg`, width: 1200, height: 630, alt: p.alt },
  };
}
