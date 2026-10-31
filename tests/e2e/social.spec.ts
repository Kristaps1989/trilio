import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Admin → Sociālie tīkli (docs/SOCIAL_PLAN.md): a post made from live data,
// checked, published to a fake Meta (SOCIAL_PROVIDER=mock) and deleted again.

const ADMIN = "e2e-admin@example.invalid";

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

async function devLogin(page: Page, email: string, callbackUrl: string) {
  await page.goto(`/ienakt?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  await page.getByLabel("E-pasts").last().fill(email);
  await page.getByRole("button", { name: "Ienākt bez paroles" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/ienakt"));
}

test.describe.configure({ mode: "serial" });

test("signed out, the page asks to sign in; a draft's image is not public", async ({ page }) => {
  await page.goto("/admin/sociali");
  await expect(page).toHaveURL(/\/ienakt\?callbackUrl=%2Fadmin/);
  const res = await page.request.get("/api/social/00000000-0000-4000-8000-000000000000/image.jpg");
  expect(res.status()).toBe(404);
});

test("a post from the knowledge base: draft, image, publish now to both networks, delete", async ({
  page,
}, info) => {
  await devLogin(page, ADMIN, "/admin/sociali");
  await expect(page.getByRole("heading", { level: 1, name: "Sociālie tīkli" })).toBeVisible();
  await expect(page.locator("[data-social-connection]")).toContainText("Testa režīms");
  await expectNoAxeViolations(page);

  // Advice needs no prices, so it can be made on any data.
  const generate = page.locator("[data-social-generate]");
  await generate.getByLabel("Veids").selectOption({ label: "Kā izvēlēties" });
  await generate.getByRole("button", { name: "Izveidot tagad" }).click();
  await expect(page.locator("[data-outcome]")).toHaveText("Melnraksts izveidots.");
  // The new post is the one in the address (both viewports share the queue).
  const id = new URL(page.url()).searchParams.get("post") ?? "";
  const post = page.locator(`#post-${id}`);
  await expect(post).toHaveAttribute("data-social-status", "draft");
  await expect(post).toBeVisible();
  // The image is drawn and is a JPEG Instagram accepts.
  const img = post.getByRole("img");
  await expect(img).toBeVisible();
  const src = (await img.getAttribute("src")) ?? "";
  const jpeg = await page.request.get(src);
  expect(jpeg.headers()["content-type"]).toBe("image/jpeg");
  // Captions: no "tu", the link with UTM tags on Facebook, tags on Instagram.
  const fb = await post.getByLabel("Teksts Facebook").inputValue();
  const ig = await post.getByLabel("Teksts Instagram").inputValue();
  expect(fb).toContain("utm_source=facebook&utm_medium=social&utm_campaign=advice");
  expect(fb).not.toMatch(/\b(tu|tev|tavs)\b/i);
  expect(ig).toContain("Saite profilā.");
  expect(ig).toContain("#trilio");
  await expectNoAxeViolations(page);

  // An edit that breaks the rules is refused with the reason.
  await post.getByLabel("Teksts Facebook").fill("Tev lētākais Latvijā, tikai šodien!");
  await post.getByRole("button", { name: "Saglabāt tekstu" }).click();
  await expect(page.locator('[data-outcome="error"]')).toContainText("informal address");

  expect(src).toBe(`/api/social/${id}/image.jpg`);
  await post.getByRole("button", { name: "Publicēt tūlīt" }).click();
  await expect(page.locator("[data-outcome]")).toHaveText("Publicēts.");
  // Published: the image is now public, for Meta to fetch.
  const anon = await page.context().browser()!.newContext();
  const pub = await anon.request.get(
    `${info.project.use.baseURL ?? "http://localhost:3000"}/api/social/${id}/image.jpg`,
  );
  expect(pub.status()).toBe(200);
  await anon.close();

  const history = page.getByRole("group", { name: "Publicētie" });
  const row = history.getByRole("row").filter({ hasText: "Facebook, Instagram" }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Dzēst no tīkliem" }).click();
  await expect(page.locator("[data-outcome]")).toHaveText("Dzēsts no tīkliem.");
});
