import { test } from "@playwright/test";

test("mobile after fixes", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  // Login
  await page.goto("/");
  await page.waitForTimeout(2000);
  const signInBtn = page.getByText("Sign in").first();
  if (await signInBtn.isVisible()) {
    await signInBtn.click();
    await page.waitForTimeout(1000);
    await page.locator('input[type="email"]').fill("ftest2@test.com");
    await page.locator('input[type="password"]').fill("Testpass123");
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(3000);
  }

  // 1. Home
  await page.screenshot({ path: "tests/screenshots/mobile-fix-1-home.png" });

  // 2. Open sidebar
  const hamburger = page.locator(".md\\:hidden button").first();
  if (await hamburger.isVisible()) {
    await hamburger.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: "tests/screenshots/mobile-fix-2-sidebar.png" });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }

  // 3. Chat page with input
  await page.goto("/");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "tests/screenshots/mobile-fix-3-chat.png" });

  // 4. Settings
  const avatar = page.locator(".rounded-full.bg-primary").first();
  if (await avatar.isVisible()) {
    await avatar.click();
    await page.waitForTimeout(500);
    const settingsBtn = page.getByText("Settings");
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: "tests/screenshots/mobile-fix-4-settings.png" });
      await page.keyboard.press("Escape");
    }
  }

  // 5. Skills
  await page.goto("/skills");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "tests/screenshots/mobile-fix-5-skills.png" });

  await context.close();
});
