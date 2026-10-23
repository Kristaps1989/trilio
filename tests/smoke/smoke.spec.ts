import { test, expect, type Page } from "@playwright/test";

// Read-only checks for a deployed site. Nothing here writes data except the
// anonymous search session every results page records. Works with an empty
// catalogue (fresh database) and with real shop data.

const ERROR_SCREEN =
  /This page couldn.t load|Application error|Lapu neizdevās ielādēt|Internal Server Error/i;
const isProduction = /trilio\.lv/.test(process.env.SMOKE_BASE_URL ?? "");

async function expectHealthyPage(page: Page, path: string) {
  const res = await page.goto(path);
  expect(res, `${path} responded`).not.toBeNull();
  expect(res!.status(), `${path} status`).toBeLessThan(400);
  await expect(page.locator("body > header"), `${path} has the Trilio header`).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "lv");
  expect(await page.locator("body").innerText(), `${path} shows no error screen`).not.toMatch(ERROR_SCREEN);
}

test.describe("every sitemap URL renders", () => {
  test.describe.configure({ mode: "parallel" });
  test.skip(({ isMobile }) => !!isMobile, "checked once, at desktop width");

  test("sitemap pages", async ({ page, request }) => {
    test.setTimeout(600_000);
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const xml = await res.text();
    const paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]!).pathname);
    expect(paths.length).toBeGreaterThan(20);
    const failures: string[] = [];
    for (const path of paths) {
      try {
        await expectHealthyPage(page, path);
      } catch (e) {
        failures.push(`${path}: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
});

test("guided flow: home → category → every question → results → shop", async ({ page }) => {
  await expectHealthyPage(page, "/");
  await page.getByRole("link", { name: "Palīdzi izvēlēties" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ko tu meklē?");
  await page.getByRole("link", { name: /Virtuves mazā tehnika/ }).click();
  await page.getByRole("link", { name: /^Tējkannas/ }).click();
  // Take the pre-selected answer on every screen ("Tālāk"); on the price
  // screen choose "no budget" so a sparse catalogue still has results.
  const results = page.getByRole("heading", { level: 1, name: /^(Trīs l|L)abākie varianti tev$/ });
  for (let step = 0; step < 15; step++) {
    await expect(page.getByText(/Jautājums \d+ no \d+/).or(results)).toBeVisible();
    if (await results.isVisible()) break;
    const before = page.url();
    const noBudget = page.getByRole("button", { name: "Budžets nav noteikts" });
    if (await noBudget.isVisible().catch(() => false)) await noBudget.click();
    else await page.getByRole("button", { name: "Tālāk", exact: true }).click();
    // Each answer changes the URL (the answers live in it); wait for that.
    await page.waitForURL((u) => u.toString() !== before);
  }
  await expect(page).toHaveURL(/\/rezultati\?sub=kettle/);
  expect(await page.locator("body").innerText()).not.toMatch(ERROR_SCREEN);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^(Trīs l|L)abākie varianti tev$/);

  const buy = page.getByRole("link", { name: /^Pirkt — / }).first();
  if ((await buy.count()) === 0) {
    test.info().annotations.push({ type: "note", description: "no offers in this catalogue yet" });
    return;
  }
  const compare = page.getByRole("button", { name: "Salīdzināt parametrus blakus" });
  if ((await compare.count()) > 0) {
    await compare.click();
    await expect(page.getByRole("table")).toBeVisible();
  }
  const href = await buy.getAttribute("href");
  expect(href).toMatch(/^\/go\/[0-9a-f-]{36}/);
  const res = await page.request.get(href!, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  const target = new URL(res.headers()["location"]!);
  expect(target.protocol).toBe("https:");
  expect(target.hostname).not.toMatch(/trilio/);
});

test("model search, free text and sign-in pages work", async ({ page }) => {
  await expectHealthyPage(page, "/modelis?q=bosch");
  await expectHealthyPage(page, "/cits");
  await page.getByLabel("Tavs apraksts").fill("vajag rokas blenderi zupām");
  await page.getByRole("button", { name: "Atrast" }).click();
  await expect(page).toHaveURL(/\/izvelies\/kitchensmall\/handblender/);
  await expectHealthyPage(page, "/ienakt");
  if (isProduction) await expect(page.getByRole("button", { name: "Turpināt ar Google" })).toBeVisible();
});

test("machine-readable endpoints", async ({ request }) => {
  for (const path of ["/robots.txt", "/sitemap.xml", "/llms.txt"]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
  }
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ ok: true });
});

test("hosts redirect to the canonical https address", async ({ request }) => {
  test.skip(!isProduction, "only meaningful on the real domain");
  const http = await request.get("http://trilio.lv/", { maxRedirects: 0 });
  expect([301, 302, 307, 308]).toContain(http.status());
  expect(http.headers()["location"]).toMatch(/^https:\/\/trilio\.lv\/?$/);
  const www = await request.get("https://www.trilio.lv/", { maxRedirects: 0 });
  expect([301, 302, 307, 308]).toContain(www.status());
  expect(www.headers()["location"]).toMatch(/^https:\/\/trilio\.lv\/?$/);
});
