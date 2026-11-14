import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Paid traffic end to end against the fake ads account (docs/GROWTH_PLAN.md):
// an ad visit is credited with the shop click it leads to; the owner builds
// the campaigns (with the comparison-site campaign), sends them paused,
// runs the optimiser, approves a proposal while a dishonest one is blocked,
// adds a negative, generates and uploads a creative, reads the memo and SEO,
// and pauses everything. One project only: the account is shared state.

const ADMIN = "e2e-admin@example.invalid";

async function expectNoAxeViolations(page: Page) {
  // After a form action the page refreshes in place (body, then the streamed <title>); retry
  // until it settles. A real violation stays and still fails.
  await expect(async () => {
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  }).toPass({ timeout: 10_000 });
}

async function signIn(page: Page, callbackUrl: string) {
  await page.goto(`/ienakt?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  await page.getByLabel("E-pasts").last().fill(ADMIN);
  await page.getByRole("button", { name: "Ienākt bez paroles" }).click();
  await page.waitForURL((u) => u.pathname.startsWith(callbackUrl.split("?")[0]!));
}

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop", "one project drives the shared ads account");
});

test("an ad visit is credited with the shop click that follows it", async ({ page, browser }) => {
  const camp = `e2e-camp-${Date.now()}`;
  // sendBeacon bodies are not visible to Playwright: wait for the request itself.
  const beacon = page.waitForRequest((r) => r.url().endsWith("/api/visit"));
  await page.goto(
    `/rezultati?sub=kettle&gclid=e2e-gclid-${Date.now()}&utm_source=google&utm_medium=cpc&utm_campaign=${camp}`,
  );
  await beacon;
  const buy = page
    .getByRole("region", { name: "Ieteiktie varianti" })
    .getByRole("link", { name: /^Pirkt/ })
    .first();
  const url = new URL(page.url());
  const ad = Object.fromEntries([...url.searchParams].filter(([k]) => k !== "sub"));

  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, "/admin/reklama");
  await expect(admin.locator("[data-ads-provider]")).toHaveAttribute("data-ads-provider", "mock");
  const credited = async () => {
    await admin.reload();
    return Number(
      (await admin.locator("[data-ad-conversions]").getAttribute("data-ad-conversions"))!.split("/")[0],
    );
  };
  // The landing is written after the beacon's answer, and the visit endpoint rate-limits
  // one address (all of CI shares one). Until the click is credited: send the landing
  // again from the same browser, then click through to the shop.
  await expect
    .poll(
      async () => {
        await page.request.post("/api/visit", { data: { path: url.pathname, ad } });
        await page.waitForTimeout(1_000);
        // A person's click on the page (a request without the browser's navigation headers
        // counts as suspect, docs/CLICK_QUALITY_PLAN.md): the question first, then the shop.
        // The shop itself is not part of the test; reaching its address is.
        await page.goto(url.href);
        const reached = page.waitForRequest((r) => r.url().startsWith("https://example.invalid/"));
        await buy.click();
        const sheet = page.locator("[data-ask-sheet]");
        // The first click asks the question; once answered, the card goes straight to the shop.
        const asked = await sheet.waitFor({ timeout: 3_000 }).then(
          () => true,
          () => false,
        );
        if (asked) await sheet.locator("[data-ask-shop]").click();
        await reached;
        return credited();
      },
      { timeout: 120_000, intervals: [2_000, 5_000, 10_000] },
    )
    .toBeGreaterThanOrEqual(1);
  await admin.context().close();
});

test("the owner builds, syncs, runs the optimiser and decides", async ({ page }) => {
  await signIn(page, "/admin/reklama");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reklāma");
  await expectNoAxeViolations(page);

  // Settings: one daily number and approve mode.
  const settings = page.locator("[data-ads-settings]");
  await settings.getByLabel("Dienas budžets, €").fill("15");
  await settings.getByLabel("Apstiprināt — es apstiprinu katru").check();
  // Claude reviews weekly by default; the next review day is shown.
  await expect(settings.getByLabel(/Reizi nedēļā/)).toBeChecked();
  await expect(settings.getByLabel("Pārskata diena")).toHaveValue("1");
  await expect(settings.locator("[data-next-review]")).toHaveAttribute(
    "data-next-review",
    /^\d{4}-\d{2}-\d{2}$/,
  );
  await settings.getByRole("button", { name: "Saglabāt iestatījumus" }).click();
  await expect(page.locator("[data-outcome=ok]")).toBeVisible();

  await page.getByRole("button", { name: "Izveidot kampaņas no kategorijām" }).click();
  await expect(page.locator("[data-outcome=ok]")).toContainText(/Izveidotas \d+ kampaņas/);
  await page.getByRole("button", { name: "Nosūtīt uz Google (apturētas)" }).click();
  await expect(page.locator("[data-outcome=ok]")).toContainText(/neizdevās: 0/);

  // Google's numbers, today included, on demand and with the time they were pulled.
  await page.getByRole("button", { name: "Atjaunināt datus no Google" }).click();
  await expect(page.locator("[data-outcome=ok]")).toHaveText("Dati no Google atjaunināti.");
  await expect(page.locator("[data-reports-synced]")).toHaveAttribute("data-reports-synced", /^\d{4}-/);
  await expect(page.locator("[data-reports-synced]")).toContainText("Dati no Google: atjaunināti");
  expect(Number(await page.locator("[data-spend-today]").getAttribute("data-spend-today"))).toBeGreaterThan(
    0,
  );
  await expect(page.getByText("Tēriņi šodien")).toBeVisible();

  await page.getByRole("link", { name: "Kampaņas", exact: true }).click();
  await expect(page.locator('[data-campaign="Search · Konkurenti"]')).toBeVisible();
  await expect(page.locator('[data-campaign="Search · Trilio zīmols"]')).toBeVisible();
  // What to switch on first: the brand campaign leads, Performance Max waits for conversions.
  await expect(page.locator('[data-priority="Search · Trilio zīmols"]')).toHaveAttribute(
    "data-priority-tier",
    "now",
  );
  await expect(page.getByRole("heading", { name: "Meklēšanas kampaņu iestatījumi" })).toBeVisible();
  // Applied once per campaign: on a database that has run this before, nothing is left to apply.
  const tune = page.getByRole("button", { name: "Piemērot iestatījumus Google kontā" });
  if (await tune.isEnabled()) {
    await tune.click();
    await expect(page.locator("[data-outcome=ok]")).toContainText("Iestatījumi piemēroti:");
  }
  await expect(page.locator("[data-untuned]")).toHaveAttribute("data-untuned", "0");
  // Every campaign shows its own sitelinks; the fridge campaign's lead to its "best of" pages.
  await expect(page.locator('[data-sitelinks="Search · Ledusskapji un saldētavas"]')).toContainText(
    "Ledusskapji · Saldētavas",
  );

  // The owner sets the total daily budget here, and the recommendation is redrawn for it.
  const daily = page.locator("[data-daily-budget]");
  await daily.getByLabel("Dienas budžets kopā, €").fill("12");
  await daily.getByRole("button", { name: "Saglabāt budžetu" }).click();
  await expect(page.locator("[data-outcome=ok]")).toHaveText(
    "Dienas budžets saglabāts. Ieteikums pārrēķināts.",
  );
  await expect(daily.getByLabel("Dienas budžets kopā, €")).toHaveValue("12,00");
  await daily.getByLabel("Dienas budžets kopā, €").fill("0");
  await daily.getByRole("button", { name: "Saglabāt budžetu" }).click();
  await expect(page.locator("[data-outcome=error]")).toHaveText("Dienas budžetam jābūt no 1 līdz 500 €.");

  // "Ieslēgt tagad" is a button: it sets the suggested budget and switches the campaign on.
  const brand = "Search · Trilio zīmols";
  const apply = page.locator(`[data-apply="${brand}"]`);
  if (await apply.count()) {
    await apply.click();
    await expect(page.locator("[data-outcome=ok]")).toHaveText("Ieslēgtas: 1, izlaistas: 0.");
  }
  await expect(page.locator(`[data-priority="${brand}"]`).locator("xpath=ancestor::tr")).toContainText(
    "Ieslēgta",
  );
  await expect(page.locator(`[data-budget="${brand}"] input[name=budget]`)).toHaveValue("1,00");

  // One campaign's budget by hand.
  const row = page.locator(`[data-budget="${brand}"]`);
  await row.getByLabel(`Budžets dienā: ${brand}`).fill("1,50");
  await row.getByRole("button", { name: "Saglabāt" }).click();
  await expect(page.locator("[data-outcome=ok]")).toHaveText("Kampaņas budžets saglabāts.");
  await expect(page.locator(`[data-budget="${brand}"] input[name=budget]`)).toHaveValue("1,50");
  await expectNoAxeViolations(page);

  // Account control: Trilio reads the real settings from the ads account. The stand-in account
  // has one campaign moved to a shared budget with conversion bidding, and one campaign Trilio
  // did not create; within one server run it stays fixed once it is put back.
  await page.locator("[data-control-check]").click();
  await expect(page.locator("[data-outcome=ok]")).toHaveText("Google konts pārbaudīts.");
  await expect(page.locator("[data-control-checked]")).toHaveAttribute("data-control-checked", "yes");
  const differs = page.locator("[data-control-state=differs]");
  if (await differs.count()) {
    await expect(differs).toHaveText("1 kampaņa atšķiras no Trilio noteiktā");
    await expect(page.locator("[data-control-issue=shared_budget]")).toContainText(
      "Kopīgs budžets ar citām kampaņām (5,00 € dienā)",
    );
    await expect(page.locator("[data-control-issue=bidding]")).toContainText(
      "Maksimāli konversijas (kopīga stratēģija). Trilio: Maksimāli klikšķi.",
    );
    await expectNoAxeViolations(page);
    await page.locator("[data-control-fix-all]").click();
    await expect(page.locator("[data-outcome=ok]")).toHaveText(
      "Atjaunots: 1. Neizdevās: 0. Vēl atšķiras: 0.",
    );
  }
  await expect(page.locator("[data-control-state=ok]")).toContainText("sakrīt ar Trilio noteikto");
  // The campaign Trilio does not manage is listed, and can be paused from here.
  const foreign = "Zīmols (izveidots Google Ads)";
  await expect(page.locator(`[data-control-foreign="${foreign}"]`)).toBeVisible();
  const pause = page.locator(`[data-control-pause="${foreign}"]`);
  if (await pause.count()) {
    await pause.click();
    await expect(page.locator("[data-outcome=ok]")).toHaveText("Kampaņa apturēta Google kontā.");
  }
  await expect(page.locator(`[data-control-pause="${foreign}"]`)).toHaveCount(0);
  await expectNoAxeViolations(page);
  await expect(page.locator('[data-campaign="Search · Ledusskapji un saldētavas"]')).toBeVisible();
  // Google's "Ad strength": every ad group gets a fresh template ad, the old one is paused.
  await page.getByRole("button", { name: "Atjaunot reklāmu tekstus" }).click();
  await expect(page.locator("[data-outcome=ok]")).toContainText(
    /Jaunas reklāmas: \d+, apturētas vecās: \d+, neizdevās: 0\./,
  );
  await expectNoAxeViolations(page);

  await page.getByRole("link", { name: "Atslēgvārdi" }).click();
  await expect(page.locator('[data-keyword="kurpirkt.lv"]')).toBeVisible();
  await expect(page.locator('[data-keyword="salidzini.lv"]')).toBeVisible();

  await page.getByRole("link", { name: "Pārskats" }).click();
  await page.getByRole("button", { name: "Palaist optimizētāju tagad" }).click();
  await expect(page.locator("[data-outcome=ok]")).toContainText(/Optimizētājs: 3 priekšlikumi/, {
    timeout: 60_000,
  });
  await expect(page.locator("[data-last-run]")).toContainText("e2e: mock kopsavilkums.");

  await page.getByRole("link", { name: "Priekšlikumi" }).click();
  await expect(page.locator('[data-history-status="blocked"]').first()).toContainText(/fake urgency/);
  const cpc = page
    .getByRole("row")
    .filter({ has: page.locator('[data-proposal="set_cpc"]') })
    .first();
  await cpc.getByRole("button", { name: "Apstiprināt" }).click();
  await expect(page.locator("[data-outcome=ok]")).toHaveText("piemērots");
  await expectNoAxeViolations(page);

  // Search terms are labelled, and the owner adds a negative by hand.
  await page.getByRole("link", { name: "Atslēgvārdi" }).click();
  await expect(page.getByText("neatbilst").first()).toBeVisible();
  const form = page.locator("[data-add-negative]");
  await form.getByLabel("Vārds vai frāze").fill("instrukcija pdf");
  await form.getByRole("button", { name: "Pievienot negatīvo" }).click();
  await expect(page.locator("[data-negatives]")).toContainText("instrukcija pdf");
  await expectNoAxeViolations(page);
});

test("creatives: drafts in the brand, approved ones are uploaded; memo and SEO", async ({ page }) => {
  await signIn(page, "/admin/reklama/reklamas");
  await page.getByLabel("Kategorija").selectOption("fridge");
  await page.getByRole("button", { name: "Ģenerēt" }).click();
  await expect(page.locator("[data-outcome=ok]")).toHaveText("Izveidoti melnraksti.");
  const image = page.locator('[data-creative="image"][data-creative-status="draft"]').first();
  const src = await image.locator("img").getAttribute("src");
  const png = await page.request.get(src!);
  expect(png.status()).toBe(200);
  expect(png.headers()["content-type"]).toBe("image/png");
  expect((await png.body()).length).toBeGreaterThan(5000);
  await expect(page.locator('[data-creative="video_script"]').first()).toContainText(
    "3 piemērotākie varianti",
  );
  await image.getByRole("button", { name: "Apstiprināt un augšupielādēt" }).click();
  await expect(page.locator('[data-creative-status="uploaded"]').first()).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByRole("link", { name: "Stratēģija" }).click();
  await expect(page.locator("[data-memo]")).toContainText("Kas strādāja");
  await page.getByLabel("Tava piezīme nākamajai nedēļai").fill("Vairāk uzmanības putekļsūcējiem.");
  await page.getByRole("button", { name: "Saglabāt piezīmi" }).click();
  await expect(page.getByLabel("Tava piezīme nākamajai nedēļai")).toHaveValue(
    "Vairāk uzmanības putekļsūcējiem.",
  );

  await page.getByRole("link", { name: "SEO" }).click();
  await expect(page.locator("[data-seo-query]").first()).toBeVisible();
  await expectNoAxeViolations(page);
});

test("pause everything stops the account; resume brings it back", async ({ page }) => {
  await signIn(page, "/admin/reklama");
  await page.getByRole("button", { name: "Apturēt visu" }).click();
  await expect(page.locator("[data-ads-paused]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ieslēgt kampaņas" })).toBeDisabled();
  await page.getByRole("button", { name: "Atsākt" }).click();
  await expect(page.locator("[data-ads-paused]")).toHaveCount(0);
});

test("the admin preview of a creative is not public", async ({ request }) => {
  const res = await request.get("/api/admin/creatives/00000000-0000-4000-8000-000000000000");
  expect(res.status()).toBe(404);
});
