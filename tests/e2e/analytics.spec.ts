import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// The server runs with GA_MEASUREMENT_ID=G-TEST12345 (CI env). Google is never
// contacted: gtag.js is stubbed, so gtag() calls stay in window.dataLayer.

test.use({ storageState: { cookies: [], origins: [] } });
test.skip(!process.env.GA_MEASUREMENT_ID, "GA_MEASUREMENT_ID is not set for the test server");

test.beforeEach(async ({ page }) => {
  await page.route("https://www.googletagmanager.com/**", (r) =>
    r.fulfill({ contentType: "application/javascript", body: "" }),
  );
  await page.route(/google-analytics\.com|googleadservices\.com|doubleclick\.net/, (r) =>
    r.fulfill({ status: 204 }),
  );
});

type GaEvent = { name: string; params: Record<string, string | undefined> };

function events(page: Page): Promise<GaEvent[]> {
  return page.evaluate(() =>
    (window.dataLayer ?? [])
      .map((entry) => Array.from(entry as ArrayLike<unknown>))
      .filter((a) => a[0] === "event")
      .map((a) => ({ name: a[1] as string, params: (a[2] ?? {}) as Record<string, string | undefined> })),
  );
}

const banner = (page: Page) => page.getByRole("region", { name: "Sīkdatnes statistikai" });

test("the consent banner offers equal choices, and declining loads nothing", async ({ page, context }) => {
  await page.goto("/");
  await expect(banner(page)).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations).toEqual([]);

  await banner(page).getByRole("button", { name: "Neatļaut", exact: true }).click();
  await expect(banner(page)).toBeHidden();
  expect((await context.cookies()).find((c) => c.name === "trilio_consent")?.value).toBe("denied");
  expect(await page.locator('script[src*="googletagmanager"]').count()).toBe(0);
  expect(await page.evaluate(() => typeof window.gtag)).toBe("undefined");

  // The choice can be changed from any page footer.
  await page.getByRole("button", { name: "Sīkdatņu iestatījumi" }).click();
  await expect(banner(page)).toBeVisible();
});

test("after consent: page views carry the section, clicks and answers are tracked", async ({ page }) => {
  await page.goto("/");
  await banner(page).getByRole("button", { name: "Atļaut", exact: true }).click();
  await expect(banner(page)).toBeHidden();
  await expect(page.locator('script[src*="googletagmanager.com/gtag/js?id=G-TEST12345"]')).toHaveCount(1);
  await expect.poll(async () => (await events(page)).some((e) => e.name === "page_view")).toBe(true);
  expect((await events(page)).find((e) => e.name === "page_view")?.params.section).toBe("home");

  await page.getByRole("link", { name: "Palīdzi izvēlēties" }).click();
  await expect(page).toHaveURL(/\/izvelies$/);
  await expect
    .poll(async () => (await events(page)).find((e) => e.name === "ui_click")?.params.label)
    .toBe("Palīdzi izvēlēties");
  await expect
    .poll(async () => (await events(page)).filter((e) => e.name === "page_view").at(-1)?.params.section)
    .toBe("choose");

  await page.getByRole("link", { name: /Ledusskapji un saldētavas/ }).click();
  // Wait for the group page, or the next click can hit the group link again.
  await expect(page).toHaveURL(/\/izvelies\/cool$/);
  await page.getByRole("link", { name: /^Ledusskapji/ }).click();
  await expect(page).toHaveURL(/\/izvelies\/cool\/fridge/);
  await page.getByRole("radio").first().click();
  await expect
    .poll(async () => (await events(page)).find((e) => e.name === "answer_question")?.params)
    .toMatchObject({ section: "choose", subcategory: "fridge", question: expect.any(String) });
});

test("page views never include the query string", async ({ page }) => {
  await page.goto("/");
  await banner(page).getByRole("button", { name: "Atļaut", exact: true }).click();
  await page.goto("/cits?text=mans%20numurs%2020000000");
  await expect
    .poll(async () => (await events(page)).filter((e) => e.name === "page_view").at(-1)?.params.page_location)
    .toMatch(/\/cits$/);
});

test("the CSP allows Google Analytics hosts when it is configured", async ({ page }) => {
  const res = await page.goto("/");
  expect(res!.headers()["content-security-policy"]).toContain("https://*.google-analytics.com");
});

test("the Google Ads tag loads only after consent and a shop click is its conversion", async ({ page }) => {
  test.skip(!process.env.GOOGLE_ADS_TAG_ID, "GOOGLE_ADS_TAG_ID is not set for the test server");
  const configs = () =>
    page.evaluate(() =>
      (window.dataLayer ?? [])
        .map((entry) => Array.from(entry as ArrayLike<unknown>))
        .filter((a) => a[0] === "config")
        .map((a) => a[1] as string),
    );
  await page.goto("/rezultati?sub=kettle");
  expect(await page.evaluate(() => typeof window.gtag)).toBe("undefined");
  await banner(page).getByRole("button", { name: "Atļaut", exact: true }).click();
  await expect.poll(configs).toContain(process.env.GOOGLE_ADS_TAG_ID);
  expect(await configs()).toContain("G-TEST12345");

  // Stay on the page: the shop link would leave it.
  await page.evaluate(() =>
    document.addEventListener("click", (e) => (e.target as Element).closest("a") && e.preventDefault()),
  );
  // The first shop click opens the question before the shop; the conversion is the link that leaves.
  await page
    .getByRole("region", { name: "Ieteiktie varianti" })
    .getByRole("link", { name: /^Pirkt/ })
    .first()
    .click();
  await page.getByRole("dialog").getByRole("link", { name: /^Uz / }).click();
  await expect
    .poll(async () => (await events(page)).find((e) => e.name === "conversion")?.params.send_to)
    .toBe(`${process.env.GOOGLE_ADS_TAG_ID}/shopClickTest`);
  // GA4 events go to GA4 only, not to Google Ads.
  expect((await events(page)).find((e) => e.name === "select_offer")?.params.send_to).toBe("G-TEST12345");
});

