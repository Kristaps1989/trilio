# Payments

Trilio takes **one-off payments for its own personal offers** (docs/ADMIN_AND_OFFERS_PLAN.md). Card data never touches our servers: the payment happens on Paysera's hosted page.

The paid price-alert plan ("Cenu radars", later "Cenu paziņojumi") is **removed** (owner, 30 Oct 2026; docs/PRICE_NOTIFY_PLAN.md §4): price e-mails are free, there are no subscriptions, renewals or billing cron. The `plans`, `subscriptions` and notify-settings tables stay in the database until the owner confirms no active subscription is left (Admin → Lietotāji shows the "service" column), then a migration drops them.

## How it works

| Step | Code | Paysera API |
|---|---|---|
| 1. The buyer places an order for an offer → payment request | `services/offers/orders.ts` `startOrderPayment` | `POST /checkout/rest/v1/payment-requests`; the buyer is redirected to `authorization_url` |
| 2. Paysera posts `notification_id=…` to our callback | `app/api/payments/callback/route.ts` | — |
| 3. We fetch and verify the event and mark the order paid | `services/payments/process.ts` `processPaymentEvent` | `GET /notification/rest/v1/notifications/{id}` → `data.payment_request.status = "captured"`; then `PUT …/notifications/{id}/read` |

Every callback is processed once (`payment_notifications` by notification id; `payments` by order id). An event for anything other than an offer order is ignored.

Authentication is Paysera's MAC scheme (`services/payments/mac.ts`): `HMAC-SHA256(mac_key, ts\nnonce\nMETHOD\nuri\nhost\n443\next\n)` with `ext=body_hash=base64(sha256(body))`.

## Going live

Paysera Checkout must be **approved by Paysera** for the project. Do this early:

1. Create a Checkout project in the Paysera account.
2. Email support@paysera.com with the project id and ask how they recommend testing before live charges.
3. Put the credentials they send into Railway variables: `PAYSERA_MAC_ID`, `PAYSERA_MAC_KEY`, `PAYSERA_BUSINESS_ID`. Set `APP_URL` to the public URL (callback and redirect URLs are built from it; the callback must be HTTPS and public).
4. Generate `PAYMENT_TOKEN_KEY` with `openssl rand -hex 32` (it encrypts any token a provider returns; one-off payments store none).

Until credentials exist, `PAYMENTS_PROVIDER=mock` together with `ALLOW_INSECURE_TEST_FEATURES=1` enables a fake hosted checkout (`/maksajums/mock`) for development and CI. Never set `ALLOW_INSECURE_TEST_FEATURES` on a real deployment: it also enables the passwordless dev login.

## Adding another provider

Implement `PaymentProvider` (`services/payments/types.ts`): `createPayment`, `chargeToken`, `fetchEvent`, `acknowledge`. Register it in `services/payments/index.ts`. The billing engine, the radar and the pages do not change.

## Consumer-protection notes (rule 4)

- The plan screen states the price, the interval, "atteikties var jebkurā brīdī" and that Paysera handles card data.
- Cancellation is two taps on the radar page and keeps access until the paid period ends; resume undoes it.
- Receipts and failed-payment notices are emailed; no silent charges.
