import { test, expect, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// The admin as a CRM (docs/CRM_PLAN.md): Uzdevumi with views and filters in
// the URL, the three lists with model code and EAN, a lead record with the
// partner mark (free name + the partner's order number), notes, the confirmed
// cost pre-filling the offer, and the CSV of exactly the view.

const ADMIN = "e2e-admin@example.invalid";

async function expectNoAxeViolations(page: Page) {
  await expect(async () => {
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  }).toPass({ timeout: 10_000 });
}

async function devLogin(page: Page, email: string, callbackUrl: string) {
  await page.goto(`/ienakt?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  await page.getByLabel("E-pasts").last().fill(email);
  await page.getByRole("button", { name: "Ienākt bez paroles" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/ienakt"));
}

async function newPage(browser: Browser) {
  const { baseURL, viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = test.info().project.use;
  const context = await browser.newContext({
    baseURL,
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
  });
  return context.newPage();
}

async function noSideScroll(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
  ).toBe(false);
}

test.setTimeout(120_000);

test("a lead from a saved product: found by EAN, marked for a partner, noted, offered at the confirmed cost", async ({
  page,
  browser,
}) => {
  const shopper = `e2e-crm-${test.info().project.name}-${Date.now()}@example.invalid`;
  let ean = "";

  await test.step("a shopper asks to hear about a product", async () => {
    await devLogin(page, shopper, "/");
    // Its own category per screen size, which no other test saves from, so parallel runs never meet.
    const sub = test.info().project.name === "desktop" ? "micro" : "toaster";
    await page.goto(`/rezultati?sub=${sub}`);
    const cards = page.locator('main article[id^="p-"]');
    await expect(cards.first()).toBeVisible();
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    const first = cards.nth(count - 1);
    // The card's own model line ("Modelis … · EAN …"), so the next line's digits never run into it.
    ean =
      (
        (await first
          .getByText(/EAN \d{8,14}/)
          .first()
          .textContent()) ?? ""
      ).match(/EAN (\d{8,14})/)?.[1] ?? "";
    expect(ean).not.toBe("");
    await first.getByRole("button", { name: "Paziņot, kad cena samazināsies", exact: true }).click();
    await expect(
      first.getByRole("button", { name: "Paziņosim, kad cena samazināsies", exact: true }),
    ).toBeEnabled();
  });

  const admin = await newPage(browser);
  await test.step("Uzdevumi: views with counts, filters in the URL, nothing sideways on a phone", async () => {
    await devLogin(admin, ADMIN, "/admin");
    await expect(admin.getByRole("heading", { level: 1 })).toHaveText("Uzdevumi");
    const views = admin.getByRole("navigation", { name: "Skati" });
    await expect(views.getByRole("link", { name: /^Vajag rīcību \d+$/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    for (const v of ["Gaida partneri", "Gaida klientu", "Pabeigti", "Visi"])
      await expect(views.getByRole("link", { name: new RegExp(`^${v} \\d+$`) })).toBeVisible();
    await expect(admin.getByRole("heading", { name: "Skaitļi" })).toBeVisible();
    await expectNoAxeViolations(admin);
    await noSideScroll(admin);
    // The filter form writes the view into the URL.
    const filters = admin.getByRole("search", { name: "Filtri" });
    await filters.getByLabel("Periods").selectOption("today");
    await filters.getByLabel("Veids").selectOption("lead");
    await filters.getByLabel("Meklēt").fill(ean);
    await filters.getByRole("button", { name: "Rādīt" }).click();
    await admin
      .getByRole("navigation", { name: "Skati" })
      .getByRole("link", { name: /^Visi \d+$/ })
      .click();
    await expect(admin).toHaveURL((u) => {
      const q = new URL(u).searchParams;
      return q.get("range") === "today" && q.get("kind") === "lead" && q.get("q") === ean;
    });
    await expect(admin.locator("[data-crm-total]")).toHaveText("Rāda 1 no 1");
    const row = admin.getByRole("row").filter({ hasText: `EAN ${ean}` });
    await expect(row).toContainText("Pieprasījums");
    await expect(row).toContainText("saglabāja");
  });

  await test.step("the lead record: who saved it, a partner request with its number, a note", async () => {
    await admin.goto(`/admin/pieprasijums?q=${ean}`);
    await expect(admin.locator("[data-crm-total]")).toHaveText("Rāda 1 no 1");
    await admin
      .getByRole("row")
      .filter({ hasText: `EAN ${ean}` })
      .getByRole("link")
      .first()
      .click();
    await expect(admin).toHaveURL(/\/admin\/pieprasijums\/[0-9a-f-]{36}$/);
    const leadUrl = admin.url();
    await expect(admin.getByRole("region", { name: "Kas saglabāja" })).toContainText(shopper);
    await expect(admin.locator("[data-ean]")).toHaveText(ean);
    const form = admin.locator("[data-partner-form]");
    await form.getByText("Atzīmēt partnera pieprasījumu").click();
    await form.getByLabel("Partneris", { exact: true }).fill("Elkor");
    await form.getByLabel("Partnera pasūtījuma nr.").fill("E2E-LEAD-1");
    await form.getByLabel("Piezīme").fill("Prasīju cenu");
    await form.getByRole("button", { name: "Saglabāt" }).click();
    await expect(admin.getByRole("status").filter({ hasText: "Partnera atzīme saglabāta." })).toBeVisible();
    await expect(admin.locator("[data-next-step]")).toHaveAttribute("data-next-step", "record_answer");
    await expect(admin.locator("[data-record-product] [data-partner]")).toContainText("Elkor #E2E-LEAD-1");
    await admin.getByLabel("Piezīme").last().fill("Partneris atbildēs pirmdien");
    await admin.getByRole("button", { name: "Pievienot piezīmi" }).click();
    await expect(admin.locator("[data-lead-notes]")).toContainText("Partneris atbildēs pirmdien");
    await expectNoAxeViolations(admin);
    await noSideScroll(admin);

    // "Gaida partneri" and the partner filter both list it; the partner's number finds it.
    await admin.goto(`/admin?state=partner&q=E2E-LEAD-1`);
    await expect(admin.getByRole("row").filter({ hasText: `EAN ${ean}` })).toBeVisible();
    await admin.goto(`/admin/pieprasijums?partner=requested&q=${ean}`);
    await expect(admin.getByRole("row").filter({ hasText: `EAN ${ean}` })).toContainText("Prasīts partnerim");

    // The partner confirms at a cost: the lead is Trilio's turn again, and the offer form starts at that cost.
    await admin.goto(leadUrl);
    await form.getByText("Atzīmēt partnera pieprasījumu").click();
    await form.getByText("Partneris apstiprināja").click();
    await form.getByLabel("Iepirkuma cena, € (ja apstiprināts)").fill("12,50");
    await form.getByRole("button", { name: "Saglabāt" }).click();
    await expect(admin.locator("[data-next-step]")).toHaveAttribute("data-next-step", "make_offer");
    await admin
      .locator("[data-partner-history]")
      .locator("..")
      .getByText(/Partnera vēsture/)
      .click();
    await expect(admin.locator("[data-partner-history] li").first()).toContainText("Partneris apstiprināja");
    await admin.goto(
      `${new URL(leadUrl).pathname.replace("/admin/pieprasijums/", "/admin/piedavajumi/jauns?product=")}&all=1`,
    );
    await expect(admin.getByLabel("Iepirkuma cena")).toHaveValue("12,50");
  });

  await test.step("the three lists share the filters; the CSV is exactly the view", async () => {
    for (const [path, heading] of [
      ["/admin/pieprasijums", "Pieprasījums"],
      ["/admin/piedavajumi", "Piedāvājumi"],
      ["/admin/pasutijumi", "Pasūtījumi"],
    ] as const) {
      await admin.goto(`${path}?range=7d`);
      await expect(admin.getByRole("heading", { level: 1 })).toHaveText(heading);
      await expect(admin.getByRole("search", { name: "Filtri" }).getByLabel("Periods")).toHaveValue("7d");
      await expect(admin.locator("[data-crm-total]")).toHaveText(/^Rāda \d+ no \d+$/);
      await expectNoAxeViolations(admin);
      await noSideScroll(admin);
    }
    const csv = await admin.request.get(`/admin/uzdevumi/csv?state=all&kind=lead&q=${ean}`);
    expect(csv.status()).toBe(200);
    const body = await csv.text();
    expect(body.split("\n")[0]).toContain("model_code,ean");
    expect(body).toContain(ean);
    expect(body).toContain("Elkor");
    expect(
      body
        .trim()
        .split("\n")
        .filter((l) => l.includes(ean)),
    ).toHaveLength(1);
  });
});

test("signed out or not an admin: Uzdevumi and its CSV stay closed", async ({ page }) => {
  const res = await page.request.get("/admin/uzdevumi/csv");
  expect(res.status()).toBe(404);
  await devLogin(page, `e2e-crm-nobody-${Date.now()}@example.invalid`, "/");
  expect((await page.goto("/admin"))?.status()).toBe(404);
});
