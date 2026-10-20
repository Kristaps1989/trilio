import { describe, expect, it } from "vitest";
import { createEprelClient, EprelError } from "./client";

function fake(responses: Record<string, { status: number; body: unknown }>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, headers: (init?.headers ?? {}) as Record<string, string> });
    const key = Object.keys(responses).find((k) => u.includes(k));
    const r = key ? responses[key]! : { status: 404, body: { code: "NOT_FOUND" } };
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return { impl, calls };
}

describe("createEprelClient", () => {
  it("looks up an EAN without the key and accepts one record or a list", async () => {
    const { impl, calls } = fake({
      "/product/gtin/4242005304899": { status: 200, body: { modelIdentifier: "X1", productGroup: "ovens" } },
      "/product/gtin/4242005304882": {
        status: 200,
        body: [{ modelIdentifier: "X2" }, { modelIdentifier: "X3" }],
      },
    });
    const c = createEprelClient({ apiKey: "k", fetchImpl: impl, base: "https://eprel.test/api" });
    expect(await c.byGtin("4242005304899")).toEqual([{ modelIdentifier: "X1", productGroup: "ovens" }]);
    expect(await c.byGtin("4242005304882")).toHaveLength(2);
    expect(calls[0]!.url).toBe("https://eprel.test/api/product/gtin/4242005304899");
    expect(calls[0]!.headers["x-api-key"]).toBeUndefined();
    expect(await c.byGtin("not-an-ean")).toEqual([]);
  });

  it("treats not found and unverified suppliers as no record", async () => {
    const { impl } = fake({
      "/product/gtin/1111111111111": { status: 403, body: { code: "UNVERIFIED_SUPPLIER" } },
    });
    const c = createEprelClient({ fetchImpl: impl });
    expect(await c.byGtin("1111111111111")).toEqual([]);
    expect(await c.byGtin("2222222222222")).toEqual([]);
  });

  it("searches by model with the key in X-Api-Key and reads the hits", async () => {
    const { impl, calls } = fake({
      "/products/dishwashers2019?": {
        status: 200,
        body: { size: 1, offset: 0, hits: [{ modelIdentifier: "SMS4" }] },
      },
    });
    const c = createEprelClient({ apiKey: "secret", fetchImpl: impl, base: "https://eprel.test/api" });
    expect(c.canSearch).toBe(true);
    expect(await c.searchModel("dishwashers2019", " SMS4 ")).toEqual([{ modelIdentifier: "SMS4" }]);
    expect(calls[0]!.url).toContain("modelIdentifier=SMS4");
    expect(calls[0]!.headers["x-api-key"]).toBe("secret");
  });

  it("does not search without a key, and reports a refused key or a server error", async () => {
    expect(createEprelClient({}).canSearch).toBe(false);
    expect(await createEprelClient({}).searchModel("ovens", "X")).toEqual([]);
    const { impl } = fake({
      "/products/ovens?": { status: 403, body: { message: "Forbidden" } },
      "/products/rangehoods?": { status: 500, body: {} },
    });
    const c = createEprelClient({ apiKey: "bad", fetchImpl: impl });
    await expect(c.searchModel("ovens", "X")).rejects.toBeInstanceOf(EprelError);
    await expect(c.searchModel("rangehoods", "X")).rejects.toMatchObject({ status: 500 });
  });
});
