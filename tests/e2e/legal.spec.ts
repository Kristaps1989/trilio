import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = [
  ["/privatums", "Privātuma politika", "Datu valsts inspekcijā"],
  ["/noteikumi", "Lietošanas noteikumi", "Atteikuma tiesības"],
  ["/sikdatnes", "Sīkdatņu politika", "authjs.session-token"],
  ["/kontakti", "Kontakti un rekvizīti", "Reģistrācijas Nr."],
  ["/pirkuma-noteikumi", "Pirkuma noteikumi", "14 dienu laikā no preces saņemšanas"],
] as const;

for (const [path, title, marker] of PAGES) {
  test(`${path} renders, is linked from the footer and has no accessibility violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.getByText(marker).first()).toBeVisible();
    await expect(page.locator("link[rel=canonical]")).toHaveAttribute("href", new RegExp(`${path}$`));
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations).toEqual([]);
  });
}

test("every page footer links the legal pages, and the sitemap lists them", async ({ page, request }) => {
  for (const path of ["/", "/izvelies"]) {
    await page.goto(path);
    const nav = page.getByRole("navigation", { name: "Juridiskā informācija" });
    for (const label of ["Noteikumi", "Pirkuma noteikumi", "Privātums", "Sīkdatnes", "Kontakti"]) {
      await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
  }
  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const [path] of PAGES) expect(sitemap).toContain(`${path}</loc>`);
});

test("sign-in states the terms and privacy policy", async ({ page }) => {
  await page.goto("/ienakt");
  await expect(page.getByText("Turpinot tu piekrīti")).toBeVisible();
  await expect(page.getByRole("link", { name: "Lietošanas noteikumiem" })).toHaveAttribute(
    "href",
    "/noteikumi",
  );
  await expect(page.getByRole("link", { name: "Privātuma politiku" })).toHaveAttribute("href", "/privatums");
});
