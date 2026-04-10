import { test } from "@playwright/test";

test("debug: action text persists during tool execution", async ({ page }) => {
  const chatRes = await page.request.post("http://localhost:8000/api/chats", {
    data: { title: null },
  });
  const chat = await chatRes.json();
  const chatId = chat.id;

  await page.goto(`/chat/${chatId}`);
  await page.waitForSelector("textarea");

  const startTime = Date.now();
  const textarea = page.locator("textarea");
  await textarea.fill("scrap for me first 10 post of https://dev.to/");
  await page.keyboard.press("Enter");

  // Poll state every 3s for up to 2 minutes
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(3000);
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    const hasLoadingDots = await page.locator('[class*="animate-bounce"]').count();
    const actionEls = page.locator('[class*="animate-fade-in"]');
    const actionCount = await actionEls.count();
    let actionText = "";
    if (actionCount > 0) {
      actionText = await actionEls.last().textContent().catch(() => "") || "";
    }
    const hasStreamingCursor = await page.locator('.streaming-cursor').count();
    const contentLen = hasStreamingCursor > 0
      ? (await page.locator('.streaming-cursor').first().textContent().catch(() => "") || "").length
      : 0;

    console.log(
      `[${elapsed}s] dots=${hasLoadingDots > 0} action="${actionText}" streaming=${hasStreamingCursor > 0} contentLen=${contentLen}`
    );

    // Screenshot during tool execution
    if (elapsed > 5 && elapsed < 15) {
      await page.screenshot({ path: `tests/screenshots/action-${elapsed}s.png` });
    }

    // Check if done
    const doneCheck = hasLoadingDots === 0 && hasStreamingCursor === 0 && contentLen === 0;
    if (doneCheck && i > 10) break;
  }

  await page.screenshot({ path: "tests/screenshots/action-final.png" });
  await page.request.delete(`http://localhost:8000/api/chats/${chatId}`);
});
