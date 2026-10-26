import { after, NextResponse } from "next/server";
import { db } from "@/db";
import { PIXEL_GIF } from "@/domain/growth/tv";
import { recordTvImpression } from "@/services/growth/tv";
import { clientKey } from "@/services/rate-limit";

// Trilio's third-party impression tracker for addressable TV (Go3). Go3's ad
// server requests it for every impression it inserts, with the viewer's device
// id in ?vid= and a cache-buster in ?ord=. The answer is always the 1×1 image,
// at once; counting happens after it, so a slow database never delays an ad.

export const dynamic = "force-dynamic";

function pixel(): NextResponse {
  return new NextResponse(new Uint8Array(PIXEL_GIF), {
    status: 200,
    headers: {
      "content-type": "image/gif",
      "content-length": String(PIXEL_GIF.length),
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      "x-robots-tag": "noindex",
    },
  });
}

export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const url = new URL(request.url);
  const input = {
    slug: slug.replace(/\.gif$/i, "").toLowerCase(),
    vid: url.searchParams.get("vid"),
    ip: clientKey(request) === "unknown" ? null : clientKey(request),
    userAgent: request.headers.get("user-agent"),
  };
  after(() =>
    recordTvImpression(db, input).catch((err) => console.error("tv pixel:", (err as Error).message)),
  );
  return pixel();
}

export async function HEAD() {
  return pixel();
}
