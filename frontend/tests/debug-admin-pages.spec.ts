import { test } from "@playwright/test";

test("admin pages UI audit", async ({ page }) => {
  // Navigate to login first, then use the auth-guard dialog
  await page.goto("/admin");
  await page.waitForTimeout(2000);

  // Check if we need to sign in
  const signInBtn = page.locator("text=Sign in").first();
  if (await signInBtn.isVisible({ timeout: 2000 })) {
    await signInBtn.click();
    await page.waitForTimeout(500);

    // Fill login form
    const emailInput = page.locator('input[type="email"], input[name="email"]').first();
    const passInput = page.locator('input[type="password"], input[name="password"]').first();
    if (await emailInput.isVisible({ timeout: 2000 })) {
      await emailInput.fill("kalen@fn.dev");
      await passInput.fill("Kalen1234");
      await page.locator('button[type="submit"]:has-text("Sign in"), button:has-text("Log in")').first().click();
      await page.waitForTimeout(2000);
    }
  }

  // Now navigate to admin pages
  const adminPages = [
    { path: "/admin", name: "dashboard" },
    { path: "/admin/users", name: "users" },
    { path: "/admin/audit", name: "audit" },
    { path: "/admin/quotas", name: "quotas" },
  ];

  for (const { path, name } of adminPages) {
    // Desktop
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(path);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `tests/screenshots/admin-${name}-desktop.png`, fullPage: true });

    // Check page title/heading
    const heading = await page.locator("h1, h2").first().textContent().catch(() => "none");
    console.log(`[${name}] heading: "${heading?.trim()}"`);

    // Mobile
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `tests/screenshots/admin-${name}-mobile.png`, fullPage: true });

    // Check horizontal overflow
    const hasHScroll = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    if (hasHScroll) console.log(`[${name}] ISSUE: horizontal scroll on mobile`);
  }
});
