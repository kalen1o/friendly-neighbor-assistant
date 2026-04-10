import { test } from "@playwright/test";

test("debug: trace message after auth login", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await page.waitForTimeout(1500);

  const textarea = page.locator("textarea");
  await textarea.fill("Hello world test message");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);

  // Auth dialog should appear - login
  const emailInput = page.locator('input[type="email"]');
  if (await emailInput.count() > 0) {
    await emailInput.fill("testuser@example.com");
    await page.locator('input[type="password"]').first().fill("TestPass1234");
    await page.locator('form button[type="submit"]').click();
    await page.waitForTimeout(5000);

    const url = page.url();
    console.log(`[URL] ${url}`);

    // Check all text content in the main area
    const mainContent = await page.locator("main").innerHTML();
    const hasUserMsg = mainContent.includes("Hello world test message");
    console.log(`[MAIN HTML] has user message: ${hasUserMsg}`);

    // Check all message bubbles
    const allBubbles = page.locator('[class*="rounded-[20px]"]');
    const bubbleCount = await allBubbles.count();
    console.log(`[BUBBLES] count: ${bubbleCount}`);
    for (let i = 0; i < bubbleCount; i++) {
      const text = await allBubbles.nth(i).textContent();
      console.log(`  [${i}] "${text?.substring(0, 80)}"`);
    }

    // Check the messages area specifically
    const chatMessages = page.locator('[class*="space-y-3"]');
    const chatMsgCount = await chatMessages.count();
    console.log(`[CHAT MESSAGES] containers: ${chatMsgCount}`);

    // Check if streaming
    const streaming = await page.locator('.streaming-cursor').count();
    const loading = await page.locator('[class*="animate-bounce"]').count();
    console.log(`[STATE] streaming=${streaming > 0} loading=${loading > 0}`);

    // Wait more and check again
    await page.waitForTimeout(3000);
    const bubbleCount2 = await allBubbles.count();
    console.log(`\n[AFTER 3s MORE] bubbles: ${bubbleCount2}`);

    await page.screenshot({ path: "tests/screenshots/auth-msg-trace.png", fullPage: true });
  }
});
