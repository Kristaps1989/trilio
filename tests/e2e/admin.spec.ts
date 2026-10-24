import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// The admin section (docs/ADMIN_AND_OFFERS_PLAN.md §2.1, §4): only ADMIN_EMAILS
// (set to e2e-admin@example.invalid by playwright.config.ts) gets in; everyone
// else gets a 404. Runs with the dev login.

const ADMIN = "e2e-admin@example.invalid";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

async function devLogin(page: Page, email: string, callbackUrl: string) {
  await page.goto(`/ienakt?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  await page.getByLabel("E-pasts").last().fill(email);
  await page.getByRole("button", { name: "Ienākt bez paroles" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/ienakt"));
}

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
}

test("signed out, /admin asks to sign in; a shopper gets a 404 and no admin link", async ({
  page,
  request,
}) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/ienakt\?callbackUrl=%2Fadmin/);
  expect((await request.get("/admin/statistika/csv?table=sections")).status()).toBe(404);
  expect((await request.get("/admin/pasutijumi/csv")).status()).toBe(404);

  await devLogin(page, `e2e-not-admin-${Date.now()}@example.invalid`, "/");
  const res = await page.goto("/admin");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Šādas lapas nav");
  await page.goto("/");
  await expect(
    page.getByRole("navigation", { name: "Galvenā izvēlne" }).getByRole("link", { name: "Admin" }),
  ).toHaveCount(0);
  expect((await page.request.get("/admin/statistika/csv?table=sections")).status()).toBe(404);
});

test("the admin reaches every section from the header, on a phone too", async ({ page }) => {
  await devLogin(page, ADMIN, "/");
  await page.getByRole("link", { name: "Admin", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Šodien");
  await expect(page.getByRole("heading", { name: "Skaitļi" })).toBeVisible();
  await expectNoAxeViolations(page);
  await noSideScroll(page);

  const nav = page.getByRole("navigation", { name: "Admin sadaļas" });
  const sections = [
    ["Statistika", "Statistika"],
    ["Lietotāji", "Lietotāji"],
    ["Pieprasījums", "Pieprasījums"],
    ["Piedāvājumi", "Piedāvājumi"],
    ["Pasūtījumi", "Pasūtījumi"],
    ["Sistēma", "Sistēma"],
  ] as const;
  for (const [link, heading] of sections) {
    await nav.getByRole("link", { name: link, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    await expect(nav.getByRole("link", { name: link, exact: true })).toHaveAttribute("aria-current", "page");
    await expectNoAxeViolations(page);
    await noSideScroll(page);
  }
  await expect(page.getByText("IESLĒGTAS: nedrīkst būt produkcijā")).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: ADMIN })).toBeVisible();
  await expect(page.locator("meta[name=robots]")).toHaveAttribute("content", /noindex/);
});

test("own visit counts: a page view shows in Statistika, bots are not counted, CSV downloads", async ({
  page,
}) => {
  const path = `/kategorija/e2e-visit-${Date.now()}`;
  // Its own address, so the suite's other page views do not share its rate-limit window.
  const ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
  const send = (ua: string) =>
    page.request.post("/api/visit", {
      data: { path },
      headers: { "user-agent": ua, "content-type": "application/json", "x-forwarded-for": ip },
    });
  expect((await send(BROWSER_UA)).status()).toBe(204);
  expect((await send(BROWSER_UA)).status()).toBe(204);
  expect((await send("Googlebot/2.1 (+http://www.google.com/bot.html)")).status()).toBe(204);
  expect((await page.request.post("/api/visit", { data: "nonsense" })).status()).toBe(204);

  await devLogin(page, ADMIN, "/admin/statistika?periods=today");
  await expect(page.getByRole("region", { name: "Lapas" }).getByRole("table")).toBeVisible();
  // The table shows the top 25 pages; the CSV has every page.
  await expect(async () => {
    const csv = await page.request.get("/admin/statistika/csv?table=paths&periods=today");
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    expect(await csv.text()).toContain(`${path},2,1`);
  }).toPass({ timeout: 15_000 });
  await page.getByRole("link", { name: "7 d." }).click();
  await expect(page).toHaveURL(/periods=7/);
  await expect(page.getByRole("img", { name: "Apmeklētāji dienā" })).toBeVisible();

  for (const table of ["sections", "categories", "shops"])
    expect((await page.request.get(`/admin/statistika/csv?table=${table}`)).status()).toBe(200);
  expect((await page.request.get("/admin/statistika/csv?table=nope")).status()).toBe(404);
  const ledger = await page.request.get("/admin/pasutijumi/csv");
  expect(await ledger.text()).toMatch(/^number,kind,issued,order/);
});

test("the kill switch pauses offer e-mails and is logged", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "one project flips the shared switch");
  await devLogin(page, ADMIN, "/admin/sistema");
  const kill = page.getByRole("region", { name: "Piedāvājumu e-pasti" });
  await kill.getByRole("button", { name: "Apturēt visus piedāvājumu e-pastus" }).click();
  await expect(kill.getByText("Apturēti")).toBeVisible();
  await kill.getByRole("button", { name: "Atsākt" }).click();
  await expect(kill.getByText("Darbojas")).toBeVisible();
  const audit = page.getByRole("region", { name: "Admina darbības" });
  await expect(audit.getByText("offers.pause").first()).toBeVisible();
  await expect(audit.getByText("offers.resume").first()).toBeVisible();
});

test("cron route for offers needs the secret and runs the housekeeping", async ({ request }) => {
  expect((await request.post("/api/cron/offers")).status()).toBe(401);
  const secret = process.env.CRON_SECRET;
  test.skip(!secret, "CRON_SECRET not set for this run");
  const res = await request.post("/api/cron/offers", { headers: { authorization: `Bearer ${secret}` } });
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, offers: { expired: expect.any(Number) } });
});
