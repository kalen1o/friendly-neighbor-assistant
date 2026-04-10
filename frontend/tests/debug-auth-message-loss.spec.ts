import { test } from "@playwright/test";

test("debug: message loss after auth flow", async ({ page }) => {
  // Ensure logged out
  await page.goto("/");
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await page.waitForTimeout(1500);

  // Verify we're not logged in
  const signInVisible = await page.locator("text=Sign in").first().isVisible();
  console.log(`[SETUP] Signed out: ${signInVisible}`);

  // Type a message
  const textarea = page.locator("textarea");
  await textarea.waitFor({ state: "visible", timeout: 5000 });
  await textarea.fill("What is the meaning of life?");
  console.log(`[STEP 1] Typed message in input`);

  // Check input value before send
  const valueBefore = await textarea.inputValue();
  console.log(`[STEP 2] Input value before send: "${valueBefore}"`);

  // Press Enter to send
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);

  // Check if auth dialog appeared
  const dialog = page.locator('[role="dialog"]');
  const dialogVisible = await dialog.count() > 0;
  console.log(`[STEP 3] Auth dialog appeared: ${dialogVisible}`);

  if (dialogVisible) {
    await page.screenshot({ path: "tests/screenshots/auth-flow-1-dialog.png" });

    // Check input value while dialog is open
    const valueDuringAuth = await textarea.inputValue();
    console.log(`[STEP 4] Input value during auth: "${valueDuringAuth}"`);

    // Dismiss the dialog (click outside or press Escape)
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // Check input value after dismissing
    const valueAfterDismiss = await textarea.inputValue();
    console.log(`[STEP 5] Input value after dismiss: "${valueAfterDismiss}"`);
    console.log(`[RESULT] Message preserved after dismiss: ${valueAfterDismiss === "What is the meaning of life?"}`);

    await page.screenshot({ path: "tests/screenshots/auth-flow-2-dismissed.png" });

    // Now try again — this time complete the login
    await textarea.fill("What is the meaning of life?");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);

    const dialog2 = page.locator('[role="dialog"]');
    const dialog2Visible = await dialog2.count() > 0;
    console.log(`\n[STEP 6] Auth dialog appeared again: ${dialog2Visible}`);

    if (dialog2Visible) {
      // Fill in login
      const emailInput = page.locator('input[type="email"]');
      const passwordInput = page.locator('input[type="password"]').first();

      if (await emailInput.count() > 0) {
        await emailInput.fill("testuser@example.com");
        await passwordInput.fill("TestPass1234");

        await page.screenshot({ path: "tests/screenshots/auth-flow-3-login.png" });

        // Submit
        await page.locator('form button[type="submit"]').click();
        await page.waitForTimeout(3000);

        await page.screenshot({ path: "tests/screenshots/auth-flow-4-after-login.png" });

        // Check current URL
        const url = page.url();
        console.log(`[STEP 7] URL after login: ${url}`);

        // Check if message was sent
        const messageVisible = await page.locator("text=What is the meaning of life?").count();
        console.log(`[STEP 8] Message visible on page: ${messageVisible > 0}`);

        // Check for streaming or response
        const streamingCursor = await page.locator('.streaming-cursor').count();
        const loadingDots = await page.locator('[class*="animate-bounce"]').count();
        console.log(`[STEP 9] Streaming: ${streamingCursor > 0}, Loading: ${loadingDots > 0}`);
      }
    }
  } else {
    console.log("[UNEXPECTED] No auth dialog — might already be logged in");
    await page.screenshot({ path: "tests/screenshots/auth-flow-no-dialog.png" });
  }
});
