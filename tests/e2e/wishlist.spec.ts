import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// "Pieprasīt labāku cenu" (docs/PRICE_NOTIFY_PLAN.md): one tap saves
// a product or a whole search and turns free price e-mails on; signed out, the
// card asks for an e-mail and one confirmation link does the rest; where
// Trilio sources (fridges), the one yes also covers Trilio's own offers. The
// wishlist shows today's best offer and the price history. Runs against the
// seeded sample data with the dev login and the dev outbox.

async function expectNoAxeViolations(page: Page) {
  await expect(page).toHaveTitle(/.+/);
  // A tapped button fades back in (transition-opacity) after its save; retry until it settles.
  // A real violation stays and still fails.
  await expect(async () => {
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  }).toPass({ timeout: 5_000 });
}

async function signInOnPage(page: Page, email: string) {
  await page.getByLabel("E-pasts").last().fill(email);
  await page.getByRole("button", { name: "Ienākt bez paroles" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/ienakt"));
}

async function devLogin(page: Page, email: string, callbackUrl = "/velmju-saraksts") {
  await page.goto(`/ienakt?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  await signInOnPage(page, email);
}

async function fridgeResults(page: Page) {
  await page.goto("/rezultati?sub=fridge");
  await expect(picks(page).first()).toBeVisible();
}

/** The confirmation link from the dev outbox (ALLOW_INSECURE_TEST_FEATURES, no RESEND_API_KEY). */
async function confirmationLink(page: Page, email: string): Promise<string> {
  let link = "";
  await expect(async () => {
    const mails = (await (
      await page.request.get(`/api/test/outbox?to=${encodeURIComponent(email)}`)
    ).json()) as {
      subject: string;
      text: string;
    }[];
    const m = mails.at(-1)?.text.match(/https?:\/\/[^\s]+\/pazinot\/[A-Za-z0-9_-]+/);
    expect(m).not.toBeNull();
    link = new URL(m![0]).pathname;
  }).toPass({ timeout: 10_000 });
  return link;
}

async function kettleResults(page: Page) {
  await page.goto("/izvelies/kitchensmall/kettle");
  await page.getByRole("button", { name: "Tālāk", exact: true }).click();
  await page.getByRole("button", { name: "Budžets nav noteikts" }).click();
  await expect(page).toHaveURL(/\/rezultati\?sub=kettle/);
}

const picks = (page: Page) => page.getByRole("region", { name: "Ieteiktie varianti" }).getByRole("article");

async function deleteAccount(page: Page) {
  await page.goto("/konts");
  await page.getByRole("button", { name: "Dzēst kontu" }).click();
  await page.getByRole("button", { name: "Jā, dzēst" }).click();
  await page.waitForURL(/\/\?deleted=1/);
}

test.describe.configure({ mode: "serial" });

test("wishlist: signed out shows sign-in only; old radar links land on it; endpoints need auth", async ({
  page,
  request,
}) => {
  await page.goto("/velmju-saraksts");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tavs vēlmju saraksts");
  await expect(page.getByRole("link", { name: "Ienākt" }).last()).toBeVisible();
  await expectNoAxeViolations(page);
  await page.goto("/radars/jauns?product=x");
  await expect(page).toHaveURL(/\/velmju-saraksts(\?|$)/);
  // The paid plan is gone: no renewals to run.
  expect((await request.post("/api/cron/billing")).status()).toBe(404);
  expect((await request.get("/api/account/export")).status()).toBe(401);
});

test("signed out: one e-mail field on the card, one confirmation link, back on the same card", async ({
  page,
}) => {
  const email = `e2e-notify-${Date.now()}@example.invalid`;
  // The home page says both promises.
  await page.goto("/");
  await expect(
    page.getByText("Izvērtēsim trīs piemērotākos produktus un paziņosim, kad cena samazināsies!"),
  ).toBeVisible();

  await kettleResults(page);
  const url = page.url();
  const first = picks(page).first();
  const name = (await first.getAttribute("aria-label")) ?? "";
  const productId = ((await first.getAttribute("id")) ?? "").replace(/^p-/, "");
  // Every category promises Trilio's own offer (owner, 30 Oct 2026).
  await expect(page.locator("[data-trilio-offer]")).toHaveText(
    "Pieprasi labāku cenu: Trilio pajautās izplatītājam un uzrakstīs, ja varēs piedāvāt lētāk nekā veikali.",
  );
  await first.getByRole("button", { name: "Pieprasīt labāku cenu", exact: true }).click();

  // No sign-in page: the card asks for the address, says exactly what will be sent, nothing more.
  await expect(page).toHaveURL(url);
  const panel = first.getByRole("group", { name: "Uz kādu e-pastu sūtīt piedāvājumu?" });
  await expect(panel).toContainText(
    "Pajautāsim izplatītājam un uzrakstīsim, tiklīdz varēsim piedāvāt šo preci lētāk nekā veikali, vai kad tās cena veikalos samazināsies.",
  );
  await expectNoAxeViolations(page);
  await panel.getByLabel("E-pasts").fill("nav-epasts");
  await panel.getByRole("button", { name: "Pieprasīt labāku cenu" }).click();
  await expect(panel.getByRole("alert")).toHaveText("Lūdzu, ievadi derīgu e-pasta adresi.");
  await panel.getByLabel("E-pasts").fill(email);
  await panel.getByRole("button", { name: "Pieprasīt labāku cenu" }).click();
  await expect(first.getByRole("status")).toHaveText(
    `Nosūtījām apstiprinājuma saiti uz ${email}. Atver to, un sāksim meklēt labāku cenu.`,
  );

  // The e-mailed link opens one button; mail scanners that open links confirm nothing.
  const link = await confirmationLink(page, email);
  await page.goto(link);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Apstiprini, un meklēsim labāku cenu");
  await expect(page.getByText(`Tu pieprasīji labāku cenu:`)).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Apstiprināt" }).click();

  // Back on the same results, at the same card, signed in, and the card says what will happen.
  await page.waitForURL((u) => u.pathname === "/rezultati" && u.hash === `#p-${productId}`);
  const card = page.locator(`article[id="p-${productId}"]`);
  await expect(
    card.getByRole("button", { name: "Pieprasīts · meklējam labāku cenu", exact: true }),
  ).toBeVisible();
  await page.goto("/velmju-saraksts");
  await expect(page.getByRole("region", { name: "Saglabātās preces" }).getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article", { name })).toBeVisible();
  await expect(
    page
      .locator("[data-price-alerts]")
      .getByRole("checkbox", { name: "Sūtīt e-pastu, kad saglabātās preces vai meklējuma cena samazinās" }),
  ).toBeChecked();
  // The one yes covered Trilio's offers too, as the sentence said.
  await expect(page.getByLabel("Vēlos saņemt personīgus piedāvājumus par saglabātajām precēm")).toBeChecked();

  // The link has done its job: a second visit cannot confirm or sign in again.
  await deleteAccount(page);
  await page.goto(link);
  await expect(page.getByRole("status")).toHaveText(/Šī saite vairs nav derīga|Pieprasīts/);
});

test("fridges: Trilio's own offer is promised, and one yes on the card covers both e-mails", async ({
  page,
}) => {
  const email = `e2e-fridge-${Date.now()}@example.invalid`;
  await devLogin(page, email, "/");
  await fridgeResults(page);
  await expect(page.locator("[data-trilio-offer]")).toHaveText(
    "Pieprasi labāku cenu: Trilio pajautās izplatītājam un uzrakstīs, ja varēs piedāvāt lētāk nekā veikali.",
  );
  // The search's own line sits right after the three picks, not at the bottom of the page.
  const order = await page.evaluate(() => {
    const picksRegion =
      document.querySelector('section[aria-labelledby="picks-title"]') ??
      document.querySelector("[aria-label='Ieteiktie varianti']")?.closest("section");
    const box = document.querySelector("[data-notify-search]");
    const more = document.getElementById("more-title");
    const after = (a: Element | null | undefined, b: Element | null | undefined) =>
      !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return { afterPicks: after(picksRegion, box), beforeMore: more ? after(box, more) : true };
  });
  expect(order).toEqual({ afterPicks: true, beforeMore: true });

  const first = picks(page).first();
  await first.getByRole("button", { name: "Pieprasīt labāku cenu", exact: true }).click();
  const panel = first.getByRole("group", { name: `Sūtīt piedāvājumu uz ${email}?` });
  await expect(panel).toContainText("tiklīdz varēsim piedāvāt šo preci lētāk nekā veikali");
  await expectNoAxeViolations(page);
  await panel.getByRole("button", { name: "Pieprasīt labāku cenu" }).click();
  await expect(
    first.getByRole("button", { name: "Pieprasīts · meklējam labāku cenu", exact: true }),
  ).toBeVisible();
  await expect(first.locator("[data-alert-note]")).toHaveText(
    `Meklējam labāku cenu. Ja atradīsim, atsūtīsim piedāvājumu uz ${email}; ja ne, uzrakstīsim, kad cena veikalos samazināsies. · Nesūtīt`,
  );
  // Asked once: the next product saves at the first tap.
  const second = picks(page).nth(1);
  await second.getByRole("button", { name: "Pieprasīt labāku cenu", exact: true }).click();
  // The heart fills at once; enabled again once the save has reached the server.
  await expect(
    second.getByRole("button", { name: "Pieprasīts · meklējam labāku cenu", exact: true }),
  ).toBeEnabled();
  await expect(second.locator("[data-notify-panel]")).toHaveCount(0);

  await page.goto("/velmju-saraksts");
  await expect(page.getByLabel("Vēlos saņemt personīgus piedāvājumus par saglabātajām precēm")).toBeChecked();
  await expect(page.getByRole("region", { name: "Saglabātās preces" }).getByRole("article")).toHaveCount(2);
  await deleteAccount(page);
});

test("the question before the shop: one sheet on the first shop click, two equal choices, once per visit", async ({
  page,
}) => {
  test.slow(); // a server action, a mail, an axe scan and a second tab
  const email = `e2e-ask-${Date.now()}@example.invalid`;
  await kettleResults(page);
  const url = page.url();
  const first = picks(page).first();
  const buy = first.getByRole("link", { name: /^Pirkt — / });
  const shop = ((await buy.textContent()) ?? "").replace(/^Pirkt — /, "").trim();
  await buy.click();

  // One sheet, the page stays; the request and the shop are two buttons of the same size, nothing is shamed.
  const sheet = page.getByRole("dialog", { name: "Pieprasīt labāku cenu, pirms ej uz veikalu?" });
  await expect(sheet).toBeVisible();
  await expect(page).toHaveURL(url);
  await expect(sheet).toContainText("Bez maksas, bez konta.");
  await expect(sheet.getByRole("button", { name: "Pieprasīt labāku cenu" })).toBeVisible();
  await expect(sheet.getByRole("link", { name: `Uz ${shop}` })).toHaveAttribute(
    "href",
    /^\/go\/[0-9a-f-]{36}\?.*ask=1/,
  );
  await expectNoAxeViolations(page);

  // The request inside the sheet is the card's own flow: the e-mail field, then the confirmation link.
  await sheet.getByRole("button", { name: "Pieprasīt labāku cenu" }).click();
  const panel = sheet.getByRole("group", { name: "Uz kādu e-pastu sūtīt piedāvājumu?" });
  await panel.getByLabel("E-pasts").fill(email);
  await panel.getByRole("button", { name: "Pieprasīt labāku cenu" }).click();
  await expect(sheet.getByRole("status")).toHaveText(
    `Nosūtījām apstiprinājuma saiti uz ${email}. Atver to, un sāksim meklēt labāku cenu.`,
  );
  await expect(sheet.getByRole("link", { name: `Uz ${shop}` })).toBeVisible();
  await sheet.getByRole("button", { name: "Aizvērt" }).click();
  await expect(sheet).toBeHidden();

  // Answered once: for a day every shop link, in a new tab too, goes straight to the shop.
  const second = picks(page)
    .nth(1)
    .getByRole("link", { name: /^Pirkt — / });
  await expect(second).not.toHaveAttribute("aria-haspopup", "dialog");
  const tab = await page.context().newPage();
  // The shop redirect itself is covered by flow.spec; here only that the click goes to it, with no sheet.
  let left = "";
  await tab.route("**/go/**", (r) => {
    left = r.request().url();
    return r.fulfill({ status: 200, contentType: "text/html", body: "<title>shop</title>" });
  });
  await tab.goto(url);
  await tab.waitForLoadState("networkidle");
  const again = picks(tab)
    .first()
    .getByRole("link", { name: /^Pirkt — / });
  await expect(again).not.toHaveAttribute("aria-haspopup", "dialog");
  await again.click();
  await expect.poll(() => left).toMatch(/\/go\/[0-9a-f-]{36}/);
  expect(left).not.toContain("ask=1");
  await expect(tab.getByRole("dialog")).toHaveCount(0);
  await tab.close();
});

test("wishlist: save a search and a product, see today's offer, remove, switch price e-mails", async ({
  page,
}) => {
  const email = `e2e-wish-${Date.now()}@example.invalid`;
  await devLogin(page, email);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Vēlmju saraksts");
  await expect(page.getByText(/Vēl nekas nav saglabāts/)).toBeVisible();
  await expectNoAxeViolations(page);

  // Results: save the whole search, then one product.
  await kettleResults(page);
  const search = page.locator("[data-notify-search]");
  // A search is a watch, not a request to a partner: it saves at once, no question asked.
  await search.getByRole("button", { name: "Paziņot par lētāku variantu" }).click();
  await expect(search.getByRole("button", { name: "Paziņosim par lētāku variantu" })).toBeVisible();
  await expect(search.locator("[data-notify-panel]")).toHaveCount(0);
  const product = picks(page).first();
  const productName = (await product.getAttribute("aria-label")) ?? "";
  await product.getByRole("button", { name: "Pieprasīt labāku cenu", exact: true }).click();
  // The first product tap asks the one yes, with the address already known; it covers Trilio's offers too.
  const ask = product.getByRole("group", { name: `Sūtīt piedāvājumu uz ${email}?` });
  await expect(ask).toContainText("tiklīdz varēsim piedāvāt šo preci lētāk nekā veikali");
  await ask.getByRole("button", { name: "Pieprasīt labāku cenu" }).click();
  await expect(
    product.getByRole("button", { name: "Pieprasīts · meklējam labāku cenu", exact: true }),
  ).toBeVisible();
  // The card says where the e-mail goes, with the way out in the same line and the way back.
  const note = product.locator("[data-alert-note]");
  await expect(note).toHaveText(
    `Meklējam labāku cenu. Ja atradīsim, atsūtīsim piedāvājumu uz ${email}; ja ne, uzrakstīsim, kad cena veikalos samazināsies. · Nesūtīt`,
  );
  await expect(product.locator("[data-notify-panel]")).toHaveCount(0);
  await expectNoAxeViolations(page);
  await note.getByRole("button", { name: "Nesūtīt" }).click();
  await expect(note).toHaveText("Saglabāts. Cenu paziņojumus nesūtīsim. · Tomēr sūtīt");
  await note.getByRole("button", { name: "Tomēr sūtīt" }).click();
  await expect(note).toHaveAttribute("data-alert-note", "on");
  // A second tap stops it; a third starts it again.
  await product.getByRole("button", { name: "Pieprasīts · meklējam labāku cenu", exact: true }).click();
  await expect(product.getByRole("button", { name: "Pieprasīt labāku cenu", exact: true })).toBeVisible();
  await product.getByRole("button", { name: "Pieprasīt labāku cenu", exact: true }).click();
  await expect(
    product.getByRole("button", { name: "Pieprasīts · meklējam labāku cenu", exact: true }),
  ).toBeVisible();
  await expect(product.locator("[data-alert-note]")).toBeVisible();

  // The header heart opens the list.
  await page
    .getByRole("banner")
    .getByRole("link", { name: /Vēlmju saraksts/ })
    .click();
  await expect(page).toHaveURL(/\/velmju-saraksts/);
  await expect(page.getByText("Saglabāti: 2")).toBeVisible();
  const searches = page.getByRole("region", { name: "Saglabātie meklējumi" }).getByRole("article");
  await expect(searches).toHaveCount(1);
  await expect(searches.first()).toHaveAttribute("aria-label", /^Tējkannas/);
  await expect(searches.first().getByText("Labākais variants tagad")).toBeVisible();
  await expect(searches.first().getByText(/Atbilst \d+ prece/)).toBeVisible();
  const products = page.getByRole("region", { name: "Saglabātās preces" }).getByRole("article");
  await expect(products).toHaveCount(1);
  await expect(products.first()).toHaveAttribute("aria-label", productName);
  await expect(products.first().getByRole("link", { name: /^Uz / })).toHaveAttribute("href", /^\/go\//);
  await expectNoAxeViolations(page);

  // The saved search reopens the same results.
  await searches.first().getByRole("link", { name: "Skatīt rezultātus" }).click();
  await expect(page).toHaveURL(/\/rezultati\?sub=kettle/);
  await expect(page.getByRole("button", { name: "Paziņosim par lētāku variantu" })).toBeVisible();
  await page.goBack();

  // Remove the product from the list with its heart.
  await products
    .first()
    .getByRole("button", { name: `Pieprasīts · meklējam labāku cenu: ${productName}` })
    .click();
  await expect(products).toHaveCount(0);
  await expect(page.getByText("Saglabāti: 1")).toBeVisible();

  // Price e-mails are free and on, with no plan and no threshold to pick; off and on again from the list.
  const alerts = page.locator("[data-price-alerts]");
  const box = alerts.getByRole("checkbox", {
    name: "Sūtīt e-pastu, kad saglabātās preces vai meklējuma cena samazinās",
  });
  await expect(box).toBeChecked();
  await expect(alerts.getByText(`Bez maksas. Sūtām uz ${email}`)).toBeVisible();
  await expect(page.getByRole("link", { name: /Ieslēgt paziņojumus/ })).toHaveCount(0);
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByText(/€\/mēn\./)).toHaveCount(0);
  await box.uncheck();
  await expect(alerts.getByRole("status")).toHaveText(/Cenu paziņojumus nesūtām/);
  await page.reload();
  await expect(box).not.toBeChecked();
  await box.check();
  await expect(alerts.getByRole("status")).toHaveText(/Bez maksas/);
  await expectNoAxeViolations(page);

  // The account page has the same switch.
  await page.goto("/konts");
  await expect(
    page
      .locator("[data-price-alerts]")
      .getByRole("checkbox", { name: "Sūtīt e-pastu, kad saglabātās preces vai meklējuma cena samazinās" }),
  ).toBeChecked();

  // GDPR export carries the wishlist and the setting.
  const res = await page.request.get("/api/account/export");
  expect(res.status()).toBe(200);
  const data = await res.json();
  expect(data.wishlist).toHaveLength(1);
  expect(data.wishlist[0].kind).toBe("search");
  expect(data.notificationSettings).toHaveLength(0);
  expect(data.user.priceAlerts).toBe(true);
  // Asked once, on the first tap, and the yes covered Trilio's offers.
  expect(data.user.offersAskedAt).not.toBeNull();

  await deleteAccount(page);
});

test("the retired plan page and the e-mail unsubscribe page need no payment", async ({ page }) => {
  await devLogin(page, `e2e-wish-plan-${Date.now()}@example.invalid`, "/velmju-saraksts/pazinojumi");
  await expect(page).toHaveURL(/\/velmju-saraksts$/);
  await expect(page.getByRole("button", { name: "Maksāt" })).toHaveCount(0);
  await deleteAccount(page);

  // The link in a price e-mail: one button, no sign-in, nothing changes on a GET.
  await page.goto("/velmju-saraksts/atteikties/e2e-not-a-real-token-000000");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nesūtīt vairs cenu e-pastus?");
  await page.getByRole("button", { name: "Nesūtīt" }).click();
  await expect(page.getByRole("status")).toHaveText(/Cenu e-pastus vairs nesūtīsim/);
  const res = await page.request.post("/api/wishlist/unsubscribe/e2e-not-a-real-token-000000");
  expect(res.status()).toBe(200);
});
