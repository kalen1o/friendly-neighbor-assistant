import { test, expect } from "@playwright/test";

test("comprehensive: all dropdowns must have no line breaks", async ({ page }) => {
  const email = `alldd-${Date.now()}@test.com`;
  await page.request.post("http://localhost:8000/api/auth/register", {
    data: { email, password: "TestPass1234", name: "All DD Test" },
  });
  await page.request.post("http://localhost:8000/api/auth/login", {
    data: { email, password: "TestPass1234" },
  });

  // Create test data
  await page.request.post("http://localhost:8000/api/folders", {
    headers: { "Content-Type": "application/json" },
    data: JSON.stringify({ name: "My Folder" }),
  });
  const chatRes = await page.request.post("http://localhost:8000/api/chats", {
    headers: { "Content-Type": "application/json" },
    data: JSON.stringify({ title: "Test Chat For Dropdowns" }),
  });
  const chat = await chatRes.json();

  const issues: string[] = [];

  async function checkOpenMenu(name: string) {
    await page.waitForTimeout(400);
    const items = page.locator('[role="menuitem"]');
    const count = await items.count();
    if (count === 0) {
      console.log(`[${name}] No menu items found`);
      return;
    }
    console.log(`[${name}] ${count} items:`);
    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      if (!(await item.isVisible())) continue;
      const text = (await item.textContent() || "").trim();
      const box = await item.boundingBox();
      if (!box) continue;
      const lh = await item.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.5);
      const wraps = box.height > lh * 1.8;
      console.log(`  ${wraps ? "WRAP" : "  OK"} "${text}" h=${box.height.toFixed(0)} lh=${lh.toFixed(0)}`);
      if (wraps) issues.push(`[${name}] "${text}" wraps (h=${box.height.toFixed(0)}px)`);
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }

  // === 1. User menu (sidebar) ===
  await page.goto("/");
  await page.waitForTimeout(1500);
  const userTrigger = page.locator('[data-slot="dropdown-menu-trigger"]').first();
  if (await userTrigger.isVisible({ timeout: 2000 })) {
    await userTrigger.click();
    await checkOpenMenu("User Menu");
  }

  // === 2. Folder context menu ===
  const foldersTab = page.locator("button:has-text('FOLDERS')");
  if (await foldersTab.isVisible({ timeout: 2000 })) {
    await foldersTab.click();
    await page.waitForTimeout(500);
    const folderRow = page.locator("text=My Folder").first();
    if (await folderRow.isVisible({ timeout: 2000 })) {
      await folderRow.hover();
      await page.waitForTimeout(300);
      // Click the ... button
      const dots = page.locator("text=My Folder").locator("..").locator('[class*="opacity-0"]').first();
      if (await dots.isVisible({ timeout: 1000 }).catch(() => false)) {
        await dots.click({ force: true });
      } else {
        // Try finding by MoreHorizontal icon near folder
        const moreBtn = page.locator('svg[class*="h-3.5 w-3.5"]').last();
        await moreBtn.click({ force: true });
      }
      await checkOpenMenu("Folder Menu");
    }
  }

  // === 3. Chat page - export dialog (not dropdown, skip) ===

  // === 4. Check all pages at 768px (tablet) ===
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/");
  await page.waitForTimeout(1000);

  // User menu at tablet
  const tabletTrigger = page.locator('[data-slot="dropdown-menu-trigger"]').first();
  if (await tabletTrigger.isVisible({ timeout: 2000 })) {
    await tabletTrigger.click();
    await checkOpenMenu("User Menu (768px)");
  }

  // === 5. Check at 1024px ===
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await page.waitForTimeout(1000);
  const mdTrigger = page.locator('[data-slot="dropdown-menu-trigger"]').first();
  if (await mdTrigger.isVisible({ timeout: 2000 })) {
    await mdTrigger.click();
    await checkOpenMenu("User Menu (1024px)");
  }

  // === Summary ===
  console.log("\n=== ALL DROPDOWNS AUDIT ===");
  if (issues.length === 0) {
    console.log("All dropdowns OK — no line breaks found");
  } else {
    for (const i of issues) console.log(`  ISSUE: ${i}`);
  }

  expect(issues).toEqual([]);

  // Cleanup
  await page.request.delete(`http://localhost:8000/api/chats/${chat.id}`);
});
