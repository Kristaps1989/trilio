import { NextResponse, type NextRequest } from "next/server";
import { testOutbox } from "@/services/notify/email";

// Dev and CI only (ALLOW_INSECURE_TEST_FEATURES=1, never on a real deployment):
// the e-mails that would have been sent to one address, newest last, so e2e
// can open a confirmation link. 404 everywhere else.

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  if (process.env.ALLOW_INSECURE_TEST_FEATURES !== "1" || process.env.RESEND_API_KEY)
    return new NextResponse(null, { status: 404 });
  const to = (request.nextUrl.searchParams.get("to") ?? "").toLowerCase();
  const messages = testOutbox()
    .filter((m) => m.to.toLowerCase() === to)
    .map(({ to: t, subject, text }) => ({ to: t, subject, text }));
  return NextResponse.json(messages);
}
