import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { paymentsProvider } from "./index";
import {
  clearTokenCache,
  createPayseraCheckoutProvider,
  LINK_LIFETIME_S,
  payseraCheckoutFromEnv,
  validSignature,
} from "./paysera-checkout";

const SECRET = "test-client-secret";
const API = "https://api.test";

type Call = { url: string; method: string; headers: Record<string, string>; body: string };

function fakeFetch(responses: Array<{ status: number; json?: unknown }>) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: String(init?.body ?? ""),
    });
    const next = responses.shift() ?? { status: 500 };
    return new Response(next.json === undefined ? "" : JSON.stringify(next.json), { status: next.status });
  }) as typeof fetch;
  return { impl, calls };
}

const token = { status: 200, json: { access_token: "tok-1", expires_in: 3600 } };
const input = {
  orderId: "TRILIO-ABC-1",
  amountCents: 1200,
  currency: "EUR" as const,
  description: "Trilio Cenu radars",
  payerEmail: "a@example.invalid",
  locale: "lv",
  acceptUrl: "https://trilio.lv/radars/apstiprinats",
  cancelUrl: "https://trilio.lv/radars/atcelts",
  callbackUrl: "https://trilio.lv/api/payments/callback",
};

function signed(body: unknown, headers: Record<string, string> = {}) {
  const raw = JSON.stringify(body);
  const signature = createHmac("sha256", SECRET).update(raw).digest("hex");
  return { body: raw, headers: new Headers({ "x-paysera-signature": signature, ...headers }) };
}

const paidOrder = {
  event: { type: "order", name: "amount_paid_updated" },
  order: {
    paysera_order_id: "po-1",
    merchant_order_id: "TRILIO-ABC-1",
    amount: 1200,
    amount_paid: 1200,
    currency: "EUR",
    status: "paid",
  },
};

beforeEach(() => clearTokenCache());

describe("payseraCheckoutFromEnv", () => {
  it("needs both the client id and secret", () => {
    expect(payseraCheckoutFromEnv({ PAYSERA_CLIENT_ID: "id" })).toBeNull();
    expect(payseraCheckoutFromEnv({ PAYSERA_CLIENT_ID: "id", PAYSERA_CLIENT_SECRET: "s" })).toEqual({
      clientId: "id",
      clientSecret: "s",
    });
    expect(
      payseraCheckoutFromEnv({ PAYSERA_CLIENT_ID: "id", PAYSERA_CLIENT_SECRET: "s", PAYSERA_API_URL: API })
        ?.apiBase,
    ).toBe(API);
  });

  it("is preferred over Recurring Billing and the mock", () => {
    const p = paymentsProvider({
      PAYSERA_CLIENT_ID: "id",
      PAYSERA_CLIENT_SECRET: "s",
      PAYSERA_MAC_ID: "a",
      PAYSERA_MAC_KEY: "b",
      PAYSERA_BUSINESS_ID: "c",
      PAYMENTS_PROVIDER: "mock",
      ALLOW_INSECURE_TEST_FEATURES: "1",
    });
    expect(p?.name).toBe("paysera");
    expect(p?.recurring).toBe(false);
  });
});