test("the CSP allows the Google Ads hosts when the tag is configured", async ({ page }) => {
  test.skip(!process.env.GOOGLE_ADS_TAG_ID, "GOOGLE_ADS_TAG_ID is not set for the test server");
  const res = await page.goto("/");
  expect(res!.headers()["content-security-policy"]).toContain("https://www.googleadservices.com");
});

// Meta Pixel (docs/META_ADS_PLAN.md §2): fbevents.js is stubbed, so fbq() calls stay in its queue.
type FbqCall = unknown[];
const fbqCalls = (page: Page): Promise<FbqCall[]> =>
  page.evaluate(() => ((window.fbq as unknown as { queue?: unknown[][] })?.queue ?? []).map((a) => [...a]));

test.describe("Meta Pixel", () => {
  test.skip(!process.env.META_PIXEL_ID, "META_PIXEL_ID is not set for the test server");
  test.beforeEach(async ({ page }) => {
    await page.route("https://connect.facebook.net/**", (r) =>
      r.fulfill({ contentType: "application/javascript", body: "" }),
    );
    await page.route("https://www.facebook.com/**", (r) => r.fulfill({ status: 204 }));
  });

  test("loads only after consent; page views, results and shop clicks; the CSP allows it", async ({
    page,
  }) => {
    const res = await page.goto("/rezultati?sub=kettle");
    expect(res!.headers()["content-security-policy"]).toContain("https://connect.facebook.net");
    expect(await page.evaluate(() => typeof window.fbq)).toBe("undefined");
    await banner(page).getByRole("button", { name: "Atļaut", exact: true }).click();
    await expect(page.locator('script[src*="connect.facebook.net"]')).toHaveCount(1);
    await expect.poll(() => fbqCalls(page)).toContainEqual(["init", process.env.META_PIXEL_ID]);
    const calls = await fbqCalls(page);
    expect(calls).toContainEqual(["consent", "grant"]);
    expect(calls).toContainEqual(["track", "PageView", {}, undefined]);
    expect(calls).toContainEqual(["track", "ViewContent", { content_category: "kettle" }, undefined]);
    // Nothing from the question flow or the URL is sent.
    expect(JSON.stringify(calls)).not.toContain("sub=");

    await page.evaluate(() =>
      document.addEventListener("click", (e) => (e.target as Element).closest("a") && e.preventDefault()),
    );
    // The first shop click opens the question before the shop (docs/PRICE_NOTIFY_PLAN.md §8.4); the
    // shop click is counted on the link that actually leaves, "Uz {Shop}", and not before.
    await page
      .getByRole("region", { name: "Ieteiktie varianti" })
      .getByRole("link", { name: /^Pirkt/ })
      .first()
      .click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    expect((await fbqCalls(page)).find((c) => c[0] === "trackCustom")).toBeUndefined();
    await sheet.getByRole("link", { name: /^Uz / }).click();
    await expect
      .poll(async () => (await fbqCalls(page)).find((c) => c[0] === "trackCustom"))
      .toEqual(["trackCustom", "ShopClick", { content_category: "kettle" }]);
  });

  test("declining keeps the Pixel out", async ({ page }) => {
    await page.goto("/");
    await banner(page).getByRole("button", { name: "Neatļaut", exact: true }).click();
    await page.goto("/rezultati?sub=kettle");
    expect(await page.evaluate(() => typeof window.fbq)).toBe("undefined");
    expect(await page.locator('script[src*="connect.facebook.net"]').count()).toBe(0);
  });

  test("a better-price request is a Lead, with the event id the server uses", async ({ page }) => {
    const email = `meta-lead-${test.info().project.name}-${Date.now()}@example.invalid`;
    await page.goto("/");
    await banner(page).getByRole("button", { name: "Atļaut", exact: true }).click();
    await page.goto(`/ienakt?callbackUrl=${encodeURIComponent("/rezultati?sub=blender")}`);
    await page.getByLabel("E-pasts").last().fill(email);
    await page.getByRole("button", { name: "Ienākt bez paroles" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/ienakt"));
    const first = page.locator('main article[id^="p-"]').first();
    await first.getByRole("button", { name: "Pieprasīt labāku cenu", exact: true }).click();
    await first.locator("[data-notify-panel]").getByRole("button", { name: "Pieprasīt labāku cenu" }).click();
    await expect(
      first.getByRole("button", { name: "Pieprasīts · meklējam labāku cenu", exact: true }),
    ).toBeEnabled();
    await expect
      .poll(async () => (await fbqCalls(page)).find((c) => c[0] === "track" && c[1] === "Lead"))
      .toEqual(["track", "Lead", {}, { eventID: expect.stringMatching(/^[0-9a-f-]{36}$/) }]);
  });
});
