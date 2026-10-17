import { test, expect } from "@playwright/test";

test.describe("cron ingest route", () => {
  test("rejects requests without the bearer secret", async ({ request }) => {
    const res = await request.post("/api/cron/ingest");
    expect(res.status()).toBe(401);
    const wrong = await request.post("/api/cron/ingest", { headers: { authorization: "Bearer nope" } });
    expect(wrong.status()).toBe(401);
  });
});
