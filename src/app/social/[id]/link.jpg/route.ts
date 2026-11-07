import { postImage } from "@/services/social/image";

// A post's link preview picture (1200 × 630), named in the landing page's Open
// Graph tags when Facebook fetches a link post (docs/SOCIAL_PLAN.md §12). It
// lives outside /api/ because robots.txt closes /api/ and Facebook's crawler
// honours it: a picture there was left out of the preview. The old address
// under /api/social/ still answers, for previews already cached with it.

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return postImage(id, 1, "link");
}
