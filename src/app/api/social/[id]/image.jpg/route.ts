import { postImage } from "@/services/social/image";

// The image of one post (docs/SOCIAL_PLAN.md §7), or a carousel's first
// slide; the others are at /api/social/{id}/{n}/image.jpg. Public once the
// post is approved (Meta fetches it), admin-only while a draft.

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return postImage((await params).id, 1);
}
