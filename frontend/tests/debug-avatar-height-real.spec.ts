import { test } from "@playwright/test";

test("debug: real component height - unauthenticated", async ({ page }) => {
  // Clear cookies to ensure unauthenticated
  await page.context().clearCookies();
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await page.waitForTimeout(2000);

  // Measure the user menu area
  const borderTElements = page.locator("aside .border-t");
  const count = await borderTElements.count();
  console.log(`[BORDER-T] count: ${count}`);

  for (let i = 0; i < count; i++) {
    const box = await borderTElements.nth(i).boundingBox();
    const text = await borderTElements.nth(i).textContent();
    console.log(`  [${i}] height=${box?.height}px text="${text?.trim().substring(0, 40)}"`);
  }

  // The last border-t should be the user menu
  const lastBorderT = borderTElements.last();
  const box = await lastBorderT.boundingBox();
  console.log(`\n[USER MENU] height=${box?.height}px`);

  // Screenshot
  await page.screenshot({ path: "tests/screenshots/height-unauth.png" });
});
