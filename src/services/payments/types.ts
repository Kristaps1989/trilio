// Payment provider interface. The billing engine (services/billing) owns
// plans, subscriptions, renewals, retries and access; a provider only
// collects money and issues a reusable token. Paysera is the first real
// adapter (docs/PAYMENTS.md); `mock` drives tests and local development.

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
};

export interface PaymentProvider {
  readonly name: ProviderName;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  /** Server-side renewal: create a request and authorize it with the stored token. */
  chargeToken(input: Omit<CreatePaymentInput, "requestToken">, token: string): Promise<ChargeTokenResult>;
  /** Resolve a callback body to a verified event by fetching it from the provider; null when not ours. */
  fetchEvent(callbackBody: URLSearchParams): Promise<PaymentEvent | null>;
  /** Acknowledge so the provider stops retrying the callback. */
  acknowledge(notificationId: string): Promise<void>;
}
