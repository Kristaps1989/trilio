import { test, expect, type Page } from "@playwright/test";

// Layout stability (docs/DESIGN_FIX_PLAN.md §5): one header and footer that
// do not move between pages, no horizontal scroll, content inside its column,
// and little layout shift.

async function box(page: Page, selector: string) {
  const b = await page.locator(selector).first().boundingBox();
  expect(b, `${selector} has a box`).not.toBeNull();
  return b!;
}

test("header and footer keep their position and size across a client navigation", async ({ page }) => {
  await page.goto("/izvelies");
  const header1 = await box(page, "body > header");
  const footer1 = await box(page, "body > footer");
  await page.getByRole("link", { name: /Ledusskapji un saldētavas/ }).click();
  await expect(page).toHaveURL(/\/izvelies\/cool$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Izvēlies precīzāk");
  const header2 = await box(page, "body > header");
  const footer2 = await box(page, "body > footer");
  expect(header2).toEqual(header1);
  expect(footer2.height).toBe(footer1.height);
  expect(footer2.x).toBe(footer1.x);
  expect(footer2.width).toBe(footer1.width);
});

for (const path of [
  "/",
  "/izvelies",
  "/izvelies/cool/fridge",
  "/kategorija/fridge",
  "/ienakt",
  "/radars",
  "/privatums",
]) {
  test(`no horizontal scroll and content stays in its column: ${path}`, async ({ page }) => {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    const viewport = page.viewportSize()!;
    const main = await box(page, "main");
    expect(main.x).toBeGreaterThanOrEqual(0);
    expect(main.x + main.width).toBeLessThanOrEqual(viewport.width);
    // On desktop, text never runs edge to edge: the widest column is 1 160 px.
    if (viewport.width >= 1280) {
      const widest = await page
        .locator("main > *")
        .evaluateAll((els) =>
          Math.max(
            ...els.flatMap((el) =>
              [...el.querySelectorAll("p, h1, h2, ul, ol, form")].map((n) => n.getBoundingClientRect().width),
            ),
          ),
        );
      expect(widest).toBeLessThanOrEqual(1160);
    }
  });
}

async function cumulativeLayoutShift(page: Page, path: string): Promise<number> {
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
      })[]) {
        if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto(path, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  return page.evaluate(() => (window as unknown as { __cls: number }).__cls);
}

for (const path of ["/", "/izvelies/cool/fridge", "/rezultati?sub=kettle"]) {
  test(`cumulative layout shift stays under 0.05: ${path}`, async ({ page }) => {
    expect(await cumulativeLayoutShift(page, path)).toBeLessThan(0.05);
  });
}

test("branded Latvian 404 page inside the normal header and footer", async ({ page }) => {
  const res = await page.goto("/nav-tadas-lapas");
  expect(res!.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Šādas lapas nav");
  await expect(page.locator("body > header")).toBeVisible();
  await expect(page.getByRole("link", { name: "Uz sākumu", exact: true })).toHaveAttribute("href", "/");
});

test("sign-in page shows the Google button per Google's branding and hides the header sign-in", async ({
  page,
}) => {
  await page.goto("/ienakt");
  await expect(page.getByRole("banner").getByRole("link", { name: "Ienākt" })).toHaveCount(0);
  const google = page.getByRole("button", { name: "Turpināt ar Google" });
  if ((await google.count()) > 0) {
    await expect(google.locator("svg")).toBeVisible();
    await expect(google).toHaveCSS("background-color", "rgb(255, 255, 255)");
  }
});
