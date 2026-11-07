import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Addressable TV (Go3): the owner creates a campaign, Go3's ad server calls the
// pixel with a device id, a viewer opens the short link; the admin shows
// impressions, reach and visits, the effect on traffic and the printable
// report. One project: the campaign is shared state.

const SLUG = `e2e-go3-${Date.now().toString(36)}`;
const FREEWHEEL = "FreeWheel SSAI/1.0";

test.describe.configure({ mode: "serial" });
test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop", "one project drives the shared TV campaign");
});

async function signIn(page: Page) {
  await page.goto(`/ienakt?callbackUrl=${encodeURIComponent("/admin/reklama/tv")}`);
  await page.getByLabel("E-pasts").last().fill("e2e-admin@example.invalid");
  await page.getByRole("button", { name: "Ienākt bez paroles" }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/admin/reklama/tv"));
}

test("TV campaign: tracker for Go3, short link, impressions, reach and visits", async ({
  page,
  browser,
  playwright,
  baseURL,
}) => {
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("TV reklāma");
  const form = page.locator("[data-tv-new]");
  await form.getByLabel("Nosaukums", { exact: true }).fill("E2E Go3 ledusskapji");
  await form.getByLabel("Īsais nosaukums saitē (neobligāti)").fill(SLUG);
  await form.getByLabel("Lapa, uz kuru ved īsā saite").fill("/izvelies");
  await form.getByRole("button", { name: "Izveidot TV kampaņu" }).click();
  await expect(page.locator("[data-outcome=ok]")).toHaveText("TV kampaņa izveidota.");

  const campaign = page.locator(`[data-tv-campaign="${SLUG}"]`);
  const pixel = await campaign.locator("[data-tv-pixel]").inputValue();
  expect(pixel).toMatch(
    new RegExp(`/px/${SLUG}\\?ord=\\[timestamp\\]&vid=#\\{request\\.keyValue\\("_fw_vcid2"\\)\\}$`),
  );
  expect(await campaign.locator("[data-tv-short]").inputValue()).toMatch(new RegExp(`/tv/${SLUG}$`));
  await expect(async () => {
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(axe.violations).toEqual([]);
  }).toPass({ timeout: 10_000 });

  // Go3's ad server: three impressions, two devices; one with the macro left unfilled.
  const ssai = await playwright.request.newContext({ baseURL, userAgent: FREEWHEEL });
  for (const vid of ["dev-a", "dev-a", "dev-b", '#{request.keyValue("_fw_vcid2")}']) {
    const res = await ssai.get(`/px/${SLUG}?ord=${Date.now()}&vid=${encodeURIComponent(vid)}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/gif");
    expect(res.headers()["cache-control"]).toContain("no-store");
  }
  // An unknown campaign still answers with the image, so a typo never breaks an ad.
  expect((await ssai.get(`/px/e2e-unknown?ord=1&vid=x`)).headers()["content-type"]).toBe("image/gif");
  await ssai.dispose();

  // A viewer types the short link: it lands on the campaign page with the TV tags.
  // A viewer of their own: every e2e context shares one address, so a shared user agent would
  // fold this page view into another test's session and leave "after TV" empty.
  const viewer = await (
    await browser.newContext({
      userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 e2e-tv/${Date.now()}`,
    })
  ).newPage();
  const landing = viewer.waitForRequest((r) => r.url().endsWith("/api/visit"));
  await viewer.goto(`/tv/${SLUG}`);
  await expect(viewer).toHaveURL(
    new RegExp(`/izvelies\\?utm_source=go3&utm_medium=tv&utm_campaign=${SLUG}$`),
  );
  await landing;
  await viewer.context().close();

  await expect
    .poll(async () => {
      await page.reload();
      const c = page.locator(`[data-tv-campaign="${SLUG}"]`);
      return [
        await c.getAttribute("data-tv-impressions"),
        await c.getAttribute("data-tv-reach"),
        await c.getAttribute("data-tv-links"),
        await c.getAttribute("data-tv-visits"),
      ];
    })
    .toEqual(["4", "3", "1", "1"]);

  // The period switch: 7 days by default, today and 30 days by a click; today's figures in each.
  await expect(page.locator("[data-tv-period]")).toHaveAttribute("data-tv-period", "7");
  for (const [label, key] of [
    ["Šodien", "today"],
    ["30 dienas", "30"],
    ["7 dienas", "7"],
  ] as const) {
    await page.getByRole("link", { name: label, exact: true }).click();
    await page.waitForURL((u) => u.searchParams.get("periods") === key);
    await expect(page.locator("[data-tv-period]")).toHaveAttribute("data-tv-period", key);
    await expect(page.locator(`[data-tv-campaign="${SLUG}"]`)).toHaveAttribute("data-tv-impressions", "4");
  }

  // The effect (docs/TV_ANALYTICS_PLAN.md): the viewer's session started in the minutes after the
  // impressions, so it counts as "after TV"; today's row is computed live; the 24-hour profile is drawn.
  const effect = page.locator(`[data-tv-campaign="${SLUG}"] [data-tv-effect]`);
  await expect(effect).toBeVisible();
  expect(Number(await effect.getAttribute("data-tv-sessions-after"))).toBeGreaterThanOrEqual(1);
  await expect(effect.locator("[data-tv-profile] svg")).toBeVisible();
  await expect(page.locator(`[data-tv-campaign="${SLUG}"]`).getByText("aprēķināts tagad")).toBeVisible();

  // The printable report for Go3.
  await page.locator(`[data-tv-campaign="${SLUG}"] [data-tv-report-link]`).click();
  await page.waitForURL((u) => u.pathname === `/admin/reklama/tv/${SLUG}/parskats`);
  const study = page.locator("[data-tv-case-study]");
  await expect(study.getByRole("heading", { level: 1 })).toHaveText(
    "E2E Go3 ledusskapji: TV kampaņas pārskats",
  );
  await expect(study.getByRole("button", { name: "Drukāt vai saglabāt PDF" })).toBeVisible();
  // The whole campaign by default; a period by a click.
  await expect(page.locator("[data-report-period]")).toHaveAttribute("data-report-period", "all");
  await page.locator("[data-report-period]").getByRole("link", { name: "7 dienas" }).click();
  await page.waitForURL((u) => u.searchParams.get("periods") === "7");
  await expect(page.locator("[data-report-period]")).toHaveAttribute("data-report-period", "7");
  await expect(study.getByText("Periods", { exact: true })).toBeVisible();
  await expect(study.getByRole("heading", { name: "Metode" })).toBeVisible();
  await expect(study.locator("[data-tv-profile] svg")).toBeVisible();
  await expect(study.getByText("Apmeklējumi pēc TV").first()).toBeVisible();
  await expect(async () => {
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(axe.violations).toEqual([]);
  }).toPass({ timeout: 10_000 });
  await page.getByRole("link", { name: "Uz TV kampaņām" }).click();
  await page.waitForURL((u) => u.pathname === "/admin/reklama/tv");

  await page
    .locator(`[data-tv-campaign="${SLUG}"]`)
    .getByRole("button", { name: "Dzēst kampaņu un tās datus" })
    .click();
  await expect(page.locator("[data-outcome=ok]")).toHaveText("TV kampaņa un tās dati dzēsti.");
  await expect(page.locator(`[data-tv-campaign="${SLUG}"]`)).toHaveCount(0);
  // After deletion the short link leads home, and the pixel still answers.
  const res = await page.request.get(`/tv/${SLUG}`, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
});

test("the tracker and the short link stay out of search engines", async ({ request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /px/");
  expect(robots).toContain("Disallow: /tv/");
});
