import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Every public page in both languages through axe (WCAG 2.1 A/AA), so a new
// page is covered by default (docs/ENGLISH_AND_ACCESSIBILITY_PLAN.md §7,
// item 9), plus the keyboard basics: the skip link and one h1 per page.
// Pages behind an order or offer token have their own specs (offers.spec.ts).

const PUBLIC = [
  "/",
  "/izvelies",
  "/izvelies/cool",
  "/izvelies/cool/fridge",
  "/rezultati?sub=kettle",
  "/kategorija/fridge",
  "/kategorija/fridge/lidz-800",
  "/modelis",
  "/cits",
  "/ienakt",
  "/velmju-saraksts",
  "/velmju-saraksts/atteikties/e2e-not-a-real-token-000000",
  "/noteikumi",
  "/pirkuma-noteikumi",
  "/privatums",
  "/sikdatnes",
  "/kontakti",
];
const SIGNED_IN = ["/konts", "/konts/pasutijumi", "/velmju-saraksts"];

const withLang = (path: string, lang: "lv" | "en") =>
  lang === "lv" ? path : path === "/" ? "/en" : `/en${path}`;

async function check(page: Page, path: string) {
  const res = await page.goto(path);
  expect(res?.status(), path).toBeLessThan(400);
  await expect(page.getByRole("heading", { level: 1 }), path).toHaveCount(1);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations, `${path}\n${JSON.stringify(results.violations, null, 2)}`).toEqual([]);
}

for (const lang of ["lv", "en"] as const) {
  test(`every public page passes axe (${lang})`, async ({ page }) => {
    test.setTimeout(120_000);
    for (const path of PUBLIC) await check(page, withLang(path, lang));
  });

  test(`signed-in pages pass axe (${lang})`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(withLang("/ienakt?callbackUrl=/konts", lang));
    await page
      .getByLabel(lang === "lv" ? "E-pasts" : "E-mail")
      .last()
      .fill(`e2e-a11y-${lang}-${Date.now()}@example.invalid`);
    await page
      .getByRole("button", { name: lang === "lv" ? "Ienākt bez paroles" : "Sign in without a password" })
      .click();
    await page.waitForURL((u) => u.pathname.endsWith("/konts"));
    for (const path of SIGNED_IN) await check(page, withLang(path, lang));
  });
}

test("the skip link is the first stop and moves focus to the page content", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "a keyboard check");
  for (const [path, name] of [
    ["/", "Pāriet uz saturu"],
    ["/en", "Skip to content"],
  ] as const) {
    await page.goto(path);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    expect((await skip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Enter");
    await expect(page.locator("main#saturs")).toBeFocused();
  }
});

test("EPREL links say they open EPREL in a new tab", async ({ page }) => {
  await page.goto("/kategorija/fridge");
  const links = page.getByRole("link", { name: /\(EPREL, atveras jaunā cilnē\)/ });
  if ((await links.count()) === 0) test.skip(true, "no product with an EPREL label in the sample data");
  await expect(links.first()).toHaveAttribute("target", "_blank");
});
