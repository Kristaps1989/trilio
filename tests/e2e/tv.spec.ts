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
  await form.getByRole("button", { name: "Izveidot kampaņu" }).click();
  await expect(page.locator("[data-outcome=ok]")).toHaveText("Kampaņa izveidota.");

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
  // The channel mix (§8): the viewer came with no ad tags, so is direct and counted (✓).
  await expect(page.locator(`[data-tv-campaign="${SLUG}"] [data-tv-channels]`)).toContainText(
    "✓ Tiešie un organiskie",
  );

  // The pixel with Go3's optional fields (docs/TV_PIXEL_BEST_PRACTICE.md): the viewer's address by
  // macro, a device header, the creative and channel, and a holdout device that is not an impression.
  const extended = await page.locator(`[data-tv-campaign="${SLUG}"] [data-tv-pixel-extended]`).inputValue();
  // FreeWheel's own macros (FreeWheel Macros Guide): the client address, the creative, the CSID.
  for (const macro of [
    "ip=#{request.clientAddress}",
    "cr=#{ad.creative.id}",
    "csid=#e{section.customId}",
    "ts=#{timestamp}",
  ])
    expect(extended).toContain(macro);
  expect(await page.locator(`[data-tv-campaign="${SLUG}"] [data-tv-pixel-control]`).inputValue()).toMatch(
    /&grp=control$/,
  );
  const go3 = await playwright.request.newContext({
    baseURL,
    userAgent: FREEWHEEL,
    extraHTTPHeaders: {
      "x-device-ip": "81.198.9.10",
      "x-device-user-agent": "Mozilla/5.0 (SMART-TV; Tizen 6.5)",
    },
  });
  expect(
    (
      await go3.get(
        `/px/${SLUG}?ord=1&vid=dev-c&ip=81.198.9.9&cr=Spots20&ch=TV3&csid=DAI_smarttv_other_PR_TV3_Life_LV_HD_HVC&dt=Smart%20TV&pos=midroll&co=LV&crn=%23e%7Bad.creative.name%7D`,
      )
    ).status(),
  ).toBe(200);
  expect((await go3.get(`/px/${SLUG}?ord=2&vid=dev-d&ip=81.198.9.8&grp=control`)).status()).toBe(200);
  await go3.dispose();
  // A person in the first household opens the site on a phone (their browser sends fetch metadata).
  const home = await playwright.request.newContext({
    baseURL,
    userAgent: `Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1 e2e-hh/${Date.now()}`,
    extraHTTPHeaders: {
      "x-forwarded-for": "81.198.9.9",
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "no-cors",
    },
  });
  expect((await home.post("/api/visit", { data: { path: "/izvelies" } })).status()).toBe(204);
  await home.dispose();
  await expect
    .poll(async () => {
      await page.reload();
      const c = page.locator(`[data-tv-campaign="${SLUG}"]`);
      return [
        await c.getAttribute("data-tv-impressions"),
        await c.locator("[data-tv-households]").getAttribute("data-tv-households"),
        await c.locator("[data-tv-pixel-days]").getAttribute("data-tv-pixel-days"),
      ];
    })
    .toEqual(["5", "1", "1"]);
  const pixelTable = page.locator(`[data-tv-campaign="${SLUG}"] [data-tv-pixel-days]`);
  await expect(pixelTable.getByText("ir (makross)")).toBeVisible();
  await expect(pixelTable.getByText("Spots20")).toBeVisible();
  // Go3's site section decoded: the screen, live, the channel without its feed; the viewer's country.
  await expect(pixelTable.getByRole("cell", { name: "Televizora ekrāns", exact: true })).toBeVisible();
  await expect(pixelTable.getByRole("cell", { name: "Tiešraide", exact: true })).toBeVisible();
  await expect(pixelTable.getByRole("cell", { name: "TV3 Life", exact: true })).toBeVisible();
  await expect(pixelTable.getByRole("cell", { name: "LV", exact: true })).toBeVisible();
  await expect(pixelTable.getByText("Samsung Tizen")).toBeVisible();
  await expect(page.locator(`[data-tv-campaign="${SLUG}"]`).getByText("Pārrēķināt bāzi")).toBeVisible();

  // The owner's assistant reads the same figures through the statistics API, with its token only.
  expect((await page.request.get("/api/stats/tv?periods=7")).status()).toBe(404);
  expect(
    (
      await page.request.get("/api/stats/tv", {
        headers: { authorization: "Bearer wrong-token-wrong-token-xx" },
      })
    ).status(),
  ).toBe(404);
  const auth = { authorization: "Bearer e2e-stats-token-0123456789abcdef" };
  const tvJson = await (await page.request.get("/api/stats/tv?periods=7", { headers: auth })).json();
  const mine = tvJson.campaigns.find((c: { slug: string }) => c.slug === SLUG);
  expect(mine.totals.impressions).toBe(5);
  expect(mine.effect.householdSummary.exposed).toBe(1);
  expect(mine.effect.householdSummary.direct).toBe(1);
  expect(mine.pixel.days[0].control).toBe(1);
  const site = await (await page.request.get("/api/stats/site?periods=today", { headers: auth })).json();
  expect(typeof site.visitors).toBe("number");
  expect(site.quality.leftOutVisitorDays).toHaveProperty("suspect");
  expect(JSON.stringify(site)).not.toContain("@");

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
  await expect(page.locator("[data-outcome=ok]")).toHaveText("Kampaņa un tās dati dzēsti.");
  await expect(page.locator(`[data-tv-campaign="${SLUG}"]`)).toHaveCount(0);
  // After deletion the short link leads home, and the pixel still answers.
  const res = await page.request.get(`/tv/${SLUG}`, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
});

