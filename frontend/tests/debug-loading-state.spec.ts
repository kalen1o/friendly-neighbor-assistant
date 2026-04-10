import { test } from "@playwright/test";

test("debug: loading state during tool calls", async ({ page }) => {
  // Create chat
  const chatRes = await page.request.post("http://localhost:8000/api/chats", {
    data: { title: null },
  });
  const chat = await chatRes.json();
  const chatId = chat.id;

  await page.goto(`/chat/${chatId}`);
  await page.waitForSelector("textarea");

  // Track all SSE events
  const sseEvents: { time: number; event: string; data: string }[] = [];
  const startTime = Date.now();

  // Intercept the SSE response
  page.on("response", async (response) => {
    if (response.url().includes("/messages")) {
      console.log("[SSE] Response status:", response.status());
    }
  });

  // Monitor DOM changes for loading/action states
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      // Check for loading indicator
      const bouncing = document.querySelectorAll('[class*="animate-bounce"]');
      const actionText = document.querySelector('[class*="animate-fade-in"]');
      const streamingCursor = document.querySelector('.streaming-cursor');

      if (bouncing.length > 0 || actionText || streamingCursor) {
        console.log(
          `[DOM] bounce=${bouncing.length} action="${actionText?.textContent || ''}" streaming=${!!streamingCursor}`
        );
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  });

  // Listen to console logs from the page
  page.on("console", (msg) => {
    if (msg.text().startsWith("[DOM]") || msg.text().startsWith("[SSE]")) {
      console.log(`${Date.now() - startTime}ms ${msg.text()}`);
    }
  });

  // Send the message
  const textarea = page.locator("textarea");
  await textarea.fill("scrap for me first 10 post of https://dev.to/");
  await page.keyboard.press("Enter");

  // Take periodic screenshots and log state
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(2000);
    const elapsed = Date.now() - startTime;

    // Check what's visible
    const hasLoadingDots = await page.locator('[class*="animate-bounce"]').count();
    const actionEl = page.locator('[class*="animate-fade-in"]').first();
    const actionText = hasLoadingDots > 0 ? await actionEl.textContent().catch(() => "") : "";
    const hasStreamingCursor = await page.locator('.streaming-cursor').count();
    const streamingContent = hasStreamingCursor > 0
      ? await page.locator('.streaming-cursor').first().textContent().catch(() => "")
      : "";
    const bubbleCount = await page.locator('[class*="rounded-bl-md"]').count();

    console.log(
      `[${elapsed}ms] dots=${hasLoadingDots} action="${actionText}" streaming=${hasStreamingCursor} bubbles=${bubbleCount} content="${(streamingContent || "").substring(0, 80)}"`
    );

    // Take screenshot at key moments
    if (i === 0 || i === 3 || i === 8) {
      await page.screenshot({
        path: `tests/screenshots/loading-${i}.png`,
        fullPage: true
      });
    }

    // Stop early if we see the final message
    const done = await page.locator('.streaming-cursor').count() === 0 && bubbleCount > 0;
    if (done && i > 5) break;
  }

  // Final screenshot
  await page.screenshot({ path: "tests/screenshots/loading-final.png", fullPage: true });

  // Cleanup
  await page.request.delete(`http://localhost:8000/api/chats/${chatId}`);
});
