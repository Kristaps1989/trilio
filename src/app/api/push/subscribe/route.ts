import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUserId } from "@/auth";
import { db, pushSubscriptions } from "@/db";

// Web Push subscription per user and device. The browser's PushSubscription
// JSON is stored as is; VAPID keys never leave the server.

export const dynamic = "force-dynamic";

const Body = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({ p256dh: z.string().min(1).max(512), auth: z.string().min(1).max(512) }),
});

export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "auth" }, { status: 401 });
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: body.data.endpoint,
      p256dh: body.data.keys.p256dh,
      auth: body.data.keys.auth,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, p256dh: body.data.keys.p256dh, auth: body.data.keys.auth },
    });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "auth" }, { status: 401 });
  const body = z.object({ endpoint: z.string().url() }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, body.data.endpoint)));
  return NextResponse.json({ ok: true });
}
