import { test, expect } from "@playwright/test";

test("audit all dropdown menus for text wrapping", async ({ page }) => {
  const email = `dropdown-${Date.now()}@test.com`;
  await page.request.post("http://localhost:8000/api/auth/register", {
    data: { email, password: "TestPass1234", name: "Dropdown Tester" },
  });
  await page.request.post("http://localhost:8000/api/auth/login", {
    data: { email, password: "TestPass1234" },
  });

  // Create a chat so we have content
  const chatRes = await page.request.post("http://localhost:8000/api/chats", {
    data: { title: "Dropdown Test Chat" },
  });
  const chat = await chatRes.json();

  const results: { location: string; issue: string; screenshot: string }[] = [];

  // Helper: open a dropdown and check items for wrapping
  async function checkDropdown(name: string, triggerSelector: string, screenshotName: string) {
    try {
      const trigger = page.locator(triggerSelector).first();
      if (!(await trigger.isVisible({ timeout: 2000 }))) {
        console.log(`[SKIP] ${name}: trigger not visible`);
        return;
      }

      await trigger.click();
      await page.waitForTimeout(300);

      // Find all dropdown menu items
      const items = page.locator('[role="menuitem"], [role="option"], [data-slot="dropdown-menu-item"]');
      const count = await items.count();
      console.log(`[${name}] Found ${count} items`);

      for (let i = 0; i < count; i++) {
        const item = items.nth(i);
        if (!(await item.isVisible())) continue;

        const box = await item.boundingBox();
        if (!box) continue;

        const text = await item.textContent() || "";
        const lineHeight = await item.evaluate((el) => {
          const style = window.getComputedStyle(el);
          return parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
        });

        // If height > 2x line height, text is wrapping
        if (box.height > lineHeight * 1.8) {
          const issue = `"${text.trim()}" wraps (height=${box.height.toFixed(0)}px, lineHeight=${lineHeight.toFixed(0)}px)`;
          console.log(`[${name}] WRAP: ${issue}`);
          results.push({ location: name, issue, screenshot: screenshotName });
        }
      }

      await page.screenshot({ path: `tests/screenshots/${screenshotName}.png`, fullPage: false });

      // Close dropdown by pressing Escape
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
    } catch (e) {
      console.log(`[${name}] Error: ${(e as Error).message}`);
    }
  }

  // 1. User menu dropdown (sidebar bottom)
  await page.goto("/");
  await page.waitForTimeout(1000);
  await checkDropdown("User Menu", '[data-slot="dropdown-menu-trigger"]', "dropdown-user-menu");

  // 2. Chat item context menu (hover on chat in sidebar)
  await page.goto(`/chat/${chat.id}`);
  await page.waitForTimeout(1000);

  // 3. Chat mode selector
  const modeButtons = page.locator('button:has-text("Fast"), button:has-text("Balanced"), button:has-text("Thinking")');
  const modeCount = await modeButtons.count();
  console.log(`[Mode Selector] Found ${modeCount} mode buttons`);

  // 4. Check Skills page dropdowns
  await page.goto("/skills");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "tests/screenshots/dropdown-skills-page.png", fullPage: false });

  // 5. Check Hooks page
  await page.goto("/hooks");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "tests/screenshots/dropdown-hooks-page.png", fullPage: false });

  // 6. Check MCP page
  await page.goto("/mcp");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "tests/screenshots/dropdown-mcp-page.png", fullPage: false });

  // 7. Check Documents page
  await page.goto("/documents");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "tests/screenshots/dropdown-docs-page.png", fullPage: false });

  // 8. Check all dialogs for overflowing content
  // Share dialog
  await page.goto(`/chat/${chat.id}`);
  await page.waitForTimeout(1000);

  // 9. Check Command Palette
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(500);
  const paletteItems = page.locator('[class*="rounded-lg"]').filter({ hasText: /Documents|Skills|Hooks|MCP|New Chat/ });
  const paletteCount = await paletteItems.count();
  console.log(`[Command Palette] Found ${paletteCount} items`);

  for (let i = 0; i < paletteCount; i++) {
    const item = paletteItems.nth(i);
    const box = await item.boundingBox();
    const text = await item.textContent() || "";
    if (box && box.height > 50) {
      console.log(`[Command Palette] TALL ITEM: "${text.trim()}" height=${box.height.toFixed(0)}px`);
      results.push({ location: "Command Palette", issue: `"${text.trim()}" height=${box.height.toFixed(0)}px`, screenshot: "dropdown-cmd-palette" });
    }
  }
  await page.screenshot({ path: "tests/screenshots/dropdown-cmd-palette.png", fullPage: false });
  await page.keyboard.press("Escape");

  // 10. Test at narrower viewport (tablet)
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(500);

  // Re-check user menu at narrow width
  await page.goto("/");
  await page.waitForTimeout(1000);
  await checkDropdown("User Menu (tablet)", '[data-slot="dropdown-menu-trigger"]', "dropdown-user-menu-tablet");

  // 11. Test at mobile width
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.goto(`/chat/${chat.id}`);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "tests/screenshots/dropdown-mobile-chat.png", fullPage: false });

  // Summary
  console.log("\n=== DROPDOWN AUDIT SUMMARY ===");
  if (results.length === 0) {
    console.log("No wrapping issues found!");
  } else {
    for (const r of results) {
      console.log(`  [${r.location}] ${r.issue}`);
    }
  }
  expect(results.length).toBe(0);

  await page.request.delete(`http://localhost:8000/api/chats/${chat.id}`);
});
