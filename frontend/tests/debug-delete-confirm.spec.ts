import { test } from "@playwright/test";

test("debug: delete all chats confirmation flow", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(1000);

  // Open settings
  const settingsBtn = page.locator("button").filter({ has: page.locator('svg.lucide-settings') });
  await settingsBtn.first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "tests/screenshots/delete-1-initial.png", fullPage: true });

  // Click "Delete all chats"
  const deleteBtn = page.locator("button").filter({ hasText: "Delete all chats" });
  await deleteBtn.click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "tests/screenshots/delete-2-confirm.png", fullPage: true });

  // Check what's visible
  const alertText = page.locator("text=Are you sure?");
  const visible = await alertText.isVisible();
  console.log(`[CONFIRM] "Are you sure?" visible: ${visible}`);

  // Check for separate dialog
  const dialogs = await page.locator('[role="dialog"]').count();
  console.log(`[DIALOGS] Count: ${dialogs}`);
});