describe("createPayment", () => {
  it("authenticates once, creates an order and a payment link, and returns the hosted page", async () => {
    const { impl, calls } = fakeFetch([
      token,
      { status: 201, json: { order_id: "po-1" } },
      { status: 201, json: { payment_URL: "https://pay.test/l/1" } },
      { status: 201, json: { order_id: "po-2" } },
      { status: 201, json: { payment_URL: "https://pay.test/l/2" } },
    ]);
    const p = createPayseraCheckoutProvider({
      clientId: "id",
      clientSecret: SECRET,
      apiBase: API,
      fetchImpl: impl,
    });
    const r = await p.createPayment({ ...input, requestToken: false });
    expect(r).toEqual({ providerRequestId: "po-1", redirectUrl: "https://pay.test/l/1" });

    expect(calls[0]!.url).toBe(`${API}/auth/realms/Paysera/protocol/openid-connect/token`);
    expect(new URLSearchParams(calls[0]!.body).get("grant_type")).toBe("client_credentials");
    expect(calls[1]!.url).toBe(`${API}/merchant-order/integration/v1/orders`);
    expect(calls[1]!.headers.authorization).toBe("Bearer tok-1");
    expect(JSON.parse(calls[1]!.body)).toMatchObject({
      purchase: { reference: "TRILIO-ABC-1", amount: 1200, currency: "EUR" },
      redirect_urls: {
        callback_url: input.callbackUrl,
        success_url: input.acceptUrl,
        failure_url: input.cancelUrl,
      },
    });
    expect(JSON.parse(calls[2]!.body)).toMatchObject({
      order_id: "po-1",
      lifetime: LINK_LIFETIME_S,
      experience: { language: "lv" },
      purchase: { amount: 1200 },
      payer_information: { email: input.payerEmail },
    });

    // The token is reused for the next payment.
    await p.createPayment({ ...input, orderId: "TRILIO-ABC-2", requestToken: false });
    expect(calls.filter((c) => c.url.endsWith("/token"))).toHaveLength(1);
  });

  it("fetches a fresh token once when Paysera rejects the cached one", async () => {
    const { impl, calls } = fakeFetch([
      token,
      { status: 401, json: { error: "invalid_token" } },
      { status: 200, json: { access_token: "tok-2", expires_in: 3600 } },
      { status: 201, json: { order_id: "po-1" } },
      { status: 201, json: { payment_URL: "https://pay.test/l/1" } },
    ]);
    const p = createPayseraCheckoutProvider({
      clientId: "id",
      clientSecret: SECRET,
      apiBase: API,
      fetchImpl: impl,
    });
    await expect(p.createPayment({ ...input, requestToken: false })).resolves.toMatchObject({
      providerRequestId: "po-1",
    });
    expect(calls[3]!.headers.authorization).toBe("Bearer tok-2");
  });

  it("reports Paysera's error description", async () => {
    const { impl } = fakeFetch([
      token,
      { status: 422, json: { error: "validation", error_description: "Amount too small" } },
    ]);
    const p = createPayseraCheckoutProvider({
      clientId: "id",
      clientSecret: SECRET,
      apiBase: API,
      fetchImpl: impl,
    });
    await expect(p.createPayment({ ...input, requestToken: false })).rejects.toMatchObject({
      message: "Amount too small",
      status: 422,
      code: "validation",
    });
  });

  it("fails clearly when authentication fails or a response has the wrong shape", async () => {
    const bad = fakeFetch([{ status: 401, json: { error: "invalid_client" } }]);
    const p1 = createPayseraCheckoutProvider({
      clientId: "id",
      clientSecret: "x",
      apiBase: API,
      fetchImpl: bad.impl,
    });
    await expect(p1.createPayment({ ...input, requestToken: false })).rejects.toThrow(
      "authentication failed",
    );

    clearTokenCache();
    const odd = fakeFetch([token, { status: 201, json: { nope: true } }]);
    const p2 = createPayseraCheckoutProvider({
      clientId: "id",
      clientSecret: SECRET,
      apiBase: API,
      fetchImpl: odd.impl,
    });
    await expect(p2.createPayment({ ...input, requestToken: false })).rejects.toThrow("Unexpected");
  });
});

describe("callbacks", () => {
  const quiet = { warn: () => undefined };
  const provider = () => createPayseraCheckoutProvider({ clientId: "id", clientSecret: SECRET, log: quiet });

  it("verifies the signature in constant time against the raw body", () => {
    const { body, headers } = signed(paidOrder);
    expect(validSignature(body, headers.get("x-paysera-signature"), SECRET)).toBe(true);
    expect(validSignature(body + " ", headers.get("x-paysera-signature"), SECRET)).toBe(false);
    expect(validSignature(body, null, SECRET)).toBe(false);
    expect(validSignature(body, "abc", SECRET)).toBe(false);
  });

  it("turns a paid order snapshot into a captured event", async () => {
    const ev = await provider().fetchEvent(signed(paidOrder, { "x-paysera-callback-id": "cb-1" }));
    expect(ev).toMatchObject({
      notificationId: "cb-1",
      event: "order.amount_paid_updated",
      orderId: "TRILIO-ABC-1",
      providerRequestId: "po-1",
      status: "captured",
      amountCents: 1200,
      currency: "EUR",
      issuedToken: null,
      test: false,
    });
  });

  it("marks test-mode orders and falls back to a body hash for the id", async () => {
    const ev = await provider().fetchEvent(
      signed({ ...paidOrder, order: { ...paidOrder.order, is_test: true } }),
    );
    expect(ev?.test).toBe(true);
    expect(ev?.notificationId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("maps a canceled order (either spelling) and ignores everything else", async () => {
    for (const status of ["cancelled", "canceled"]) {
      const ev = await provider().fetchEvent(
        signed({ event: { type: "order", name: "status_updated" }, order: { ...paidOrder.order, status } }),
      );
      expect(ev?.status).toBe("canceled");
      expect(ev?.amountCents).toBeNull();
    }
    const pending = signed({ ...paidOrder, order: { ...paidOrder.order, status: "pending_payment" } });
    expect(await provider().fetchEvent(pending)).toBeNull();
    const payment = signed({
      version: 1,
      event: { type: "payment", name: "status_updated" },
      order: { paysera_order_id: "po-1", merchant_order_id: "TRILIO-ABC-1" },
      payment: { id: "p-1", status: "settled", amount: 1200, currency: "EUR" },
    });
    expect(await provider().fetchEvent(payment)).toBeNull();
    const notJson = createHmac("sha256", SECRET).update("x").digest("hex");
    expect(
      await provider().fetchEvent({ body: "x", headers: new Headers({ "x-paysera-signature": notJson }) }),
    ).toBeNull();
  });

  it("ignores a callback with a wrong signature", async () => {
    const { body } = signed(paidOrder);
    const ev = await provider().fetchEvent({
      body,
      headers: new Headers({ "x-paysera-signature": "0".repeat(64) }),
    });
    expect(ev).toBeNull();
  });

  it("never charges a stored token (one-off payments only)", async () => {
    const r = await provider().chargeToken(input, "tok");
    expect(r).toMatchObject({ ok: false, retryable: false });
    await expect(provider().acknowledge("cb-1")).resolves.toBeUndefined();
  });
});
