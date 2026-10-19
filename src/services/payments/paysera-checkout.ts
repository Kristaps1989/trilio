import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { PaymentProvider } from "./types";

// Paysera Checkout ("Checkout Modern", developers.paysera.com/guides/checkout-modern):
//   POST /auth/realms/Paysera/protocol/openid-connect/token  client_credentials → { access_token, expires_in }
//   POST /merchant-order/integration/v1/orders                → { order_id, … }
//   POST /checkout-payment-link/integration/v1/payment-links  → { payment_URL, … }
//   callback: POST JSON to callback_url, X-Paysera-Signature = hex HMAC-SHA256(raw body, client secret)
// One-off payments only: Checkout issues no reusable card token, so the
// radar is sold as prepaid periods that the customer extends themselves.
// Amounts are integer cents; the same API serves live and Test Mode
// (a per-project switch in the Paysera account).

export type PayseraCheckoutConfig = {
  clientId: string;
  clientSecret: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
  log?: Pick<Console, "warn">;
};

const DEFAULT_API = "https://api.paysera.com";
/** How long the hosted payment page stays usable; the customer is sent there straight away. */
export const LINK_LIFETIME_S = 3600;

const TokenResponse = z.object({ access_token: z.string().min(1), expires_in: z.number().optional() });
const OrderResponse = z.object({ order_id: z.string().min(1) });
const LinkResponse = z.object({ payment_URL: z.string().url() });

const Order = z.object({
  paysera_order_id: z.string(),
  merchant_order_id: z.string(),
  status: z.string().optional(),
  amount: z.number().optional(),
  amount_paid: z.number().optional(),
  currency: z.string().optional(),
  is_test: z.boolean().optional(),
});
const Callback = z.object({ event: z.object({ type: z.string(), name: z.string() }), order: Order });

export class PayseraCheckoutError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export function payseraCheckoutFromEnv(
  env: Record<string, string | undefined> = process.env,
): PayseraCheckoutConfig | null {
  const { PAYSERA_CLIENT_ID, PAYSERA_CLIENT_SECRET } = env;
  if (!PAYSERA_CLIENT_ID || !PAYSERA_CLIENT_SECRET) return null;
  return {
    clientId: PAYSERA_CLIENT_ID,
    clientSecret: PAYSERA_CLIENT_SECRET,
    ...(env.PAYSERA_API_URL ? { apiBase: env.PAYSERA_API_URL } : {}),
  };
}

/** Constant-time check of the callback signature against the raw body. */
export function validSignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(body).digest("hex"));
  const given = Buffer.from(signature.trim().toLowerCase());
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Access tokens live an hour; one per client id is shared by every provider instance in the process.
const tokens = new Map<string, { token: string; expiresAt: number }>();

export function clearTokenCache(): void {
  tokens.clear();
}

export function createPayseraCheckoutProvider(config: PayseraCheckoutConfig): PaymentProvider {
  const api = (config.apiBase ?? DEFAULT_API).replace(/\/$/, "");
  const fetchImpl = config.fetchImpl ?? fetch;
  const log = config.log ?? console;

  async function readJson(res: Response): Promise<unknown> {
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }

  async function accessToken(): Promise<string> {
    const cached = tokens.get(config.clientId);
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    const res = await fetchImpl(`${api}/auth/realms/Paysera/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }).toString(),
      signal: AbortSignal.timeout(30_000),
    });
    const parsed = TokenResponse.safeParse(await readJson(res));
    if (!res.ok || !parsed.success) throw new PayseraCheckoutError("Paysera authentication failed", res.status);
    // Renew a minute early so a request never goes out with a token about to expire.
    const ttl = Math.max(60, (parsed.data.expires_in ?? 3600) - 60);
    tokens.set(config.clientId, { token: parsed.data.access_token, expiresAt: Date.now() + ttl * 1000 });
    return parsed.data.access_token;
  }

  async function post<T>(path: string, body: unknown, schema: z.ZodType<T>, retried = false): Promise<T> {
    const res = await fetchImpl(`${api}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await accessToken()}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const parsed = await readJson(res);
    if (res.status === 401 && !retried) {
      // Revoked or rotated token: fetch a fresh one once.
      tokens.delete(config.clientId);
      return post(path, body, schema, true);
    }
    if (!res.ok) {
      const err = parsed as { error?: string; error_description?: string } | null;
      throw new PayseraCheckoutError(
        err?.error_description ?? `Paysera HTTP ${res.status}`,
        res.status,
        err?.error,
      );
    }
    const out = schema.safeParse(parsed);
    if (!out.success) throw new PayseraCheckoutError("Unexpected Paysera response shape", res.status);
    return out.data;
  }

  return {
    name: "paysera",
    recurring: false,

    async createPayment(input) {
      // Paysera does not deduplicate orders by reference; our orderId is unique per attempt.
      const order = await post(
        "/merchant-order/integration/v1/orders",
        {
          redirect_urls: {
            success_url: input.acceptUrl,
            failure_url: input.cancelUrl,
            callback_url: input.callbackUrl,
          },
          purchase: { reference: input.orderId, amount: input.amountCents, currency: input.currency },
          metadata: { platform: "custom", platform_version: "1.0.0" },
        },
        OrderResponse,
      );
      const link = await post(
        "/checkout-payment-link/integration/v1/payment-links",
        {
          order_id: order.order_id,
          name: input.description.slice(0, 255),
          lifetime: LINK_LIFETIME_S,
          experience: { language: input.locale },
          purchase: { amount: input.amountCents },
          payment_details: { purpose: input.description.slice(0, 140) },
          payer_information: { email: input.payerEmail },
        },
        LinkResponse,
      );
      return { providerRequestId: order.order_id, redirectUrl: link.payment_URL };
    },

    async chargeToken() {
      return {
        ok: false,
        providerRequestId: null,
        reason: "Paysera Checkout has no recurring billing",
        retryable: false,
      };
    },

    async fetchEvent(callback) {
      if (!validSignature(callback.body, callback.headers.get("x-paysera-signature"), config.clientSecret)) {
        log.warn("paysera: callback with a missing or wrong signature ignored");
        return null;
      }
      let json: unknown;
      try {
        json = JSON.parse(callback.body);
      } catch {
        return null;
      }
      const parsed = Callback.safeParse(json);
      // Payment and refund events are thin duplicates of the order snapshot; split events do not apply.
      if (!parsed.success || parsed.data.event.type !== "order") return null;
      const { event, order } = parsed.data;
      const status =
        order.status === "paid"
          ? "captured"
          : order.status === "canceled" || order.status === "cancelled"
            ? "canceled"
            : null;
      if (!status) return null;
      // One id per delivery; a missing header falls back to the body hash (identical re-sends dedupe).
      const notificationId =
        callback.headers.get("x-paysera-callback-id") ??
        callback.headers.get("x-paysera-request-id") ??
        createHash("sha256").update(callback.body).digest("hex");
      return {
        notificationId,
        event: `${event.type}.${event.name}`,
        orderId: order.merchant_order_id,
        providerRequestId: order.paysera_order_id,
        status,
        amountCents: status === "captured" ? (order.amount_paid ?? order.amount ?? null) : null,
        currency: order.currency ?? null,
        issuedToken: null,
        paymentMethodLabel: null,
        test: order.is_test === true,
      };
    },

    async acknowledge() {
      // A 2xx answer to the callback is the acknowledgement.
    },
  };
}
