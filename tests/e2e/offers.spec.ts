import { test, expect, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Personal offers end to end (docs/ADMIN_AND_OFFERS_PLAN.md §5, §9, §10, §11):
// a shopper saves a kettle and says yes to offers under the heart; the admin
// offers it cheaper from the user's page; the shopper accepts on one screen,
// pays (mock Paysera), gets the invoice; the admin ships with Omniva; the
// shopper confirms delivery and withdraws; the admin refunds with a credit
// note. A second offer is accepted from a signed-out phone through the link
// (once), as a company, to a parcel locker.

const ADMIN = "e2e-admin@example.invalid";

async function expectNoAxeViolations(page: Page) {
  // After a form action the page refreshes in place (body, then the streamed <title>); retry
  // until it settles. A real violation stays and still fails.
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
  const { baseURL, viewport, isMobile, hasTouch, storageState, userAgent, deviceScaleFactor } =
    test.info().project.use;
  const context = await browser.newContext({
    baseURL,
    viewport,
    isMobile,
    hasTouch,
    storageState,
    userAgent,
    deviceScaleFactor,
  });
  return context.newPage();
}

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
}

/** The admin makes an offer for the shopper's saved product and returns its link. */
async function makeOffer(admin: Page, shopperEmail: string, price: string): Promise<string> {
  await admin.goto(`/admin/lietotaji?q=${encodeURIComponent(shopperEmail)}`);
  await admin.getByRole("link", { name: shopperEmail }).click();
  await expect(admin.getByText("Piekrīt piedāvājumiem")).toBeVisible();
  await admin.getByRole("link", { name: "Izveidot piedāvājumu" }).first().click();
  await expect(admin.getByRole("heading", { level: 1 })).toHaveText("Jauns piedāvājums");
  await admin.getByLabel("Tava cena").fill(price);
  await admin.getByRole("button", { name: "Nosūtīt", exact: true }).click();
  await expect(admin).toHaveURL(/\/admin\/piedavajumi\/[0-9a-f-]{36}/);
  await expect(admin.getByRole("status")).toHaveText("Nosūtīts.");
  return admin.getByLabel("Saite (var nosūtīt arī pats)").inputValue();
}

test.setTimeout(180_000);

