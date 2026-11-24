# Payments, prepayment invoices and final invoices

Trilio takes **one-off payments for its own personal offers** (docs/ADMIN_AND_OFFERS_PLAN.md). The seller is the company in the `COMPANY_*` variables (Sky Solutions SIA). Card data never touches our servers: the online payment happens on Paysera's hosted page.

The paid price-alert plan is **removed** (owner, 30 Oct 2026; docs/PRICE_NOTIFY_PLAN.md §4): there are no subscriptions, renewals or billing cron. The `plans`, `subscriptions` and notify-settings tables stay in the database until the owner confirms no active subscription is left, then a migration drops them.

## The documents of one order (owner, 24 Nov 2026)

| When | Document | Series | What it is |
|---|---|---|---|
| The buyer places the order | **Priekšapmaksas rēķins** (`invoices.kind = prepayment`) | `TRP-2026-0001` | A request to pay: the product, the sum, the deadline (the offer's last day) and the ways to pay. Not a tax document. Until the money arrives it follows the order (the buyer may correct the details); afterwards it never changes. |
| The money arrives | **Rēķins** (`invoice`) | `TR-2026-0001` | The final invoice: names the prepayment invoice it was paid by (`basis_number`), the day and the way of payment (`paid_at`, `payment_method`). With it goes the **guarantee sheet**. |
| A refund | **Kredītrēķins** (`credit_note`) | `TR-…` | Reverses the invoice; names it as its basis. |

Each series is numbered on its own, without gaps (`invoices_series_year_seq_idx`). The accountant's CSV (Admin → Pasūtījumi → CSV) holds invoices and credit notes with the payment day and method; prepayment invoices are not sales and are left out.

## How an order is paid

| Step | Code |
|---|---|
| 1. "Apmaksāt" on the order form: the order and its prepayment invoice are saved, the invoice goes to the buyer's e-mail (once), the buyer is sent to Paysera | `placeOrder`, `issuePrepaymentInvoice` (`services/offers/orders.ts`), `afterOrderPlaced` (`services/offers/notify.ts`) |
| 2a. **Online.** Paysera calls `/api/payments/callback`; the signature is checked and the event processed once | `services/payments/paysera-checkout.ts`, `services/payments/process.ts`, `orderPaymentCaptured` |
| 2b. **Bank transfer.** The buyer pays to the account on the prepayment invoice with the invoice number as the payment reference. The admin sees it on the bank statement and presses "Atzīmēt kā apmaksātu" on the order (date and the bank's reference are required and audited) | `markPaidByTransfer`, `transferPaidAction` |
| 3. Either way: the order is paid, the final invoice is issued, the buyer gets the confirmation with the invoice and the guarantee sheet, Trilio's inbox gets a note | `settleOrder`, `issueInvoice`, `afterOrderPaid` |

A buyer who left Paysera without paying returns to the order page (`/konts/pasutijumi/<id>`) or opens the prepayment invoice (`/rekins/<id>`): both have "Apmaksāt", which opens a fresh payment page (`payOrderAction`). After the offer's last day the button is gone and the invoice says the deadline has passed.

The bank transfer is offered only when `COMPANY_IBAN` is set. Without Paysera credentials and without an IBAN there is no way to pay: the order is recorded and Trilio writes to the buyer, as before.

## The guarantee sheet

`services/offers/guarantee.ts` builds it from the order and the offer; the invoice page prints it on its own page and the "paid" e-mail carries the same text (a durable medium, given before delivery: Consumer Rights Protection Law, Art. 16(2)).

- **Private buyer:** the legal two years from delivery (Art. 13), the two months to report, the first year's presumption, repair or replacement first and free of charge; how to claim (order number, 15 working days to answer, the courier is ours); the 14-day withdrawal with the model withdrawal form; PTAC and the Consumer Dispute Resolution Commission.
- **A longer guarantee in the offer** (`warranty_months` over 24) is named as an additional guarantee with the seller as the one who handles claims, and with the sentence that it does not affect the legal rights.
- **Refurbished:** the condition grade is named.
- **Business buyer:** the offer's guarantee, and that consumer rules and the withdrawal right do not apply.

The texts are in the `guarantee` section of the message files. They were written from PTAC's pages and the law (read 24 Nov 2026) and should be read once by the owner's lawyer; the exclusions of the additional guarantee (`commercial2`) are the seller's own terms.

Not built: the EU's harmonised notice on the legal guarantee, which sellers must show right before the order is confirmed since 27 Sep 2026 (PTAC, 6 Nov 2026). Its official design must be used unchanged, so it needs the file from PTAC.

## Paysera Checkout

The adapter is `services/payments/paysera-checkout.ts` ("Checkout Modern", developers.paysera.com/guides/checkout-modern; checked against the documentation on 24 Nov 2026):

| Call | Endpoint |
|---|---|
| Token | `POST https://api.paysera.com/auth/realms/Paysera/protocol/openid-connect/token` (`client_credentials`) |
| Order | `POST /merchant-order/integration/v1/orders` (amount in cents, our reference, success / failure / callback addresses) |
| Payment page | `POST /checkout-payment-link/integration/v1/payment-links` → `payment_URL` |
| Callback | Paysera posts JSON to `/api/payments/callback`; `X-Paysera-Signature` is the hex HMAC-SHA256 of the raw body with the client secret. Only a 2xx answer stops its retries |

Every callback is processed once (`payment_notifications` by callback id; `payments` by our order reference); an amount that differs from the order's is refused.

### Going live

1. In the Paysera account: **Checkout** → create the project for trilio.lv → **Integrations** → **API credentials**. Copy the Client ID and the Client Secret (the secret is shown once).
2. In Railway set `PAYSERA_CLIENT_ID` and `PAYSERA_CLIENT_SECRET`. `APP_URL` must be the public address: the callback and return addresses are built from it.
3. Set `COMPANY_NAME`, `COMPANY_REG_NO`, `COMPANY_ADDRESS`, `COMPANY_VAT_NO` (only when VAT-registered: invoices then show 21 % VAT) and, for bank transfers, `COMPANY_IBAN`, `COMPANY_BANK`, `COMPANY_SWIFT`.
4. In Paysera switch the project to **Test Mode** (the ⋮ menu next to the project's name), make one order from a test offer and pay it with a test card (4111 1111 1111 1111, 03/2030, CVC 737) and once with the bank simulator. Check: the order becomes paid, both invoices exist, both e-mails arrive. A test payment is marked `test` on the order's timeline.
5. Switch Test Mode off.

`PAYSERA_MAC_ID`, `PAYSERA_MAC_KEY` and `PAYSERA_BUSINESS_ID` belong to the older Recurring Billing API (`services/payments/paysera.ts`) and are not needed.

Until credentials exist, `PAYMENTS_PROVIDER=mock` together with `ALLOW_INSECURE_TEST_FEATURES=1` enables a fake hosted checkout (`/maksajums/mock`) for development and CI. Never set `ALLOW_INSECURE_TEST_FEATURES` on a real deployment: it also enables the passwordless dev login.

## Adding another provider

Implement `PaymentProvider` (`services/payments/types.ts`): `createPayment`, `chargeToken`, `fetchEvent`, `acknowledge`. Register it in `services/payments/index.ts`. The orders and the pages do not change.

## Consumer-protection notes (rule 4)

- The order form states the price, free delivery, the delivery time and that Paysera handles card data, before anything is paid.
- No silent charges: every payment is one the buyer starts; nothing is stored to charge again.
- The prepayment invoice has a plain deadline and no countdown; after it the offer simply no longer stands.
