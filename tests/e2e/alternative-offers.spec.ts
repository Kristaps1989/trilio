import { test, expect, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import postgres from "postgres";

// Answering every price request (docs/ALTERNATIVE_OFFER_PLAN.md): the product asked
// for is unavailable, so the admin offers another maker's product with pictures and a
// description; one shopper gets it at once and says "only my model", another (an
// older request) gets it at once too, with no question first. On a second product there is nothing to
// offer: Trilio suggests why, one short e-mail goes, and a later confirmation brings
// the lead back as "Atkal pieejams".

const ADMIN = "e2e-admin@example.invalid";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAn0lEQVRoge2SQQkAQRDD6ikmq2VVnoh7hIFCBKSh4fU00Q3YgOoV2YV6l+gGbED1iuxCvUt0AzagekV2od4lugEbUL0iu1DvEt2ADahekV2od4luwAZUr8gu1LtEN2ADqldkF+pdohuwAdUrsgv1LtEN2IDqFdmFepfoBmxA9YrsQr1LdAM2oHpFdqHeJboBG1C9IrtQ7xLdgA2oXvEPH2wcUUv3GPUpAAAAAElFTkSuQmCC",
  "base64",
);

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

async function expectNoAxeViolations(page: Page) {
  await expect(async () => {
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  }).toPass({ timeout: 10_000 });
}

async function noSideScroll(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
  ).toBe(false);
}

type Mail = { subject: string; text: string };
async function mailTo(page: Page, email: string, subject: RegExp): Promise<Mail> {
  let found: Mail | undefined;
  await expect(async () => {
    const all = (await (
      await page.request.get(`/api/test/outbox?to=${encodeURIComponent(email)}`)
    ).json()) as Mail[];
    found = all.find((m) => subject.test(m.subject));
    expect(found).toBeDefined();
  }).toPass({ timeout: 10_000 });
  return found!;
}

/** The path and query of the first link in an e-mail that matches. */
function path(text: string, re: RegExp): string {
  const u = new URL(text.match(re)![0]);
  return u.pathname + u.search;
}

/**
 * Every e2e request comes from one address, so the per-visitor limit (5 a day) would stop a
 * full run; the test rows stop counting towards it. Real visitors are not touched.
 */
async function freeRateLimit() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  await sql`update notify_requests set visitor_hash = null where email like 'e2e-%@example.invalid'`;
  await sql.end();
}

/** "Iegūt lētāk" on one card of a category, as a shopper with no account; returns the product id. */
async function ask(page: Page, sub: string, email: string, productId?: string): Promise<string> {
  await freeRateLimit();
  await page.goto(`/rezultati?sub=${sub}`);
  const card = productId
    ? page.locator(`article[id="p-${productId}"]`)
    : page
        .getByRole("region", { name: "Ieteiktie varianti" })
        .getByRole("article")
        .filter({ has: page.getByRole("button", { name: "Iegūt lētāk", exact: true }) })
        .first();
  const id = ((await card.getAttribute("id")) ?? "").replace(/^p-/, "");
  const pinned = page.locator(`article[id="p-${id}"]`);
  await pinned.getByRole("button", { name: "Iegūt lētāk", exact: true }).click();
  const panel = pinned.getByRole("group", { name: "Uz kādu e-pastu sūtīt piedāvājumu?" });
  await panel.getByLabel("E-pasts").fill(email);
  await panel.getByRole("button", { name: "Sūtīt pieprasījumu" }).click();
  await expect(pinned.getByRole("status")).toContainText(email);
  return id;
}

async function markPartner(admin: Page, status: "Nav pieejams" | "Partneris apstiprināja", cost?: string) {
  const form = admin.locator("[data-partner-form]");
  await form.getByText("Atzīmēt partnera pieprasījumu").click();
  await form.getByText(status, { exact: true }).click();
  await form.getByLabel("Partneris", { exact: true }).fill("E2E izplatītājs");
  if (cost) await form.getByLabel("Iepirkuma cena, € (ja apstiprināts)").fill(cost);
  await form.getByRole("button", { name: "Saglabāt" }).click();
  await expect(admin.getByRole("status").filter({ hasText: "Partnera atzīme saglabāta." })).toBeVisible();
}