test("offer → one-screen checkout → paid with invoice → shipped → delivered → withdrawn → refunded", async ({
  page,
  browser,
}) => {
  const shopper = `e2e-offer-${test.info().project.name}-${Date.now()}@example.invalid`;
  let product = "";

  await test.step("the shopper saves a kettle and says yes when asked about offers, once", async () => {
    await devLogin(page, shopper, "/");
    await page.goto("/izvelies/kitchensmall/kettle");
    await page.getByRole("button", { name: "Tālāk", exact: true }).click();
    await page.getByRole("button", { name: "Budžets nav noteikts" }).click();
    const first = page.getByRole("region", { name: "Ieteiktie varianti" }).getByRole("article").first();
    product = (await first.getAttribute("aria-label")) ?? "";
    await first.getByRole("button", { name: "Saglabāt", exact: true }).click();
    const ask = first.getByRole("group", { name: "Vai drīkstam reizēm piedāvāt pašu izdevīgāku cenu?" });
    await expect(ask.getByRole("button", { name: "Nē, paldies" })).toBeVisible();
    await ask.getByRole("button", { name: "Jā, sūtiet" }).click();
    await expect(
      first.getByRole("status").filter({ hasText: "Paldies! Rakstīsim tikai par precēm, ko saglabāji." }),
    ).toBeVisible();
  });

  const admin = await newPage(browser);
  let link = "";
  await test.step("the admin types a price; the claim, margin and e-mail update live", async () => {
    await devLogin(admin, ADMIN, `/admin/lietotaji?q=${encodeURIComponent(shopper)}`);
    await admin.getByRole("link", { name: shopper }).click();
    await admin.getByRole("link", { name: "Izveidot piedāvājumu" }).first().click();
    await expect(admin.getByText("Ieraksti cenu, un šeit redzēsi e-pastu")).toBeVisible();
    await admin.getByLabel("Tava cena").fill("1");
    await expect(admin.getByTestId("claim")).toContainText("E-pastā būs:");
    await admin.getByText("Iepirkums (redzi tikai tu)").click();
    await admin.getByLabel("Iepirkuma cena").fill("0,50");
    await expect(admin.getByTestId("margin")).toContainText("Peļņa: 0,50");
    const preview = admin.getByTestId("email-preview");
    await expect(preview).toContainText(`Kristaps no Trilio: ${product} par 1`);
    await expect(preview).toContainText("Tu saglabāji");
    await expect(preview).toContainText("Kāpēc lētāk?");
    await expectNoAxeViolations(admin);
    await noSideScroll(admin);
    await admin.getByRole("button", { name: "Nosūtīt", exact: true }).click();
    await expect(admin.getByRole("status")).toHaveText("Nosūtīts.");
    await expect(admin.getByTestId("email-preview")).toContainText("Skatīt piedāvājumu:");
    link = await admin.getByLabel("Saite (var nosūtīt arī pats)").inputValue();
    expect(link).toMatch(/\/piedavajums\/[A-Za-z0-9_-]{43}$/);
  });

  await test.step("the offer page: one decision, the saving only because it is true", async () => {
    await page.goto(link);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(product);
    const box = page.getByRole("region", { name: "Piedāvājums" });
    await expect(box.locator("[data-price-cents]")).toHaveAttribute("data-price-cents", "100");
    await expect(box.getByText(/lētāk nekā zemākā cena veikalos pēdējās 30 dienās/)).toBeVisible();
    await expect(box.getByText(/^Piegāde Latvijā bez maksas, līdz /)).toBeVisible();
    await expect(box.getByText("Kāpēc lētāk?", { exact: false })).toBeVisible();
    await expect(box.getByRole("button")).toHaveCount(1);
    await expect(page.locator("meta[name=robots]")).toHaveAttribute("content", /noindex/);
    await expectNoAxeViolations(page);
    await noSideScroll(page);
    await box.getByRole("button", { name: "Pieņemt piedāvājumu" }).click();
    await expect(page).toHaveURL(/\/piedavajums\/[^/]+\/pasutit$/);
  });

  await test.step("checkout fits one screen of fields and names the amount", async () => {
    await expect(page.getByRole("button", { name: "Apmaksāt 1 €" })).toBeVisible();
    await expect(page.getByText(/^Piegāde Latvijā bez maksas, līdz /)).toBeVisible();
    await expect(page.getByLabel("Uzņēmuma nosaukums")).toHaveCount(0);
    await page.getByLabel("Vārds, uzvārds").fill("Anna Bērziņa");
    await page.getByLabel("Telefons").fill("20 000 000");
    await page.getByLabel("Iela, māja, dzīvoklis").fill("Brīvības iela 1-2");
    await page.getByLabel("Pilsēta").fill("Rīga");
    await page.getByLabel("Pasta indekss").fill("105");
    await page.getByRole("button", { name: "Apmaksāt 1 €" }).click();
    await expect(page.getByText("Pasta indekss ir formā LV-1050.")).toBeVisible();
    await expect(page.getByText("Lai turpinātu, jāpiekrīt noteikumiem.")).toBeVisible();
    await expect(page.getByLabel("Pasta indekss")).toHaveAttribute("aria-invalid", "true");
    await expectNoAxeViolations(page);
    await noSideScroll(page);
    await page.getByLabel("Pasta indekss").fill("1050");
    await page.getByRole("checkbox", { name: /Piekrītu Pirkuma noteikumiem un zinu/ }).check();
    await page.getByRole("button", { name: "Apmaksāt 1 €" }).click();
    await page.getByRole("button", { name: "Maksāt (tests)" }).click();
    await expect(page).toHaveURL(/\/konts\/pasutijumi\/[0-9a-f-]{36}\?apmaksats=1/);
    await expect(page.getByText("Paldies! Maksājums saņemts.")).toBeVisible();
    await expect(page.getByTestId("order-status")).toHaveText(/^Sagatavojam sūtīšanai\. Piegāde līdz /);
    await expectNoAxeViolations(page);
  });

  const orderUrl = page.url().replace(/\?.*$/, "");
  const orderNumber = (
    (await page
      .getByText(/^Pasūtījums T-/)
      .first()
      .textContent()) ?? ""
  ).replace("Pasūtījums ", "");
  expect(orderNumber).toMatch(/^T-[2-9A-Z]{6}$/);
  await test.step("the invoice is Trilio's, without VAT until registered", async () => {
    await page.getByRole("link", { name: /^Rēķins TR-\d{4}-\d{4}$/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Rēķins TR-\d{4}-\d{4}$/);
    await expect(page.getByText("PVN nav piemērojams")).toBeVisible();
    await expect(page.getByText("Anna Bērziņa")).toBeVisible();
    await expect(page.getByText("Piegāde Latvijā")).toBeVisible();
    await expectNoAxeViolations(page);
  });

  await test.step("the admin sees it on Šodien and ships it with Omniva", async () => {
    await admin.goto("/admin");
    const todo = admin.getByRole("region", { name: "Jāizdara" });
    await todo.getByRole("link", { name: new RegExp(`Jānosūta.*${orderNumber}`) }).click();
    await expect(admin).toHaveURL(/\/admin\/pasutijumi\/[0-9a-f-]{36}$/);
    await expect(admin.getByText("Anna Bērziņa")).toBeVisible();
    await expect(admin.getByText("+371 20000000")).toBeVisible();
    await admin.getByRole("button", { name: "Sagatavots sūtīšanai" }).click();
    await expect(admin.getByRole("status")).toHaveText("Gatavs: Sagatavots sūtīšanai");
    await admin.getByLabel("Sūtījuma numurs").fill("CE123456789EE");
    await admin.getByRole("button", { name: "Nodots kurjeram" }).click();
    await expect(admin.getByRole("status")).toHaveText("Gatavs: Nodots kurjeram");
    await expectNoAxeViolations(admin);
    await noSideScroll(admin);
    await admin.getByRole("link", { name: "Pavadzīme" }).click();
    await expect(admin.getByText("1 × " + product)).toBeVisible();
    await admin.goBack();
  });

  await test.step("the shopper tracks it, confirms delivery and withdraws within 14 days", async () => {
    await page.goto(orderUrl);
    await expect(page.getByTestId("order-status")).toHaveText(/^Nodots kurjeram \(Omniva\)/);
    await expect(page.getByRole("link", { name: /Sekot sūtījumam/ })).toHaveAttribute(
      "href",
      "https://www.omniva.lv/sutijumu-izsekosana/?barcode=CE123456789EE",
    );
    await page.getByRole("button", { name: "Saņēmu preci" }).click();
    await expect(page.getByTestId("order-status")).toHaveText(/^Piegādāts /);
    await expect(page.getByText(/^Līdz .*, bez iemesla, atgriešana bez maksas$/)).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole("button", { name: "Atteikties no pirkuma" }).click();
    await expect(page.getByTestId("order-status")).toHaveText(/^Atteikums saņemts/);
    await expect(page.getByRole("button", { name: "Atteikties no pirkuma" })).toHaveCount(0);
  });

  await test.step("the admin takes it back and refunds with a credit note", async () => {
    await admin.reload();
    await expect(admin.getByText("Atteikums pieteikts").first()).toBeVisible();
    await admin.getByRole("button", { name: "Atgriešana saņemta" }).click();
    await admin.getByLabel("Atmaksas atsauce").fill("MOCK-REFUND-1");
    await admin.getByRole("button", { name: "Atmaksāts" }).click();
    await expect(admin.getByRole("status")).toHaveText("Gatavs: Atmaksāts");
    await expect(admin.getByRole("link", { name: /^Kredītrēķins TR-/ })).toBeVisible();
    await expect(admin.getByText("Pasūtījums noslēgts.")).toBeVisible();
    await page.goto(orderUrl);
    await expect(page.getByTestId("order-status")).toHaveText("Nauda atmaksāta.");
    await expect(page.getByRole("link", { name: /^Kredītrēķins TR-/ })).toBeVisible();
  });

  await test.step("a second offer: the link signs in once, a company buys to a parcel locker", async () => {
    const second = await makeOffer(admin, shopper, "2");
    const phone = await newPage(browser);
    await phone.goto(second);
    await phone.getByRole("button", { name: "Pieņemt piedāvājumu" }).click();
    await expect(phone).toHaveURL(/\/pasutit$/);
    await expect(phone.getByRole("button", { name: "Apmaksāt 2 €" })).toBeVisible();

    const forwarded = await newPage(browser);
    await forwarded.goto(second);
    await forwarded.getByRole("button", { name: "Pieņemt piedāvājumu" }).click();
    await expect(forwarded).toHaveURL(/\/ienakt\?callbackUrl=/);
    await forwarded.context().close();

    await phone.getByText("Uzņēmums", { exact: true }).click();
    await phone.getByLabel("Uzņēmuma nosaukums").fill("SIA Bērziņi");
    await phone.getByLabel("Reģistrācijas numurs").fill("123");
    await phone.getByText("Omniva pakomāts").click();
    await expect(phone.getByLabel("Iela, māja, dzīvoklis")).toHaveCount(0);
    await phone
      .getByLabel("Kurš pakomāts?")
      .selectOption({ label: "Rīga Centrs pakomāts — Elizabetes iela 10" });
    await phone.getByLabel("Telefons").fill("29999999");
    await phone.getByLabel("Vārds, uzvārds").fill("Anna Bērziņa");
    await phone.getByRole("checkbox", { name: "Piekrītu Pirkuma noteikumiem." }).check();
    await phone.getByRole("button", { name: "Apmaksāt 2 €" }).click();
    await expect(phone.getByText("Reģistrācijas numurā ir 11 cipari.")).toBeVisible();
    await phone.getByLabel("Reģistrācijas numurs").fill("40003000000");
    await phone.getByRole("checkbox", { name: "Piekrītu Pirkuma noteikumiem." }).check();
    await phone.getByRole("button", { name: "Apmaksāt 2 €" }).click();
    await phone.getByRole("button", { name: "Maksāt (tests)" }).click();
    await expect(phone.getByText("Paldies! Maksājums saņemts.")).toBeVisible();
    await expect(phone.getByText(/Rīga Centrs pakomāts/)).toBeVisible();
    await expect(phone.getByRole("button", { name: "Atteikties no pirkuma" })).toHaveCount(0);
    await phone.getByRole("link", { name: /^Rēķins TR-/ }).click();
    await expect(phone.getByText("SIA Bērziņi")).toBeVisible();
    await expect(phone.getByText("Reģ. Nr. 40003000000")).toBeVisible();
    await phone.goto(second);
    await expect(phone.getByRole("status")).toHaveText("Šis piedāvājums jau ir apmaksāts.");
    await phone.context().close();
  });

  await test.step("saying no to offers is one checkbox, and the admin can no longer offer", async () => {
    await page.goto("/velmju-saraksts");
    const consent = page.getByRole("checkbox", {
      name: "Vēlos saņemt personīgus piedāvājumus par saglabātajām precēm",
    });
    await expect(consent).toBeChecked();
    await consent.uncheck();
    await expect(page.getByText("Personīgus piedāvājumus vairs nesūtīsim.")).toBeVisible();
    await admin.goto(`/admin/lietotaji?q=${encodeURIComponent(shopper)}`);
    await admin.getByRole("link", { name: shopper }).click();
    await expect(admin.getByText("Nepiekrīt piedāvājumiem")).toBeVisible();
    await expect(admin.getByRole("link", { name: "Izveidot piedāvājumu" })).toHaveCount(0);
  });

  await test.step("my orders, data export and account deletion", async () => {
    await page.goto("/konts/pasutijumi");
    await expect(
      page.getByRole("link", { name: new RegExp(product.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }),
    ).toHaveCount(2);
    await expectNoAxeViolations(page);
    const exported = await page.request.get("/api/account/export");
    const data = await exported.json();
    expect(data.orders).toHaveLength(2);
    expect(JSON.stringify(data)).not.toContain("costCents");
    expect(JSON.stringify(data)).not.toContain("feedbackToken");
    await page.goto("/konts");
    await page.getByRole("button", { name: "Dzēst kontu" }).click();
    await page.getByRole("button", { name: "Jā, dzēst" }).click();
    await page.waitForURL(/\/\?deleted=1/);
  });
  await admin.context().close();
});

test("an unknown or draft offer link is a 404; the purchase terms cover both kinds of buyer", async ({
  page,
}) => {
  const res = await page.goto("/piedavajums/not-a-real-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  expect(res?.status()).toBe(404);
  await page.goto("/pirkuma-noteikumi");
  await expect(page.getByRole("heading", { name: "Privātpersonām: atteikuma tiesības" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Uzņēmumiem" })).toBeVisible();
  // Once in the "Īsumā" summary at the top, once in the full text.
  await expect(page.getByRole("region", { name: "Īsumā" })).toContainText(
    "Piegāde Latvijā vienmēr ir bez maksas.",
  );
  await expect(page.getByText("Piegāde Latvijā vienmēr ir bez maksas.")).toHaveCount(2);
  const unsub = await page.request.post("/api/offers/unsubscribe/not-a-token", {
    data: "List-Unsubscribe=One-Click",
  });
  expect(unsub.status()).toBe(200);
  await page.goto("/piedavajumi/atteikties/not-a-token");
  await page.getByRole("button", { name: "Atteikties" }).click();
  await expect(page.getByRole("status")).toHaveText(/vairs nesūtīsim/);
});
