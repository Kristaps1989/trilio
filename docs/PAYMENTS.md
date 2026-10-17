# Payments and subscriptions

The "Cenu radars" subscription (1,99 €/month or 12 €/year) is billed through **Paysera Recurring Billing**. Trilio owns the subscription lifecycle; Paysera only collects money and issues a reusable card token. Card data never touches our servers: the first payment happens on Paysera's hosted page.

## How it works

| Step | Code | Paysera API |
|---|---|---|
| 1. Plan chosen → pending subscription + initial payment | `services/billing/engine.ts` `startSubscription` | `POST /checkout/rest/v1/payment-requests` with `token_strategy: "required"`; customer is redirected to `authorization_url` |
| 2. Paysera posts `notification_id=…` to our callback | `app/api/payments/callback/route.ts` | — |
| 3. We fetch and verify the event, activate, store the token encrypted | `processPaymentEvent` | `GET /notification/rest/v1/notifications/{id}` → `data.payment_request.status = "captured"`, `issued_token`; then `PUT …/notifications/{id}/read` |
| 4. Scheduler charges due renewals | `chargeDueRenewals` via `/api/cron/billing` | `POST …/payment-requests` (no token strategy) + `PUT …/payment-requests/{id}/authorize` with `{ token }` → `captured` |
| 5. Failures retry after 1, 3 and 5 days, then the subscription expires | `services/billing/dates.ts` | — |

Billing dates use calendar arithmetic (31 Jan + 1 month = 28/29 Feb). Every callback is processed once (`payment_notifications` by notification id; `payments` by order id). The token is AES-256-GCM encrypted with `PAYMENT_TOKEN_KEY` and never returned to the client or included in the GDPR export.

Authentication is Paysera's MAC scheme (`services/payments/mac.ts`): `HMAC-SHA256(mac_key, ts\nnonce\nMETHOD\nuri\nhost\n443\next\n)` with `ext=body_hash=base64(sha256(body))`.

## Going live

Recurring billing is **production-only** and must be **approved by Paysera** for the project. Do this early:

1. Create a Checkout project in the Paysera account.
2. Email support@paysera.com with the project id, requesting Recurring Billing access, and ask how they recommend testing before live charges.
3. Put the credentials they send into Railway variables: `PAYSERA_MAC_ID`, `PAYSERA_MAC_KEY`, `PAYSERA_BUSINESS_ID`. Set `APP_URL` to the public URL (callback and redirect URLs are built from it; the callback must be HTTPS and public).
4. Generate `PAYMENT_TOKEN_KEY` with `openssl rand -hex 32`. Rotating it invalidates stored tokens: customers would re-enter their card at the next renewal, so rotate only with a re-encryption script.
5. Schedule `POST /api/cron/billing` daily (Railway cron service or the ingest service after its run) with `Authorization: Bearer $CRON_SECRET`.

Until credentials exist, `PAYMENTS_PROVIDER=mock` together with `ALLOW_INSECURE_TEST_FEATURES=1` enables a fake hosted checkout (`/maksajums/mock`) for development and CI. Never set `ALLOW_INSECURE_TEST_FEATURES` on a real deployment: it also enables the passwordless dev login.

## Adding another provider

Implement `PaymentProvider` (`services/payments/types.ts`): `createPayment`, `chargeToken`, `fetchEvent`, `acknowledge`. Register it in `services/payments/index.ts`. The billing engine, the radar and the pages do not change.

## Consumer-protection notes (rule 4)

- The plan screen states the price, the interval, "atteikties var jebkurā brīdī" and that Paysera handles card data.
- Cancellation is two taps on the radar page and keeps access until the paid period ends; resume undoes it.
- Receipts and failed-payment notices are emailed; no silent charges.
