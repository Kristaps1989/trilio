import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { runBillingJob } from "@/services/billing/job";
import { createEmailSender } from "@/services/notify/email";
import { appBaseUrl, paymentsProvider } from "@/services/payments";
import { billingTexts } from "@/services/texts";

// Daily: charge due renewals and retries. Same bearer secret as ingestion.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !header.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: Request) {
  if (!authorized(request)) return new NextResponse(null, { status: 401 });
  const provider = paymentsProvider();
  if (!provider) return NextResponse.json({ ok: true, skipped: "payments_off" });
  const base = appBaseUrl();
  const results = await runBillingJob(db, provider, {
    email: createEmailSender(),
    texts: billingTexts(),
    urls: {
      acceptUrl: `${base}/radars`,
      cancelUrl: `${base}/radars`,
      callbackUrl: `${base}/api/payments/callback`,
    },
  });
  return NextResponse.json({ ok: true, results });
}

export function GET(request: Request) {
  return POST(request);
}
