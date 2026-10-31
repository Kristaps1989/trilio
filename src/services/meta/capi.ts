import { createHash, randomUUID } from "node:crypto";

// Meta Conversions API (docs/META_ADS_PLAN.md §2): the server's copy of an
// event the browser Pixel also sends, with the same event_id so Meta counts
// it once. Sent only for a visitor who accepted cookies ("Atļaut"); a visitor
// who declined sends nothing, from the browser or from here. Personal data
// leaves only hashed (SHA-256), as Meta asks. Failures never reach the
// visitor: the request they made is already saved.

export type CapiConfig = { pixelId: string; token: string; version: string; testCode: string | null };

export function capiConfigFromEnv(env: Record<string, string | undefined> = process.env): CapiConfig | null {
  const pixelId = (env.META_PIXEL_ID ?? "").trim();
  const token = (env.META_CAPI_TOKEN ?? "").trim();
  if (!/^\d{10,20}$/.test(pixelId) || !token) return null;
  return {
    pixelId,
    token,
    version: env.META_GRAPH_VERSION?.trim() || "v23.0",
    testCode: env.META_CAPI_TEST_CODE?.trim() || null,
  };
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** Meta's normalisation for an e-mail before hashing: trimmed, lower case. */
export const hashEmail = (email: string) => sha256(email.trim().toLowerCase());

export const newEventId = () => randomUUID();

export type CapiEvent = {
  name: "Lead" | "ViewContent" | "PageView";
  eventId: string;
  /** The page the event happened on, without its query string. */
  url: string;
  ip: string | null;
  userAgent: string | null;
  email?: string | null;
  /** The Pixel's own cookies: `_fbp` (browser id) and `_fbc` (the ad click id). */
  fbp?: string | null;
  fbc?: string | null;
  category?: string | null;
  now?: Date;
};

/** The request body Meta's /{pixel}/events endpoint takes. */
export function capiBody(cfg: CapiConfig, e: CapiEvent): Record<string, unknown> {
  const userData: Record<string, unknown> = {};
  if (e.email) userData.em = [hashEmail(e.email)];
  if (e.ip && e.ip !== "unknown") userData.client_ip_address = e.ip;
  if (e.userAgent) userData.client_user_agent = e.userAgent;
  if (e.fbp) userData.fbp = e.fbp;
  if (e.fbc) userData.fbc = e.fbc;
  return {
    data: [
      {
        event_name: e.name,
        event_time: Math.floor((e.now ?? new Date()).getTime() / 1000),
        event_id: e.eventId,
        action_source: "website",
        event_source_url: e.url,
        user_data: userData,
        ...(e.category ? { custom_data: { content_category: e.category } } : {}),
      },
    ],
    ...(cfg.testCode ? { test_event_code: cfg.testCode } : {}),
  };
}

/** Sends one event; true when Meta accepted it. Never throws. */
export async function sendCapiEvent(
  cfg: CapiConfig | null,
  e: CapiEvent,
  http: typeof fetch = fetch,
): Promise<boolean> {
  if (!cfg) return false;
  try {
    const res = await http(
      `https://graph.facebook.com/${cfg.version}/${cfg.pixelId}/events?access_token=${encodeURIComponent(cfg.token)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(capiBody(cfg, e)),
        signal: AbortSignal.timeout(8_000),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}
