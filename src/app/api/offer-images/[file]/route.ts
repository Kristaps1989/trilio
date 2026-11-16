import { NextResponse } from "next/server";
import { db } from "@/db";
import { imageBytes } from "@/services/offers/images";

// An offer's picture (docs/ALTERNATIVE_OFFER_PLAN.md §3.4): Trilio's own copy, so
// e-mails and the offer page never load a third-party server. The address is a
// random id; the picture shows a product, never a person's data.

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const m = /^([0-9a-f-]{36})\.jpg$/i.exec((await params).file);
  const bytes = m ? await imageBytes(db, m[1]!) : null;
  if (!bytes) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": "image/jpeg",
      "content-length": String(bytes.length),
      "cache-control": "public, max-age=86400, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
