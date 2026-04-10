import { test } from "@playwright/test";

test("debug: console trace doSend", async ({ page }) => {
  page.on("console", (msg) => {
    if (msg.text().includes("[doSend]") || msg.text().includes("[loadChat]")) {
      console.log(`[CONSOLE] ${msg.text()}`);
    }
  });

  await page.context().clearCookies();
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await page.waitForTimeout(1500);

  const textarea = page.locator("textarea");
  await textarea.fill("Test 123");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);

  // Login
  const emailInput = page.locator('input[type="email"]');
  if (await emailInput.count() > 0) {
    await emailInput.fill("testuser@example.com");
    await page.locator('input[type="password"]').first().fill("TestPass1234");
    await page.locator('form button[type="submit"]').click();
    await page.waitForTimeout(5000);

    // Check messages in state via DOM
    const bubbles = page.locator('[class*="rounded-[20px]"]');
    const count = await bubbles.count();
    console.log(`[RESULT] bubbles: ${count}`);
    for (let i = 0; i < count; i++) {
      const text = await bubbles.nth(i).textContent();
      console.log(`  [${i}] "${text?.substring(0, 60)}"`);
    }

    // Check if user message is anywhere in main
    const mainText = await page.locator("main").textContent();
    console.log(`[RESULT] "Test 123" in main: ${mainText?.includes("Test 123")}`);
  }
});
