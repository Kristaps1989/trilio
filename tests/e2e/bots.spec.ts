import { expect, test, type Page } from "@playwright/test";

// Bots get the same pages and redirects as people, but Trilio's own statistics
// leave them out and count them apart (Statistika → "Filtrēti roboti").

const GOOGLEBOT =
  "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

test.describe.configure({ mode: "serial" });
test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop", "the bot counter is shared state");
});

async function botHits(page: Page) {
  await page.goto("/admin/statistika?periods=today");
  const raw = await page.locator("[data-bot-hits]").getAttribute("data-bot-hits");
  const [visit, search, click] = raw!.split("/").map(Number) as [number, number, number];
  return { visit, search, click };
}

async function signIn(page: Page) {
  await page.goto(`/ienakt?callbackUrl=${encodeURIComponent("/admin/statistika")}`);
  await page.getByLabel("E-pasts").last().fill("e2e-admin@example.invalid");
  await page.getByRole("button", { name: "Ienākt bez paroles" }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/admin"));
}

test("Googlebot gets the same pages and the shop redirect, and is counted only as a bot", async ({
  page,
  playwright,
  baseURL,
}) => {
  await signIn(page);
  const before = await botHits(page);

  const bot = await playwright.request.newContext({ baseURL, userAgent: GOOGLEBOT });
  const landing = await bot.get("/kategorija/kettle");
  expect(landing.status()).toBe(200);
  const go = /href="(\/go\/[0-9a-f-]{36})"/.exec(await landing.text())![1]!;
  const results = await bot.get("/rezultati?sub=kettle");
  expect(results.status()).toBe(200);
  expect(await results.text()).toContain('href="/go/');
  const redirect = await bot.get(go, { maxRedirects: 0 });
  expect(redirect.status()).toBe(302);
  expect(redirect.headers().location).toMatch(/^https?:\/\//);
  expect((await bot.post("/api/visit", { data: { path: "/" } })).status()).toBe(204);
  await bot.dispose();

  await expect
    .poll(async () => {
      const now = await botHits(page);
      return [now.visit - before.visit, now.search - before.search, now.click - before.click];
    })
    .toEqual([1, 1, 1]);
  await expect(page.getByText("Filtrēti roboti")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pārlūki" })).toBeVisible();
});

test("a person's page view is sent only after the page has been visible for a second", async ({ page }) => {
  const sent: number[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/visit")) sent.push(Date.now());
  });
  await page.goto("/");
  const loaded = Date.now();
  await expect.poll(() => sent.length, { timeout: 5_000 }).toBeGreaterThan(0);
  expect(sent[0]! - loaded).toBeGreaterThanOrEqual(800);
});