test.setTimeout(180_000);
test.skip(() => !process.env.DATABASE_URL, "needs the database to make one request an older one");

test("unavailable → another maker's product with a picture: one shopper declines, an older request gets it at once too", async ({
  page,
  browser,
}) => {
  const mobile = test.info().project.name !== "desktop";
  const sub = mobile ? "freezer" : "dish";
  const stamp = `${test.info().project.name}-${Date.now()}`;
  const direct = `e2e-alt-direct-${stamp}@example.invalid`;
  const older = `e2e-alt-older-${stamp}@example.invalid`;
  const productId = await ask(page, sub, direct);
  const other = await newPage(browser);
  await ask(other, sub, older, productId);
  // The second request saw the text before 16 Nov 2026, which did not mention an alternative.
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  await sql`update notify_requests set consent = 'notify.body@2026-11-09.2' where email = ${older}`;
  await sql.end();

  const admin = await newPage(browser);
  await test.step("the partner says unavailable: the lead is Trilio's to decide", async () => {
    await devLogin(admin, ADMIN, `/admin/pieprasijums/${productId}`);
    await admin.goto(`/admin/pieprasijums/${productId}`);
    await markPartner(admin, "Nav pieejams");
    await expect(admin.locator("[data-next-step]")).toHaveAttribute("data-next-step", "decide_unavailable");
    const panel = admin.locator("[data-decision-panel]");
    await expect(panel).toBeVisible();
    const table = admin.locator("[data-answers-table]");
    await expect(table.getByRole("row").filter({ hasText: direct })).toContainText("Saņems uzreiz");
    await expect(table.getByRole("row").filter({ hasText: older })).toContainText("Saņems uzreiz");
    await expectNoAxeViolations(admin);
    await noSideScroll(admin);
    // Uzdevumi has the view for it.
    await admin.goto("/admin?state=action&partner=unavailable&kind=lead");
    await expect(
      admin.getByRole("link", { name: "Izlemt: alternatīva vai nav ko piedāvāt" }).first(),
    ).toBeVisible();
  });

  await test.step("the admin picks a suggestion, adds a picture and a description, and sees the e-mail", async () => {
    await admin.goto(`/admin/pieprasijums/${productId}`);
    await admin.getByTestId("offer-alternative").click();
    await expect(admin.locator("[data-suggestions]")).toBeVisible();
    await admin.locator("[data-suggestion-id]").first().click();
    await expect(admin.locator("[data-comparison]")).toBeVisible();
    // Keep only this test's two shoppers (other runs may have left requests on the product).
    for (const box of await admin.locator('input[name="keys"]').all()) {
      const label = (await box.locator("xpath=..").textContent()) ?? "";
      if (!label.includes(direct) && !label.includes(older)) await box.uncheck();
    }
    await expect(admin.locator("[data-alt-split]")).toHaveText(
      "Piedāvājums aizies uzreiz katram atzīmētajam.",
    );
    const limits = admin.locator("[data-limit-original]");
    const seen = Number(await limits.getAttribute("data-limit-original"));
    const shop = Number((await limits.getAttribute("data-limit-shop")) || seen + 100);
    // Too high first: the hard rule blocks sending and says why.
    await admin
      .getByLabel("Cena (EUR)", { exact: true })
      .fill(String(Math.ceil((Math.max(seen, shop) + 100) / 100)));
    await expect(admin.locator("[data-price-problems]")).toBeVisible();
    await expect(admin.getByTestId("send-alternative")).toBeDisabled();
    const price = Math.floor((Math.min(seen, shop) - 100) / 100);
    await admin.getByLabel("Cena (EUR)", { exact: true }).fill(String(price));
    await expect(admin.getByText("Cena atbilst abiem noteikumiem.")).toBeVisible();
    // A link that is not https is refused with a clear reason; what was typed stays.
    await admin.getByTestId("picture-link").fill("http://example.com/a.jpg");
    await admin.getByLabel("Man ir tiesības izmantot šo bildi").check();
    await admin.getByRole("button", { name: "Pievienot", exact: true }).click();
    await expect(admin.getByRole("alert").filter({ hasText: "Saitei jābūt ar https://." })).toBeVisible();
    await expect(admin.getByTestId("picture-link")).toHaveValue("http://example.com/a.jpg");
    // A picture from the computer.
    await admin
      .getByTestId("picture-file")
      .setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: PNG });
    await expect(admin.locator("[data-offer-pictures]")).toHaveAttribute("data-offer-pictures", "1");
    // The honesty check stops urgency, then a plain description passes.
    const description = admin.getByLabel("Apraksts (Trilio apraksts)");
    await description.fill("Tikai šodien!");
    await expect(admin.locator("[data-description-problems]")).toBeVisible();
    await description.fill("Klusa, ar ērtu programmu izvēli.");
    await expect(admin.locator("[data-description-problems]")).toHaveCount(0);
    await expect(admin.getByTestId("send-alternative")).toHaveText("Nosūtīt piedāvājumu (2)");
    const mail = admin.frameLocator('[data-testid="email-preview"] iframe');
    await expect(mail.getByRole("heading", { level: 1 })).toContainText("Tavs modelis nav pieejams.");
    await expect(mail.getByText("Tu prasīji", { exact: true }).first()).toBeVisible();
    await expect(mail.getByText("Trilio apraksts")).toBeVisible();
    await expect(mail.getByRole("link", { name: "Gribu tikai pieprasīto modeli" })).toBeVisible();
    // A link clicked in the preview opens a new tab; the preview itself stays (the site refuses framing).
    const [popup] = await Promise.all([
      admin.waitForEvent("popup"),
      mail.getByRole("link", { name: "Gribu tikai pieprasīto modeli" }).click(),
    ]);
    await popup.close();
    await expect(mail.getByRole("heading", { level: 1 })).toContainText("Tavs modelis nav pieejams.");
    await expect(admin.getByTestId("email-subject")).toContainText("nav pieejams — varam piedāvāt");
    await expectNoAxeViolations(admin);
    await noSideScroll(admin);
    await admin.getByTestId("send-alternative").click();
    await expect(admin.locator("[data-answered]")).toHaveText("Alternatīva nosūtīta: 2.");
    const table = admin.locator("[data-answers-table]");
    await expect(table.getByRole("row").filter({ hasText: direct })).toContainText("Alternatīva piedāvāta");
    await expect(table.getByRole("row").filter({ hasText: older })).toContainText("Alternatīva piedāvāta");
  });

  await test.step("the shopper sees the swap at once and says: only my model", async () => {
    const msg = await mailTo(page, direct, /nav pieejams — varam piedāvāt/);
    expect(msg.text).toContain("Tu prasīji:");
    expect(msg.text).toContain("Trilio apraksts");
    await page.goto(path(msg.text, /https?:\/\/\S+\/piedavajums\/[A-Za-z0-9_-]{20,}(?=\s)/));
    await expect(page.getByRole("heading", { name: "Šis nav tevis pieprasītais modelis" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Kā tie atšķiras" })).toBeVisible();
    await expect(page.locator("[data-offer-picture]")).toHaveCount(1);
    await expect(page.getByText("Klusa, ar ērtu programmu izvēli.")).toBeVisible();
    await expectNoAxeViolations(page);
    await noSideScroll(page);
    await page.getByTestId("decline-alternative").click();
    await page.getByTestId("confirm-decline").click();
    await expect(page.locator("[data-declined]")).toBeVisible();
  });

  await test.step("the older request gets the offer at once, with no question first", async () => {
    const msg = await mailTo(other, older, /nav pieejams — varam piedāvāt/);
    await other.goto(path(msg.text, /https?:\/\/\S+\/piedavajums\/[A-Za-z0-9_-]{20,}(?=\s)/));
    await expect(other.getByRole("heading", { name: "Šis nav tevis pieprasītais modelis" })).toBeVisible();
    const all = (await (
      await other.request.get(`/api/test/outbox?to=${encodeURIComponent(older)}`)
    ).json()) as Mail[];
    expect(all.some((m) => /Piedāvāt līdzvērtīgu/.test(m.subject))).toBe(false);
  });

  await admin.goto(`/admin/pieprasijums/${productId}`);
  await expect(
    admin.locator("[data-answers-table]").getByRole("row").filter({ hasText: direct }),
  ).toContainText("Atteicās no alternatīvas");
  await other.context().close();
  await admin.context().close();
});

test("nothing to offer: Trilio suggests why, one short e-mail goes, and a cheaper partner brings it back", async ({
  page,
  browser,
}) => {
  const mobile = test.info().project.name !== "desktop";
  const sub = mobile ? "fridge" : "hood";
  const shopper = `e2e-nothing-${test.info().project.name}-${Date.now()}@example.invalid`;
  const productId = await ask(page, sub, shopper);
  const admin = await newPage(browser);
  await devLogin(admin, ADMIN, `/admin/pieprasijums/${productId}`);
  await admin.goto(`/admin/pieprasijums/${productId}`);

  await test.step("the partner's cost plus margin is not below the shops: Trilio suggests nothing to offer", async () => {
    await markPartner(admin, "Partneris apstiprināja", "99999");
    await expect(admin.locator("[data-suggestion]")).toHaveAttribute(
      "data-suggestion",
      "partner_not_cheaper",
    );
    const form = admin.locator("[data-nothing-form]");
    await expect(form.getByLabel("Partneris nevar lētāk")).toBeChecked();
    await form.getByText("E-pasta priekšskatījums").click();
    await expect(
      form.frameLocator('[data-testid="email-preview"] iframe').getByRole("heading", { level: 1 }),
    ).toHaveText("Šoreiz lētāk nesanāca.");
    await expectNoAxeViolations(admin);
    await noSideScroll(admin);
    await form.getByTestId("nothing-submit").click();
    await expect(admin.locator("[data-answered]")).toContainText(/Atzīmēti \d+, e-pasti nosūtīti \d+\./);
    await expect(
      admin.locator("[data-answers-table]").getByRole("row").filter({ hasText: shopper }),
    ).toContainText("Nav ko piedāvāt · seko cenai");
  });

  await test.step("the shopper gets one short e-mail and nothing else", async () => {
    const msg = await mailTo(page, shopper, /šobrīd nevaram piedāvāt lētāk/);
    expect(msg.text).toContain("Turpinām sekot cenai");
    expect(msg.text).not.toMatch(/\/piedavajums\//);
  });

  await test.step("a partner confirms a lower cost later: Atkal pieejams", async () => {
    await markPartner(admin, "Partneris apstiprināja", "1");
    await expect(admin.locator("[data-next-step]")).toHaveAttribute("data-next-step", "make_offer");
    await expect(admin.locator("[data-next-step]")).toContainText("Atkal pieejams");
  });

  await test.step("bulk on the list: price monitoring only, and the margin setting", async () => {
    const ean = (await admin.locator("[data-ean]").textContent())?.trim() ?? "";
    await admin.goto(`/admin/pieprasijums?q=${ean}`);
    await admin.locator(`input[name="productIds"][value="${productId}"]`).check();
    await admin.getByTestId("bulk-leads-monitoring").click();
    await expect(admin.locator("[data-bulk-done]")).toHaveAttribute("data-bulk-done", "monitoring");
    await admin.goto("/admin/sistema");
    const margin = admin.getByRole("region", { name: "Minimālais uzcenojums" });
    await margin.getByLabel("Uzcenojums virs iepirkuma (%)").fill("3");
    await margin.getByRole("button", { name: "Saglabāt", exact: true }).click();
    await expect(admin.locator("[data-margin]")).toHaveAttribute("data-margin", "saved");
  });
  await admin.context().close();
});
