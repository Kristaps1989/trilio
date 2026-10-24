// Carrier tracking for shipped orders (docs/ADMIN_AND_OFFERS_PLAN.md §10).
// A tracker answers one question per parcel: delivered yet, and when. Only
// carriers whose business API credentials are configured are polled; the
// others rely on the admin's "Piegādāts" or the buyer's "Saņēmu preci".
//
// Omniva: GET {OMNIVA_API_URL}/api/v01/omx/shipments/{barcode} with HTTP
// Basic auth and X-Integration-Agent-Id (developer.omniva.ee, "Track and
// Trace"), at most 5 requests per 5 minutes. The API does not document which
// event code means delivered, so OMNIVA_DELIVERED_EVENT_CODES lists them
// (from Omniva's integration team); until then the event name is matched.

export type TrackResult = { delivered: boolean; at: Date | null; lastEvent: string | null };

export interface CarrierTracker {
  readonly carrier: string;
  /** Requests a run may make (carrier rate limits). */
  readonly perRun: number;
  track(number: string): Promise<TrackResult | null>;
}

type OmnivaEvent = { eventCode?: string; eventName?: string; eventDate?: string };

const DELIVERED_NAME = /deliver|izsniegt|piegādāt|väljasta|įteik|выдан|вручен/i;

export function omnivaResult(body: unknown, deliveredCodes: string[]): TrackResult | null {
  const events = (body as { events?: OmnivaEvent[] } | null)?.events;
  if (!Array.isArray(events)) return null;
  const sorted = [...events].sort((a, b) => String(a.eventDate).localeCompare(String(b.eventDate)));
  const last = sorted.at(-1);
  const done = sorted.find((e) =>
    deliveredCodes.length
      ? deliveredCodes.includes(String(e.eventCode))
      : DELIVERED_NAME.test(e.eventName ?? ""),
  );
  const at = done?.eventDate ? new Date(done.eventDate) : null;
  return {
    delivered: !!done,
    at: at && !Number.isNaN(at.getTime()) ? at : null,
    lastEvent: last?.eventName ?? null,
  };
}

export function omnivaTracker(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): CarrierTracker | null {
  const base = env.OMNIVA_API_URL?.replace(/\/$/, "");
  const user = env.OMNIVA_USERNAME;
  const pass = env.OMNIVA_PASSWORD;
  if (!base || !user || !pass) return null;
  const codes = (env.OMNIVA_DELIVERED_EVENT_CODES ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const auth = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  return {
    carrier: "omniva",
    perRun: 5,
    async track(number) {
      try {
        const res = await fetchImpl(`${base}/api/v01/omx/shipments/${encodeURIComponent(number)}`, {
          headers: {
            authorization: auth,
            accept: "application/json",
            "X-Integration-Agent-Id": env.OMNIVA_INTEGRATION_AGENT_ID ?? "trilio",
          },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return null;
        return omnivaResult(await res.json(), codes);
      } catch {
        return null;
      }
    },
  };
}

export function trackersFromEnv(env: Record<string, string | undefined> = process.env): CarrierTracker[] {
  return [omnivaTracker(env)].filter((t): t is CarrierTracker => t !== null);
}
