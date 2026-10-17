import { test, expect } from "@playwright/test";

test("health endpoint reports database connectivity", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(res.headers()["cache-control"]).toBe("no-store");
});
