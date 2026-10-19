import { describe, expect, it } from "vitest";
import { createPayseraProvider } from "./paysera";

type Call = { method: string; url: string; body: unknown; auth: string };

function fakeFetch(handler: (call: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const call: Call = {
      method: init?.method ?? "GET",
      url,
      body: init?.body ? JSON.parse(String(init.body)) : null,
      auth: String((init?.headers as Record<string, string>)?.authorization ?? ""),
    };
    calls.push(call);
    const r = handler(call);
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const config = { macId: "id1", macKey: "key1", businessId: "biz1" };

describe("Paysera provider", () => {
  it("creates an initial payment request with token_strategy and returns the hosted URL", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 201,
      body: { id: "pr1", status: "new", authorization_url: "https://checkout-eu-a.paysera.com/pay/pr1" },
    }));
    const p = createPayseraProvider({ ...config, fetchImpl });
    const r = await p.createPayment({
      orderId: "SUB_1",
      amountCents: 199,
      currency: "EUR",
      description: "Cenu radars",
      payerEmail: "a@b.lv",
      locale: "lv",
      acceptUrl: "https://t/ok",
      cancelUrl: "https://t/no",
      callbackUrl: "https://t/cb",
      requestToken: true,
    });
    expect(r).toEqual({ providerRequestId: "pr1", redirectUrl: "https://checkout-eu-a.paysera.com/pay/pr1" });
    expect(calls[0]!.url).toBe("https://checkout-eu-a.paysera.com/checkout/rest/v1/payment-requests");
    expect(calls[0]!.body).toMatchObject({
      business_id: "biz1",
      order_id: "SUB_1",
      price: { amount: 199, currency: "EUR" },
      token_strategy: "required",
      callback_url: "https://t/cb",
    });
    expect(calls[0]!.auth).toMatch(
      /^MAC id="id1", ts="\d+", nonce="[A-Za-z0-9]+", mac="[^"]+", ext="body_hash=/,
    );
  });

  it("charges a token: create (no token_strategy) then authorize; captured → ok", async () => {
    const { fetchImpl, calls } = fakeFetch((c) =>
      c.url.endsWith("/authorize")
        ? {
            status: 200,
            body: {
              id: "pr2",
              status: "captured",
              captured_at: "2026-11-01T08:00:00Z",
              payer: { account_number: "4242" },
            },
          }
        : { status: 201, body: { id: "pr2", status: "new" } },
    );
    const p = createPayseraProvider({ ...config, fetchImpl });
    const r = await p.chargeToken(
      {
        orderId: "SUB_1_2",
        amountCents: 199,
        currency: "EUR",
        description: "x",
        payerEmail: "a@b.lv",
        locale: "lv",
        acceptUrl: "https://t/ok",
        cancelUrl: "https://t/no",
        callbackUrl: "https://t/cb",
      },
      "tok",
    );
    expect(r).toMatchObject({ ok: true, providerRequestId: "pr2", paymentMethodLabel: "•••• 4242" });
    expect(calls[0]!.body).not.toHaveProperty("token_strategy");
    expect(calls[1]!.method).toBe("PUT");
    expect(calls[1]!.body).toEqual({ token: "tok" });
  });

  it("maps provider errors: 4xx not retryable, 5xx retryable", async () => {
    const p1 = createPayseraProvider({
      ...config,
      fetchImpl: fakeFetch((c) =>
        c.url.endsWith("/authorize")
          ? { status: 400, body: { error: "invalid_token" } }
          : { status: 201, body: { id: "x", status: "new" } },
      ).fetchImpl,
    });
    const input = {
      orderId: "o",
      amountCents: 1,
      currency: "EUR" as const,
      description: "x",
      payerEmail: "a@b.lv",
      locale: "lv",
      acceptUrl: "https://t/ok",
      cancelUrl: "https://t/no",
      callbackUrl: "https://t/cb",
    };
    expect(await p1.chargeToken(input, "t")).toMatchObject({
      ok: false,
      retryable: false,
      reason: "400 invalid_token",
    });
    const p2 = createPayseraProvider({
      ...config,
      fetchImpl: fakeFetch(() => ({ status: 503, body: {} })).fetchImpl,
    });
    expect(await p2.chargeToken(input, "t")).toMatchObject({ ok: false, retryable: true });
  });

  it("fetches a notification by the callback's notification_id and maps it to an event", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: {
        id: "n1",
        event: "payment_request.captured",
        status: "new",
        data: {
          payment_request: {
            id: "pr1",
            status: "captured",
            order_id: "SUB_1",
            price_paid: { amount: 199, currency: "EUR" },
            issued_token: "tok_abc",
            payer: { account_number: "5100" },
          },
        },
      },
    }));
    const p = createPayseraProvider({ ...config, fetchImpl });
    const ev = await p.fetchEvent({
      body: new URLSearchParams("notification_id=n1").toString(),
      headers: new Headers(),
    });
    expect(ev).toEqual({
      notificationId: "n1",
      event: "payment_request.captured",
      orderId: "SUB_1",
      providerRequestId: "pr1",
      status: "captured",
      amountCents: 199,
      currency: "EUR",
      issuedToken: "tok_abc",
      paymentMethodLabel: "•••• 5100",
    });
    expect(calls[0]!.url).toBe("https://checkout-eu-a.paysera.com/notification/rest/v1/notifications/n1");
    expect(
      await p.fetchEvent({ body: new URLSearchParams("x=1").toString(), headers: new Headers() }),
    ).toBeNull();
    expect(
      await p.fetchEvent({
        body: new URLSearchParams("notification_id=../evil").toString(),
        headers: new Headers(),
      }),
    ).toBeNull();
    await p.acknowledge("n1");
    expect(calls.at(-1)!.url).toBe(
      "https://checkout-eu-a.paysera.com/notification/rest/v1/notifications/n1/read",
    );
  });
});
