import { test, expect } from "@playwright/test";

test.describe("free-text routing endpoint", () => {
  test("routes a regex-detectable request without the model", async ({ request }) => {
    const res = await request.post("/api/free-text", { data: { text: "Vajag rokas blenderi zupām" } });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ subcategoryId: "handblender", prefilled: {}, outOfScope: false });
    expect(res.headers()["cache-control"]).toBe("no-store");
  });

  test("rejects empty, oversized and malformed bodies", async ({ request }) => {
    expect((await request.post("/api/free-text", { data: { text: "" } })).status()).toBe(400);
    expect((await request.post("/api/free-text", { data: { text: "x".repeat(301) } })).status()).toBe(400);
    expect((await request.post("/api/free-text", { data: "not json" })).status()).toBe(400);
  });

  test("returns no route (not an error) when nothing matches and the model is off", async ({ request }) => {
    const res = await request.post("/api/free-text", { data: { text: "kaut kas pavisam cits" } });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ subcategoryId: null, prefilled: {}, outOfScope: false });
  });
});
