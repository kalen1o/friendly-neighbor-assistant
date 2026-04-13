import { test } from "@playwright/test";

test("mobile audit: all key pages", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); // iPhone 14
  const page = await context.newPage();

  // Login
  await page.goto("/");
  await page.waitForTimeout(1500);
  const signInBtn = page.getByText("Sign in").first();
  if (await signInBtn.isVisible()) {
    await signInBtn.click();
    await page.waitForTimeout(1000);
    await page.locator('input[type="email"]').fill("ftest2@test.com");
    await page.locator('input[type="password"]').fill("Testpass123");
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(3000);
  }

  // 1. Home page (empty state)
  await page.screenshot({ path: "tests/screenshots/mobile-1-home.png", fullPage: true });

  // 2. Try opening mobile sidebar
  const hamburger = page.locator("button").filter({ has: page.locator('svg') }).first();
  if (await hamburger.isVisible()) {
    await hamburger.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: "tests/screenshots/mobile-2-sidebar.png", fullPage: true });
    // Close it
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }

  // 3. Create a chat and take screenshot
  // Find New Chat button
  const newChatBtn = page.getByText("New Chat").first();
  if (await newChatBtn.isVisible()) {
    await newChatBtn.click();
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: "tests/screenshots/mobile-3-empty-chat.png", fullPage: true });

  // 4. Chat input area
  const chatInput = page.locator("textarea");
  if (await chatInput.count() > 0) {
    await chatInput.first().screenshot({ path: "tests/screenshots/mobile-4-chat-input.png" });
  }

  // 5. Mode selector / model picker area
  const modeArea = page.locator(".mt-2.flex.flex-wrap");
  if (await modeArea.count() > 0) {
    await modeArea.first().screenshot({ path: "tests/screenshots/mobile-5-mode-selector.png" });
  }

  // 6. Documents page
  await page.goto("/documents");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "tests/screenshots/mobile-6-documents.png", fullPage: true });

  // 7. Skills page
  await page.goto("/skills");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "tests/screenshots/mobile-7-skills.png", fullPage: true });

  // 8. Settings dialog
  // Open via user menu
  const userAvatar = page.locator(".rounded-full.bg-primary").first();
  if (await userAvatar.isVisible()) {
    await userAvatar.click();
    await page.waitForTimeout(500);
    const settingsItem = page.getByText("Settings");
    if (await settingsItem.isVisible()) {
      await settingsItem.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: "tests/screenshots/mobile-8-settings.png", fullPage: true });

      // Models tab
      const modelsTab = page.getByText("Models", { exact: true });
      if (await modelsTab.count() > 0) {
        await modelsTab.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: "tests/screenshots/mobile-9-settings-models.png", fullPage: true });
      }
    }
  }

  // 9. Analytics page
  await page.keyboard.press("Escape");
  await page.goto("/analytics");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "tests/screenshots/mobile-10-analytics.png", fullPage: true });

  await context.close();
});
