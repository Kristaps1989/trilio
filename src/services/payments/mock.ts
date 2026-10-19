import { randomUUID } from "node:crypto";
import type { ChargeTokenResult, PaymentEvent, PaymentProvider } from "./types";

// Mock provider for development and CI: the "hosted checkout" is our own
// /maksajums/mock page, which immediately posts a captured notification to
// the callback URL. Tokens starting with "fail-" decline renewals, so the
// retry and suspension paths are testable. Like Paysera Checkout it is
// prepaid by default (no token, no automatic renewal); `recurring: true`
// mimics Recurring Billing. Never enabled in production
// (see services/payments/index.ts).

export type MockState = {
  requests: Map<
    string,
    { orderId: string; amountCents: number; currency: string; callbackUrl: string; token: boolean }
  >;
  notifications: Map<string, PaymentEvent>;
  acknowledged: Set<string>;
};

declare global {
  var __trilioMockPayments: MockState | undefined;
}

export function mockState(): MockState {
  if (!globalThis.__trilioMockPayments) {
    globalThis.__trilioMockPayments = {
      requests: new Map(),
      notifications: new Map(),
      acknowledged: new Set(),
    };
  }
  return globalThis.__trilioMockPayments;
}

/** Simulates the customer paying on the hosted page: records a captured notification and returns its id. */
export function mockComplete(
  providerRequestId: string,
  outcome: "captured" | "canceled" = "captured",
): string | null {
  const st = mockState();
  const req = st.requests.get(providerRequestId);
  if (!req) return null;
  const notificationId = `mock-n-${randomUUID()}`;
  st.notifications.set(notificationId, {
    notificationId,
    event: outcome === "captured" ? "payment_request.captured" : "payment_request.canceled",
    orderId: req.orderId,
    providerRequestId,
    status: outcome,
    amountCents: req.amountCents,
    currency: req.currency,
    issuedToken: outcome === "captured" && req.token ? `mock-token-${randomUUID()}` : null,
    paymentMethodLabel: outcome === "captured" ? "•••• 4242" : null,
  });
  return notificationId;
}

export function createMockProvider(baseUrl: string, opts: { recurring?: boolean } = {}): PaymentProvider {
  const recurring = opts.recurring ?? false;
  return {
    name: "mock",
    recurring,
    async createPayment(input) {
      const id = `mock-pr-${randomUUID()}`;
      mockState().requests.set(id, {
        orderId: input.orderId,
        amountCents: input.amountCents,
        currency: input.currency,
        callbackUrl: input.callbackUrl,
        token: recurring && input.requestToken,
      });
      const redirect = new URL("/maksajums/mock", baseUrl);
      redirect.searchParams.set("request", id);
      redirect.searchParams.set("accept", input.acceptUrl);
      redirect.searchParams.set("cancel", input.cancelUrl);
      return { providerRequestId: id, redirectUrl: redirect.toString() };
    },
    async chargeToken(input, token): Promise<ChargeTokenResult> {
      const id = `mock-pr-${randomUUID()}`;
      if (token.startsWith("fail-"))
        return { ok: false, providerRequestId: id, reason: "declined", retryable: true };
      if (token.startsWith("dead-"))
        return { ok: false, providerRequestId: id, reason: "token_expired", retryable: false };
      return { ok: true, providerRequestId: id, capturedAt: new Date(), paymentMethodLabel: "•••• 4242" };
    },
    async fetchEvent(callback) {
      const id = new URLSearchParams(callback.body).get("notification_id");
      return (id && mockState().notifications.get(id)) || null;
    },
    async acknowledge(notificationId) {
      mockState().acknowledged.add(notificationId);
    },
  };
}
