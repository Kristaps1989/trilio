// Payment provider interface. The billing engine (services/billing) owns
// plans, subscriptions, renewals, retries and access; a provider only
// collects money and, when it supports recurring billing, issues a reusable
// token. Paysera Checkout (one-off payments, prepaid periods) and Paysera
// Recurring Billing are the real adapters (docs/PAYMENTS.md); `mock` drives
// tests and local development.

export type ProviderName = "paysera" | "mock";

export type CreatePaymentInput = {
  /** Our unique order reference; the idempotency key across callbacks. */
  orderId: string;
  amountCents: number;
  currency: "EUR";
  description: string;
  payerEmail: string;
  locale: string;
  acceptUrl: string;
  cancelUrl: string;
  callbackUrl: string;
  /** Initial payment of a subscription asks for a reusable token. */
  requestToken: boolean;
};

export type CreatePaymentResult = {
  providerRequestId: string;
  /** Hosted checkout page to redirect the customer to (initial payments only). */
  redirectUrl: string | null;
};

export type ChargeTokenResult =
  | { ok: true; providerRequestId: string; capturedAt: Date; paymentMethodLabel: string | null }
  | { ok: false; providerRequestId: string | null; reason: string; retryable: boolean };

export type PaymentEvent = {
  /** Provider's notification id; processed once. */
  notificationId: string;
  event: string;
  orderId: string;
  providerRequestId: string;
  status: "captured" | "canceled" | "new" | "other";
  amountCents: number | null;
  currency: string | null;
  /** Reusable recurring billing token when the provider issued one. */
  issuedToken: string | null;
  paymentMethodLabel: string | null;
  /** A payment made while the provider's project is in test mode (no real money). */
  test?: boolean;
};

/** What our callback route received, passed to the provider unparsed (signatures cover the raw body). */
export type CallbackRequest = { body: string; headers: Headers };

export interface PaymentProvider {
  readonly name: ProviderName;
  /**
   * True when the provider can charge a stored token (automatic renewals).
   * False: every period is a separate one-off payment, the customer extends
   * it themselves and nothing is ever charged automatically.
   */
  readonly recurring: boolean;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  /** Server-side renewal: create a request and authorize it with the stored token. */
  chargeToken(input: Omit<CreatePaymentInput, "requestToken">, token: string): Promise<ChargeTokenResult>;
  /** Resolve a callback to a verified event (signature or fetch from the provider); null when not ours or not relevant. */
  fetchEvent(callback: CallbackRequest): Promise<PaymentEvent | null>;
  /** Acknowledge so the provider stops retrying the callback. */
  acknowledge(notificationId: string): Promise<void>;
}
