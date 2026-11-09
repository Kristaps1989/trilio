import { test, expect, type Browser, type Page } from "@playwright/test";

// "Iegūt lētāk" without any confirmation (docs/ALERTS_WITHOUT_CONFIRM_PLAN.md): the
// shopper leaves an e-mail and never clicks anything; that is the consent, so the admin
// sees a saver who accepts offers and sends a proposal; its link signs that address in
// and opens the order form. A second shopper unsubscribes from the receipt instead, and
// everything for that address is gone.

const ADMIN = "e2e-admin@example.invalid";

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

type Mail = { subject: string; text: string };

async function outbox(page: Page, email: string): Promise<Mail[]> {
  return (await (
    await page.request.get(`/api/test/outbox?to=${encodeURIComponent(email)}`)
  ).json()) as Mail[];
}

const picks = (page: Page) => page.getByRole("region", { name: "Ieteiktie varianti" }).getByRole("article");

test.setTimeout(120_000);

async function ask(page: Page, email: string): Promise<string> {
  await page.goto("/izvelies/kitchensmall/kettle");
  await page.getByRole("button", { name: "Tālāk", exact: true }).click();
  await page.getByRole("button", { name: "Budžets nav noteikts" }).click();
  await expect(page).toHaveURL(/\/rezultati\?sub=kettle/);
  const first = picks(page).first();
  const productId = ((await first.getAttribute("id")) ?? "").replace(/^p-/, "");
  await first.getByRole("button", { name: "Iegūt lētāk", exact: true }).click();
  const panel = first.getByRole("group", { name: "Uz kādu e-pastu sūtīt piedāvājumu?" });
  await panel.getByLabel("E-pasts").fill(email);
  await panel.getByRole("button", { name: "Sūtīt pieprasījumu" }).click();
  await expect(first.getByRole("status")).toHaveText(
    `Paldies! Piedāvājumu atsūtīsim uz ${email} 2 darba dienu laikā, un sekosim arī cenai.`,
  );
  return productId;
}

async function linkIn(page: Page, email: string, pattern: RegExp): Promise<string> {
  let found = "";
  await expect(async () => {
    const m = (await outbox(page, email)).map((x) => x.text.match(pattern)).find(Boolean);
    expect(m).toBeTruthy();
    found = new URL(m![0]).pathname;
  }).toPass({ timeout: 10_000 });
  return found;
}

test("a request with no click is a saver who accepts offers; the proposal's link lets that address order", async ({
  page,
  browser,
}) => {
  const shopper = `e2e-request-${test.info().project.name}-${Date.now()}@example.invalid`;
  const productId = await ask(page, shopper);
  const admin = await newPage(browser);
  let offerLink = "";

  await test.step("the admin sees a saver who accepts offers, and sends a proposal", async () => {
    await devLogin(admin, ADMIN, `/admin/pieprasijums/${productId}`);
    await admin.goto(`/admin/pieprasijums/${productId}`);
    const row = admin
      .getByRole("region", { name: "Kas saglabāja" })
      .getByRole("row")
      .filter({ hasText: shopper });
    await expect(row).toBeVisible();
    // Not an unconfirmed request any more: it started at once.
    await expect(admin.locator("[data-lead-request-list]").getByText(shopper)).toHaveCount(0);
    await admin.goto(`/admin/lietotaji?q=${encodeURIComponent(shopper)}`);
    await admin.getByRole("link", { name: shopper }).click();
    await expect(admin.getByText("Piekrīt piedāvājumiem")).toBeVisible();
    await admin.getByRole("link", { name: "Izveidot piedāvājumu" }).first().click();
    await admin.getByLabel("Tava cena").fill("1");
    await admin.getByRole("button", { name: "Nosūtīt", exact: true }).click();
    await expect(admin.getByRole("status")).toHaveText("Nosūtīts.");
    offerLink = await admin.getByLabel("Saite (var nosūtīt arī pats)").inputValue();
  });

  await test.step("the proposal arrives with an unsubscribe", async () => {
    let mail: Mail | undefined;
    await expect(async () => {
      mail = (await outbox(page, shopper)).find((m) => m.text.includes("/piedavajums/"));
      expect(mail).toBeDefined();
    }).toPass({ timeout: 10_000 });
    expect(mail!.text).toContain(new URL(offerLink).pathname);
    expect(mail!.text).toMatch(/Atteikties no piedāvājumiem: \S+\/piedavajumi\/atteikties\//);
  });

  await test.step("the link signs that address in and opens the order form", async () => {
    const phone = await newPage(browser);
    await phone.goto(new URL(offerLink).pathname);
    await phone
      .getByRole("region", { name: "Piedāvājums" })
      .getByRole("button", { name: "Pieņemt piedāvājumu" })
      .click();
    await expect(phone).toHaveURL(/\/piedavajums\/[^/]+\/pasutit$/);
    await expect(phone.getByRole("button", { name: "Apmaksāt 1 €" })).toBeVisible();
    await phone.context().close();
  });

  await test.step("someone who did not ask unsubscribes from the receipt, and the address is gone", async () => {
    const other = await newPage(browser);
    const stopper = shopper.replace("e2e-request-", "e2e-request-stop-");
    await ask(other, stopper);
    const unsubscribe = await linkIn(
      other,
      stopper,
      /https?:\/\/[^\s]+\/velmju-saraksts\/atteikties\/[A-Za-z0-9_-]+/,
    );
    await other.goto(unsubscribe);
    await other.getByRole("button", { name: "Nesūtīt" }).click();
    await expect(other.getByRole("status")).toHaveText(
      "Tavu pieprasījumu dzēsām. Uz šo adresi vairs nerakstīsim.",
    );
    await admin.goto(`/admin/pieprasijums/${productId}`);
    await expect(admin.getByRole("region", { name: "Kas saglabāja" }).getByText(stopper)).toHaveCount(0);
    await other.context().close();
  });

  await admin.context().close();
});
