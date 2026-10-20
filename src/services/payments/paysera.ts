import { z } from "zod";
import { authorizationHeader, type MacCredentials } from "./mac";
import type { CreatePaymentInput, PaymentProvider } from "./types";

// Paysera Recurring Billing (developers.paysera.com/api/recurring-billing),
// MAC credentials from Paysera support. Most merchants get Paysera Checkout
// (OAuth client id + secret, one-off payments) instead: paysera-checkout.ts.
//   POST /checkout/rest/v1/payment-requests            → { id, status, authorization_url, … }
//   PUT  /checkout/rest/v1/payment-requests/{id}/authorize { token } → { status: "captured", captured_at, … }
//   callback: POST form "notification_id=…" to callback_url
//   GET  /notification/rest/v1/notifications/{id}      → { event, status, data: { payment_request: {…, issued_token} } }
//   PUT  /notification/rest/v1/notifications/{id}/read
// Recurring billing is production-only and needs Paysera's approval; the
// mock provider covers tests. Amounts are integer cents.

export type PayseraConfig = MacCredentials & {
  businessId: string;
  checkoutBase?: string;
  notificationBase?: string;
  fetchImpl?: typeof fetch;
};

const DEFAULT_CHECKOUT = "https://checkout-eu-a.paysera.com/checkout/rest/v1";
const DEFAULT_NOTIFICATION = "https://checkout-eu-a.paysera.com/notification/rest/v1";

const CreateResponse = z.object({
  id: z.string(),
  status: z.string(),
  authorization_url: z.string().url().optional().nullable(),
});

const AuthorizeResponse = z.object({
  id: z.string(),
  status: z.string(),
  captured_at: z.string().optional().nullable(),
  payer: z.object({ account_number: z.string().optional().nullable() }).partial().optional().nullable(),
});

const NotificationResponse = z.object({
  id: z.string().optional(),
  event: z.string(),
  status: z.string().optional(),
  data: z.object({
    payment_request: z.object({
      id: z.string(),
      status: z.string(),
      order_id: z.string(),
      price: z.object({ amount: z.number(), currency: z.string() }).optional().nullable(),
      price_paid: z.object({ amount: z.number(), currency: z.string() }).optional().nullable(),
      issued_token: z.string().optional().nullable(),
      payer: z.object({ account_number: z.string().optional().nullable() }).partial().optional().nullable(),
    }),
  }),
});

export class PayseraError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export function payseraFromEnv(env: Record<string, string | undefined> = process.env): PayseraConfig | null {
  const { PAYSERA_MAC_ID, PAYSERA_MAC_KEY, PAYSERA_BUSINESS_ID } = env;
  if (!PAYSERA_MAC_ID || !PAYSERA_MAC_KEY || !PAYSERA_BUSINESS_ID) return null;
  return { macId: PAYSERA_MAC_ID, macKey: PAYSERA_MAC_KEY, businessId: PAYSERA_BUSINESS_ID };
}

function cardLabel(accountNumber: string | null | undefined): string | null {
  if (!accountNumber) return null;
  const last4 = accountNumber.replace(/\D/g, "").slice(-4);
  return last4 ? `•••• ${last4}` : null;
}

export function createPayseraProvider(config: PayseraConfig): PaymentProvider {
  const checkout = config.checkoutBase ?? DEFAULT_CHECKOUT;
  const notification = config.notificationBase ?? DEFAULT_NOTIFICATION;
  const fetchImpl = config.fetchImpl ?? fetch;

  async function call<T>(
    method: "GET" | "POST" | "PUT",
    url: string,
    body: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const u = new URL(url);
    const json = body === undefined ? null : JSON.stringify(body);
    const res = await fetchImpl(u, {
      method,
      headers: {
        authorization: authorizationHeader(config, method, u, json),
        accept: "application/json",
        ...(json ? { "content-type": "application/json" } : {}),
      },
      body: json ?? undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      const err = parsed as { error?: string; error_description?: string } | null;
      throw new PayseraError(err?.error_description ?? `Paysera HTTP ${res.status}`, res.status, err?.error);
    }
    const out = schema.safeParse(parsed);
    if (!out.success) throw new PayseraError("Unexpected Paysera response shape", res.status);
    return out.data;
  }

  function requestBody(input: Omit<CreatePaymentInput, "requestToken">, requestToken: boolean) {
    return {
      business_id: config.businessId,
      order_id: input.orderId,
      price: { amount: input.amountCents, currency: input.currency },
      description: input.description,
      payer: { email: input.payerEmail },
      locale: input.locale,
      accept_url: input.acceptUrl,
      cancel_url: input.cancelUrl,
      callback_url: input.callbackUrl,
      method_key: "card",
      ...(requestToken ? { token_strategy: "required" } : {}),
    };
  }

  return {
    name: "paysera",
    recurring: true,

    async createPayment(input) {
      const r = await call(
        "POST",
        `${checkout}/payment-requests`,
        requestBody(input, input.requestToken),
        CreateResponse,
      );
      return { providerRequestId: r.id, redirectUrl: r.authorization_url ?? null };
    },

    async chargeToken(input, token) {
      let requestId: string | null = null;
      try {
        const created = await call(
          "POST",
          `${checkout}/payment-requests`,
          requestBody(input, false),
          CreateResponse,
        );
        requestId = created.id;
        const r = await call(
          "PUT",
          `${checkout}/payment-requests/${created.id}/authorize`,
          { token },
          AuthorizeResponse,
        );
        if (r.status !== "captured") {
          return { ok: false, providerRequestId: requestId, reason: `status ${r.status}`, retryable: true };
        }
        return {
          ok: true,
          providerRequestId: r.id,
          capturedAt: r.captured_at ? new Date(r.captured_at) : new Date(),
          paymentMethodLabel: cardLabel(r.payer?.account_number),
        };
      } catch (err) {
        if (err instanceof PayseraError) {
          // 4xx other than rate limiting means the token or request is bad; 5xx is worth a retry.
          const retryable = err.status >= 500 || err.status === 429;
          return {
            ok: false,
            providerRequestId: requestId,
            reason: `${err.status} ${err.code ?? err.message}`,
            retryable,
          };
        }
        return { ok: false, providerRequestId: requestId, reason: (err as Error).message, retryable: true };
      }
    },

    async fetchEvent(callback) {
      const id = new URLSearchParams(callback.body.slice(0, 4096)).get("notification_id");
      if (!id || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
      const n = await call("GET", `${notification}/notifications/${id}`, undefined, NotificationResponse);
      const pr = n.data.payment_request;
      const price = pr.price_paid ?? pr.price ?? null;
      return {
        notificationId: n.id ?? id,
        event: n.event,
        orderId: pr.order_id,
        providerRequestId: pr.id,
        status:
          pr.status === "captured"
            ? "captured"
            : pr.status === "canceled"
              ? "canceled"
              : pr.status === "new"
                ? "new"
                : "other",
        amountCents: price?.amount ?? null,
        currency: price?.currency ?? null,
        issuedToken: pr.issued_token ?? null,
        paymentMethodLabel: cardLabel(pr.payer?.account_number),
      };
    },

    async acknowledge(notificationId) {
      await call("PUT", `${notification}/notifications/${notificationId}/read`, {}, z.unknown());
    },
  };
}
