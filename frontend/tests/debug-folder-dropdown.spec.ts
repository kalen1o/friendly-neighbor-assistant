import { test, expect } from "@playwright/test";

test("folder context menu dropdown width check", async ({ page }) => {
  const email = `folder-dd-${Date.now()}@test.com`;
  await page.request.post("http://localhost:8000/api/auth/register", {
    data: { email, password: "TestPass1234", name: "Folder DD Test" },
  });
  await page.request.post("http://localhost:8000/api/auth/login", {
    data: { email, password: "TestPass1234" },
  });

  // Create a folder
  await page.request.post("http://localhost:8000/api/folders", {
    headers: { "Content-Type": "application/json" },
    data: JSON.stringify({ name: "Test Folder" }),
  });

  await page.goto("/");
  await page.waitForTimeout(1500);

  // Switch to folders tab
  const foldersTab = page.locator("button:has-text('Folders'), button:has-text('FOLDERS')");
  if (await foldersTab.isVisible({ timeout: 2000 })) {
    await foldersTab.click();
    await page.waitForTimeout(500);
  }

  await page.screenshot({ path: "tests/screenshots/folder-before-menu.png", fullPage: false });

  // Hover on the folder to reveal the ... button
  const folderRow = page.locator("text=Test Folder").first();
  if (!(await folderRow.isVisible({ timeout: 3000 }))) {
    console.log("[SKIP] Folder not visible");
    return;
  }

  await folderRow.hover();
  await page.waitForTimeout(300);

  // Click the ... menu button
  const moreBtn = page.locator('[class*="group-hover"]').filter({ has: page.locator('svg') }).last();
  await moreBtn.click({ force: true });
  await page.waitForTimeout(500);

  await page.screenshot({ path: "tests/screenshots/folder-dropdown-open.png", fullPage: false });

  // Check all dropdown items
  const items = page.locator('[role="menuitem"]');
  const count = await items.count();
  console.log(`[Folder Menu] Found ${count} items`);

  const wrapping: string[] = [];
  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    if (!(await item.isVisible())) continue;

    const text = (await item.textContent() || "").trim();
    const box = await item.boundingBox();
    if (!box) continue;

    const lineHeight = await item.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
    });

    console.log(`  "${text}" — width=${box.width.toFixed(0)}px height=${box.height.toFixed(0)}px lineHeight=${lineHeight.toFixed(0)}px`);

    if (box.height > lineHeight * 1.8) {
      wrapping.push(`"${text}" wraps (height=${box.height.toFixed(0)}px vs lineHeight=${lineHeight.toFixed(0)}px)`);
    }
  }

  // Also check the dropdown container width
  const menuContent = page.locator('[data-slot="dropdown-menu-content"], [role="menu"]').first();
  if (await menuContent.isVisible()) {
    const menuBox = await menuContent.boundingBox();
    console.log(`\n[Menu Container] width=${menuBox?.width.toFixed(0)}px`);
    if (menuBox && menuBox.width < 140) {
      wrapping.push(`Menu too narrow: ${menuBox.width.toFixed(0)}px`);
    }
  }

  console.log("\n=== RESULT ===");
  if (wrapping.length > 0) {
    for (const w of wrapping) console.log(`  ISSUE: ${w}`);
  } else {
    console.log("  No wrapping issues");
  }

  // Test at narrow viewport too
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);

  // Open mobile sidebar
  const menuBtn = page.locator("button").filter({ has: page.locator('svg') }).first();
  await menuBtn.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "tests/screenshots/folder-dropdown-mobile.png", fullPage: false });

  expect(wrapping.length).toBe(0);
});
