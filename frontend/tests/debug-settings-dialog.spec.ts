import { test } from "@playwright/test";

test("debug: settings dialog dimensions and layout", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);

  // Find and click the settings button
  const settingsBtn = page.locator("button").filter({ has: page.locator('svg.lucide-settings') });
  const settingsBtnCount = await settingsBtn.count();
  console.log(`[SETTINGS] Found ${settingsBtnCount} settings button(s)`);

  if (settingsBtnCount === 0) {
    // Try finding by aria or other means
    const allButtons = await page.locator("aside button").count();
    console.log(`[SETTINGS] Total buttons in sidebar: ${allButtons}`);
    await page.screenshot({ path: "tests/screenshots/settings-before.png", fullPage: true });
    return;
  }

  await settingsBtn.first().click();
  await page.waitForTimeout(500);

  // Screenshot the dialog
  await page.screenshot({ path: "tests/screenshots/settings-dialog.png", fullPage: true });

  // Find the dialog content
  const dialog = page.locator('[role="dialog"]');
  const dialogCount = await dialog.count();
  console.log(`[DIALOG] Found ${dialogCount} dialog(s)`);

  if (dialogCount > 0) {
    const box = await dialog.first().boundingBox();
    console.log(`[DIALOG] Position: x=${box?.x} y=${box?.y}`);
    console.log(`[DIALOG] Size: width=${box?.width} height=${box?.height}`);

    // Check viewport
    const viewport = page.viewportSize();
    console.log(`[VIEWPORT] ${viewport?.width}x${viewport?.height}`);

    // Check inner elements
    const sidebar = dialog.locator('.border-r');
    const sidebarBox = await sidebar.first().boundingBox().catch(() => null);
    console.log(`[SIDEBAR] Size: width=${sidebarBox?.width} height=${sidebarBox?.height}`);

    const content = dialog.locator('.flex-1.p-6');
    const contentBox = await content.first().boundingBox().catch(() => null);
    console.log(`[CONTENT] Size: width=${contentBox?.width} height=${contentBox?.height}`);

    // Check computed styles
    const dialogStyles = await dialog.first().evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        width: style.width,
        maxWidth: style.maxWidth,
        minWidth: style.minWidth,
        padding: style.padding,
        display: style.display,
      };
    });
    console.log(`[DIALOG STYLES]`, JSON.stringify(dialogStyles));

    // Check the inner flex container
    const innerFlex = dialog.locator('.flex.min-h-\\[400px\\]');
    const innerFlexCount = await innerFlex.count();
    console.log(`[INNER FLEX] Found: ${innerFlexCount}`);
    if (innerFlexCount > 0) {
      const innerBox = await innerFlex.first().boundingBox();
      console.log(`[INNER FLEX] Size: width=${innerBox?.width} height=${innerBox?.height}`);
    }
  }

  // Check if delete button is visible
  const deleteBtn = page.locator("button").filter({ hasText: "Delete all chats" });
  const deleteBtnVisible = await deleteBtn.isVisible().catch(() => false);
  console.log(`[DELETE BTN] Visible: ${deleteBtnVisible}`);
});
