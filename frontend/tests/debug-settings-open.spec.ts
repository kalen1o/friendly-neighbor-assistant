import { test } from "@playwright/test";

test("debug: settings dialog open flow", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(2000);

  // Check if user menu exists
  const avatarBtns = page.locator('[data-slot="dropdown-menu-trigger"]');
  const avatarCount = await avatarBtns.count();
  console.log(`[AVATAR] Found ${avatarCount} dropdown triggers`);

  // Try finding the user menu area at the bottom of sidebar
  const sidebar = page.locator("aside");
  const sidebarCount = await sidebar.count();
  console.log(`[SIDEBAR] Found ${sidebarCount} aside elements`);

  if (sidebarCount > 0) {
    const sidebarHTML = await sidebar.first().innerHTML();
    // Check for sign-in or user avatar
    const hasSignIn = sidebarHTML.includes("Sign in");
    const hasAvatar = sidebarHTML.includes("rounded-full bg-primary");
    console.log(`[SIDEBAR] hasSignIn=${hasSignIn} hasAvatar=${hasAvatar}`);
  }

  await page.screenshot({ path: "tests/screenshots/settings-debug-1.png", fullPage: true });

  // If not logged in, we need to log in first
  const signInBtn = page.locator("button").filter({ hasText: "Sign in" });
  const signInCount = await signInBtn.count();
  console.log(`[SIGNIN] Found ${signInCount} sign-in buttons`);

  if (signInCount > 0) {
    console.log("[AUTH] Not logged in, trying to log in...");
    await signInBtn.first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: "tests/screenshots/settings-debug-2-auth.png", fullPage: true });

    // Fill login form
    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    if (await emailInput.count() > 0) {
      await emailInput.fill("testuser@example.com");
      await passwordInput.first().fill("Test1234");
      await page.locator('form button[type="submit"]').click();
      await page.waitForTimeout(2000);
      console.log("[AUTH] Login attempted");
      await page.screenshot({ path: "tests/screenshots/settings-debug-3-loggedin.png", fullPage: true });
    }
  }

  // Now try to open user menu dropdown
  const dropdownTrigger = page.locator('[data-slot="dropdown-menu-trigger"]');
  const triggerCount = await dropdownTrigger.count();
  console.log(`[DROPDOWN] Found ${triggerCount} triggers after login`);

  if (triggerCount > 0) {
    await dropdownTrigger.first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: "tests/screenshots/settings-debug-4-dropdown.png", fullPage: true });

    // Check dropdown content
    const menuItems = page.locator('[data-slot="dropdown-menu-item"]');
    const itemCount = await menuItems.count();
    console.log(`[DROPDOWN] Menu items: ${itemCount}`);
    for (let i = 0; i < itemCount; i++) {
      const text = await menuItems.nth(i).textContent();
      console.log(`  [ITEM ${i}] "${text}"`);
    }

    // Click Settings
    const settingsItem = page.locator('[data-slot="dropdown-menu-item"]').filter({ hasText: "Settings" });
    const settingsCount = await settingsItem.count();
    console.log(`[SETTINGS] Found ${settingsCount} settings menu items`);

    if (settingsCount > 0) {
      await settingsItem.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: "tests/screenshots/settings-debug-5-dialog.png", fullPage: true });

      const dialog = page.locator('[role="dialog"]');
      const dialogCount = await dialog.count();
      console.log(`[DIALOG] Found ${dialogCount} dialogs`);
    }
  } else {
    // Try clicking the avatar area directly
    const bottomBtns = sidebar.locator("button").last();
    console.log(`[FALLBACK] Clicking last button in sidebar`);
    await bottomBtns.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: "tests/screenshots/settings-debug-4-fallback.png", fullPage: true });
  }
});
