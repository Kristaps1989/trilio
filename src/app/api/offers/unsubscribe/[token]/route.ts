import { NextResponse } from "next/server";
import { db } from "@/db";
import { unsubscribeByToken } from "@/services/offers/offers";

// RFC 8058 one-click unsubscribe: mail clients POST "List-Unsubscribe=One-Click"
// to the List-Unsubscribe address. A GET (a person clicking) goes to the page.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

export async function POST(_request: Request, { params }: Ctx) {
  await unsubscribeByToken(db, (await params).token);
  return new NextResponse(null, { status: 200, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request, { params }: Ctx) {
  return NextResponse.redirect(new URL(`/piedavajumi/atteikties/${(await params).token}`, request.url));
}
