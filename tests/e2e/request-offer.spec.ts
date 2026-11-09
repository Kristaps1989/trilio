import { test, expect, type Browser, type Page } from "@playwright/test";

// One proposal to an "Iegūt lētāk" request whose address is not confirmed
// (docs/REQUEST_OFFER_PLAN.md): the shopper leaves an e-mail and never clicks the
// confirmation link; the admin sees the request under the product, sends one proposal;
// it arrives saying why it came; its link signs that address in and opens the order form.

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

test("an unconfirmed request gets one proposal, saying why, and its link lets that address order", async ({
  page,
  browser,
}) => {
  const shopper = `e2e-request-${test.info().project.name}-${Date.now()}@example.invalid`;
  let productId = "";

  await test.step("the shopper asks for a lower price and does not confirm the address", async () => {
    await page.goto("/izvelies/kitchensmall/kettle");
    await page.getByRole("button", { name: "Tālāk", exact: true }).click();
    await page.getByRole("button", { name: "Budžets nav noteikts" }).click();
    await expect(page).toHaveURL(/\/rezultati\?sub=kettle/);
    const first = picks(page).first();
    productId = ((await first.getAttribute("id")) ?? "").replace(/^p-/, "");
    await first.getByRole("button", { name: "Iegūt lētāk", exact: true }).click();
    const panel = first.getByRole("group", { name: "Uz kādu e-pastu sūtīt piedāvājumu?" });
    await panel.getByLabel("E-pasts").fill(shopper);
    await panel.getByRole("button", { name: "Sūtīt pieprasījumu" }).click();
    await expect(first.getByRole("status")).toContainText(`Piedāvājumu atsūtīsim uz ${shopper}`);
  });

  const admin = await newPage(browser);
  let offerLink = "";

  await test.step("the admin sees the request under the product and sends one proposal", async () => {
    await devLogin(admin, ADMIN, `/admin/pieprasijums/${productId}`);
    await admin.goto(`/admin/pieprasijums/${productId}`);
    const list = admin.locator("[data-lead-request-list]");
    const row = list.getByRole("row").filter({ hasText: shopper });
    await expect(row).toBeVisible();
    await row.getByRole("link", { name: "Sūtīt piedāvājumu" }).click();
    await expect(admin).toHaveURL(new RegExp(`/admin/piedavajumi/jauns\\?product=${productId}&request=`));
    await expect(admin.getByRole("heading", { level: 1 })).toHaveText("Jauns piedāvājums");
    await admin.getByLabel("Tava cena").fill("1");
    await admin.getByRole("button", { name: "Nosūtīt", exact: true }).click();
    await expect(admin).toHaveURL(/\/admin\/piedavajumi\/[0-9a-f-]{36}/);
    await expect(admin.getByRole("status")).toHaveText("Nosūtīts.");
    offerLink = await admin.getByLabel("Saite (var nosūtīt arī pats)").inputValue();
  });

  await test.step("the proposal arrives, says why it came, and has an unsubscribe", async () => {
    let mail: Mail | undefined;
    await expect(async () => {
      mail = (await outbox(page, shopper)).find((m) => m.text.includes("/piedavajums/"));
      expect(mail).toBeDefined();
    }).toPass({ timeout: 10_000 });
    expect(mail!.text).toContain("pieprasīji zemāku cenu šai precei");
    expect(mail!.text).toContain("vairāk nerakstīsim");
    expect(mail!.text).toContain(new URL(offerLink).pathname);
    expect(mail!.text).toMatch(/Atteikties no piedāvājumiem: \S+\/piedavajumi\/atteikties\//);
  });

  await test.step("a second proposal for the same request is not offered", async () => {
    await admin.goto(`/admin/pieprasijums/${productId}`);
    const row = admin.locator("[data-lead-request-list]").getByRole("row").filter({ hasText: shopper });
    await expect(row.getByRole("link", { name: "Sūtīt piedāvājumu" })).toHaveCount(0);
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

  await test.step("a second request's proposal can be stopped from its unsubscribe link", async () => {
    const other = await newPage(browser);
    const stopper = shopper.replace("e2e-request-", "e2e-request-stop-");
    await other.goto("/izvelies/kitchensmall/kettle");
    await other.getByRole("button", { name: "Tālāk", exact: true }).click();
    await other.getByRole("button", { name: "Budžets nav noteikts" }).click();
    const first = picks(other).first();
    await first.getByRole("button", { name: "Iegūt lētāk", exact: true }).click();
    const panel = first.getByRole("group", { name: "Uz kādu e-pastu sūtīt piedāvājumu?" });
    await panel.getByLabel("E-pasts").fill(stopper);
    await panel.getByRole("button", { name: "Sūtīt pieprasījumu" }).click();
    await expect(first.getByRole("status")).toContainText(stopper);

    await admin.goto(`/admin/pieprasijums/${productId}`);
    const row = admin.locator("[data-lead-request-list]").getByRole("row").filter({ hasText: stopper });
    await row.getByRole("link", { name: "Sūtīt piedāvājumu" }).click();
    await admin.getByLabel("Tava cena").fill("1");
    await admin.getByRole("button", { name: "Nosūtīt", exact: true }).click();
    await expect(admin.getByRole("status")).toHaveText("Nosūtīts.");

    let unsubscribe = "";
    await expect(async () => {
      const mail = (await outbox(other, stopper)).find((m) => m.text.includes("/piedavajums/"));
      const m = mail?.text.match(/https?:\/\/[^\s]+\/piedavajumi\/atteikties\/[A-Za-z0-9_-]+/);
      expect(m).not.toBeNull();
      unsubscribe = new URL(m![0]).pathname;
    }).toPass({ timeout: 10_000 });
    await other.goto(unsubscribe);
    await expect(other.getByText("Kontu tev nav jāveido.")).toBeVisible();
    await other.getByRole("button", { name: "Atteikties" }).click();
    await expect(other.getByRole("status")).toHaveText(
      "Tavu pieprasījumu dzēsām. Uz šo adresi vairs nerakstīsim.",
    );
    await admin.goto(`/admin/pieprasijums/${productId}`);
    await expect(admin.locator("[data-lead-request-list]").getByText(stopper)).toHaveCount(0);
    await other.context().close();
  });

  await admin.context().close();
});