test("display campaign: Ad Manager tracker, click link tagged as display, and a flight with TV", async ({
  page,
  browser,
}) => {
  const banner = `${SLUG}-banner`;
  const tv = `${SLUG}-flight`;
  await signIn(page);
  const create = async (name: string, slug: string, kind: "TV" | "Baneris") => {
    const form = page.locator("[data-tv-new]");
    await form.getByLabel("Nosaukums", { exact: true }).fill(name);
    await form.getByLabel("Īsais nosaukums saitē (neobligāti)").fill(slug);
    await form.getByLabel("Veids").selectOption({ label: kind });
    if (kind === "Baneris") await form.getByLabel("Vietne, kurā rādīs baneri (tikai banerim)").fill("tv3.lv");
    await form.getByRole("button", { name: "Izveidot kampaņu" }).click();
    await expect(page.locator("[data-outcome=ok]")).toHaveText("Kampaņa izveidota.");
  };
  await create("E2E baneris", banner, "Baneris");
  await create("E2E TV pāris", tv, "TV");

  const card = page.locator(`[data-tv-campaign="${banner}"]`);
  await expect(card).toHaveAttribute("data-tv-kind", "display");
  expect(await card.locator("[data-tv-pixel]").inputValue()).toMatch(
    new RegExp(
      `/px/${banner}\\?ord=%%CACHEBUSTER%%&cr=%ecid!&pl=%eaid!&ch=%%SITE%%&pos=%%WIDTH%%x%%HEIGHT%%$`,
    ),
  );
  // No TV effect or Go3 macros on a banner's card.
  await expect(card.locator("[data-tv-effect]")).toHaveCount(0);
  await expect(card.locator("[data-tv-pixel-extended]")).toHaveCount(0);

  // A person's browser loads the banner, then clicks it.
  const viewer = await (
    await browser.newContext({
      userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 e2e-banner/${Date.now()}`,
    })
  ).newPage();
  expect((await viewer.request.get(`/px/${banner}?ord=1&ch=tv3.lv&pos=300x250`)).status()).toBe(200);
  await viewer.goto(`/tv/${banner}`);
  await expect(viewer).toHaveURL(
    new RegExp(`/izvelies\\?utm_source=tv3\\.lv&utm_medium=display&utm_campaign=${banner}$`),
  );
  await viewer.context().close();
  await expect(async () => {
    await page.reload();
    await expect(page.locator(`[data-tv-campaign="${banner}"]`)).toHaveAttribute("data-tv-impressions", "1");
    await expect(page.locator(`[data-tv-campaign="${banner}"]`)).toHaveAttribute("data-tv-links", "1");
  }).toPass({ timeout: 15_000 });

  // The flight: linked from the banner's card, the overlap table appears on both.
  const link = page.locator(`[data-tv-campaign="${banner}"] [data-tv-flight-form]`);
  await link.getByLabel("Mērīt kopā ar kampaņu").selectOption(tv);
  await link.getByRole("button", { name: "Saistīt kampaņas" }).click();
  await expect(page.locator("[data-outcome=ok]")).toHaveText(
    "Kampaņas saistītas. Pārklāšanos skaitām no šī brīža.",
  );
  await expect(page.locator(`[data-tv-campaign="${banner}"] [data-tv-flight="${tv}"]`)).toBeVisible();
  await expect(page.locator(`[data-tv-campaign="${tv}"] [data-tv-flight="${banner}"]`)).toBeVisible();
  await expect(async () => {
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(axe.violations).toEqual([]);
  }).toPass({ timeout: 10_000 });

  for (const slug of [banner, tv]) {
    await page
      .locator(`[data-tv-campaign="${slug}"]`)
      .getByRole("button", { name: "Dzēst kampaņu un tās datus" })
      .click();
    await expect(page.locator("[data-outcome=ok]")).toHaveText("Kampaņa un tās dati dzēsti.");
  }
});

test("the tracker and the short link stay out of search engines", async ({ request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /px/");
  expect(robots).toContain("Disallow: /tv/");
});
