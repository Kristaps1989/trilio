import { postImage } from "@/services/social/image";

// A post's link preview picture (1200 × 630): the landing page names it in its
// Open Graph tags when Facebook fetches a post's link (docs/SOCIAL_PLAN.md §12).

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return postImage(id, 1, "link");
}
