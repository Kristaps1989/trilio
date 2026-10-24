import { NextResponse } from "next/server";
import { db } from "@/db";
import { unsubscribeAlertsByToken } from "@/services/wishlist/alerts";

// RFC 8058 one-click unsubscribe from price-drop e-mails: mail clients POST
// "List-Unsubscribe=One-Click" here. A GET (a person clicking) goes to the page.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

export async function POST(_request: Request, { params }: Ctx) {
  await unsubscribeAlertsByToken(db, (await params).token);
  return new NextResponse(null, { status: 200, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request, { params }: Ctx) {
  return NextResponse.redirect(new URL(`/velmju-saraksts/atteikties/${(await params).token}`, request.url));
}
