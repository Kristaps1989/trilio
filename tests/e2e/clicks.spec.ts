import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Shop clicks a person makes (docs/CLICK_QUALITY_PLAN.md): the question before
// the shop is asked also where the page's script never ran, the answer is a
// 24-hour cookie that /go/ reads, and a click that does not look like a person
// on a Trilio page is kept apart in Statistika and left out of every figure.
// Plus "Par Trilio" and the site's structured data for a search on the name.

const picks = (page: Page) => page.getByRole("region", { name: "Ieteiktie varianti" }).getByRole("article");
const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

async function noAxe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test("without JavaScript a card's shop link asks the question first; the answer then holds for a day", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  const page = await context.newPage();
  // The shop itself is not part of the test.
  await page.route("https://example.invalid/**", (r) =>
    r.fulfill({ status: 200, contentType: "text/html", body: "<title>shop</title><h1>shop</h1>" }),
  );
  await page.goto("/rezultati?sub=kettle");
  const buy = picks(page)
    .first()
    .getByRole("link", { name: /^Pirkt — / });
  const shop = ((await buy.textContent()) ?? "").replace(/^Pirkt — /, "").trim();
  await expect(buy).toHaveAttribute("href", /from=card/);
  await buy.click();

  // The question as a page: the same two choices, never indexed.
  await expect(page).toHaveURL(/\/pirms-veikala\/[0-9a-f-]{36}\?s=[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pirms pērc — pajautāsim zemāku cenu");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.getByRole("button", { name: "Iegūt lētāk" })).toBeVisible();
  const toShop = page.getByRole("link", { name: `Uz ${shop}` });
  await expect(toShop).toHaveAttribute("href", /^\/go\/[0-9a-f-]{36}\?s=[0-9a-f-]{36}&from=ask$/);
  await toShop.click();
  await expect(page).toHaveURL(/^https:\/\/example\.invalid\//);
  expect((await context.cookies()).find((c) => c.name === "trilio_ask")?.value).toMatch(/^\d+$/);

  // Answered: the next card click goes straight to the shop.
  await page.goto("/rezultati?sub=kettle");
  await picks(page)
    .nth(1)
    .getByRole("link", { name: /^Pirkt — / })
    .click();
  await expect(page).toHaveURL(/^https:\/\/example\.invalid\//);
  await context.close();
});

test("the question page works with JavaScript too: the request, the shop link, axe", async ({ page }) => {
  await page.goto("/rezultati?sub=kettle");
  const href = await picks(page)
    .first()
    .getByRole("link", { name: /^Pirkt — / })
    .getAttribute("href");
  const offer = /\/go\/([0-9a-f-]{36})/.exec(href!)![1];
  await page.goto(`/pirms-veikala/${offer}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pirms pērc — pajautāsim zemāku cenu");
  await expect(page.locator("[data-ask-discount]")).toContainText("līdz −10 %");
  await page.getByRole("button", { name: "Iegūt lētāk" }).click();
  await expect(page.getByRole("group", { name: "Uz kādu e-pastu sūtīt piedāvājumu?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Atpakaļ uz rezultātiem" })).toBeVisible();
  await noAxe(page);
  expect((await page.goto("/pirms-veikala/00000000-0000-4000-8000-000000000000"))?.status()).toBe(404);
});

test("a script with a browser's name is sent to the shop but counted apart, in no figure", async ({
  page,
  playwright,
  baseURL,
}) => {
  test.skip(test.info().project.name !== "desktop", "the statistics are shared state");
  await page.goto(`/ienakt?callbackUrl=${encodeURIComponent("/admin/statistika")}`);
  await page.getByLabel("E-pasts").last().fill("e2e-admin@example.invalid");
  await page.getByRole("button", { name: "Ienākt bez paroles" }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/admin"));
  const quality = async () => {
    await page.goto("/admin/statistika?periods=today");
    const raw = await page.locator("[data-click-quality]").getAttribute("data-click-quality");
    const [people, suspect] = raw!.split("/").map(Number) as [number, number];
    return { people, suspect };
  };
  const before = await quality();

  const results = await page.request.get("/rezultati?sub=kettle");
  const go = /href="(\/go\/[0-9a-f-]{36}[^"]*)"/.exec(await results.text())![1]!.replaceAll("&amp;", "&");
  // No Sec-Fetch headers, a Chrome user agent: what a scraper or a link checker sends.
  const script = await playwright.request.newContext({ baseURL, userAgent: CHROME });
  const res = await script.get(go.replace(/from=\w+/, "from=ask"), { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers().location).toMatch(/^https:\/\/example\.invalid\//);
  await script.dispose();

  await expect.poll(async () => (await quality()).suspect).toBeGreaterThan(before.suspect);
  await expect(page.getByRole("heading", { name: "Klikšķu kvalitāte" })).toBeVisible();
  await expect(page.getByText(/Aizdomīgi: pārlūks bez navigācijas galvenēm/)).toBeVisible();
});

test("Par Trilio says what Trilio is; the site's structured data names it with its domain", async ({
  page,
}) => {
  await page.goto("/");
  const ld = (await page.locator('script[type="application/ld+json"]').first().textContent())!;
  const [org, site] = JSON.parse(ld) as [Record<string, unknown>, Record<string, unknown>];
  const host = new URL(page.url()).host;
  expect(org).toMatchObject({ "@type": "Organization", name: "Trilio", alternateName: [host] });
  expect(org.contactPoint).toMatchObject({ email: expect.stringContaining("@") });
  expect(site).toMatchObject({ "@type": "WebSite", alternateName: [host], publisher: { "@id": org["@id"] } });

  await page.getByRole("link", { name: "Vairāk par Trilio" }).click();
  await expect(page).toHaveURL(/\/par-trilio$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Par Trilio");
  await expect(
    page.getByText("Trilio ir sadzīves tehnikas pirkumu palīgs Latvijā.", { exact: false }),
  ).toBeVisible();
  await expect(page).toHaveTitle(/^Par Trilio — sadzīves tehnikas pirkumu palīgs Latvijā/);
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Par Trilio" })).toBeVisible();
  await noAxe(page);

  const sitemap = await (await page.request.get("/sitemap.xml")).text();
  expect(sitemap).toMatch(/<loc>[^<]*\/par-trilio<\/loc>/);
  const robots = await (await page.request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /pirms-veikala/");
});
