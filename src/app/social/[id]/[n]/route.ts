import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, socialPosts } from "@/db";
import { adminOrNull } from "@/app/[locale]/admin/guard";
import type { PostCard } from "@/domain/social/captions";
import { appBaseUrl } from "@/services/payments";
import { carouselCard } from "@/services/social/posts";
import { slidesOf } from "@/services/social/render";

// The share page of one carousel card (docs/SOCIAL_PLAN.md §12, 8 Nov 2026):
// /social/{id}/{n}. Facebook's crawler reads its Open Graph tags (the card's
// square picture with its size, the headline, the line), so the card has its
// picture whether Facebook honours the `picture` it was given or reads the
// link itself. A person is sent on at once to the slide's page on the site,
// with the card's tags; without a script, the same link is on the page.
// Never indexed: the site's pages are the content, this is the wrapper.
// Its og:image is always the card's own square picture on trilio.lv: Facebook
// does not take an og:image on its own CDN (8 Nov 2026, docs/FACEBOOK_CAROUSEL_PLAN.md).

export const dynamic = "force-dynamic";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; n: string }> }) {
  const { id: rawId, n } = await params;
  const id = z.uuid().safeParse(rawId);
  const i = Number(n);
  if (!id.success || !Number.isInteger(i) || i < 1 || i > 10) return new NextResponse(null, { status: 404 });
  const [p] = await db.select().from(socialPosts).where(eq(socialPosts.id, id.data));
  if (!p || p.videoUrl) return new NextResponse(null, { status: 404 });
  const open = p.status === "approved" || p.status === "published";
  if (!open && !(await adminOrNull())) return new NextResponse(null, { status: 404 });
  const slide = slidesOf(p.card as unknown as PostCard)[i - 1];
  if (!slide) return new NextResponse(null, { status: 404 });
  const card = carouselCard(appBaseUrl(), p, slide, i - 1);
  const picture = card.picture;
  const title = esc(card.name);
  const description = esc(card.description ?? p.alt ?? "");
  const target = esc(card.target);
  const html = `<!doctype html>
<html lang="lv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title} · Trilio</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="Trilio">
<meta property="og:title" content="${title}">
${description ? `<meta property="og:description" content="${description}">` : ""}
<meta property="og:image" content="${esc(picture)}">
<meta property="og:image:secure_url" content="${esc(picture)}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1080">
<meta property="og:image:height" content="1080">
<meta property="og:image:alt" content="${esc(p.alt ?? card.name)}">
<meta property="og:locale" content="lv_LV">
<meta name="twitter:card" content="summary_large_image">
<script>location.replace(${JSON.stringify(card.target)});</script>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0F2A2E;color:#EAF2EF;font:16px/1.4 system-ui,sans-serif}a{color:#D8F26B}</style>
</head>
<body>
<p><a href="${target}">${title}</a> · trilio.lv</p>
</body>
</html>`;
  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": open ? "public, max-age=300" : "private, no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
