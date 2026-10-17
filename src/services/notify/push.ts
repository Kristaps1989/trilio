import webpush from "web-push";

// Web Push (VAPID). Disabled without keys. A 404/410 from the push service
// means the subscription is gone; the caller removes it.

export type PushSubscriptionRecord = { endpoint: string; p256dh: string; auth: string };
export type PushPayload = { title: string; body: string; url: string };
export type PushResult = { ok: true } | { ok: false; reason: "disabled" | "gone" | "error"; detail?: string };

export interface PushSender {
  send(sub: PushSubscriptionRecord, payload: PushPayload): Promise<PushResult>;
}

export function pushPublicKey(env: Record<string, string | undefined> = process.env): string | null {
  return env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
}

export function createPushSender(env: Record<string, string | undefined> = process.env): PushSender {
  const pub = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = env.VAPID_PRIVATE_KEY;
  if (!pub || !priv)
    return {
      async send() {
        return { ok: false, reason: "disabled" };
      },
    };
  webpush.setVapidDetails(env.VAPID_SUBJECT ?? "mailto:noreply@trilio.lv", pub, priv);
  return {
    async send(sub, payload) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          { TTL: 24 * 3600 },
        );
        return { ok: true };
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) return { ok: false, reason: "gone" };
        return { ok: false, reason: "error", detail: (err as Error).message };
      }
    },
  };
}

export function memoryPushSender(): PushSender & {
  sent: { sub: PushSubscriptionRecord; payload: PushPayload }[];
} {
  const sent: { sub: PushSubscriptionRecord; payload: PushPayload }[] = [];
  return {
    sent,
    async send(sub, payload) {
      sent.push({ sub, payload });
      return { ok: true };
    },
  };
}
