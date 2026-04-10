import { test } from "@playwright/test";

test("verify: action text shows during tool calls", async ({ page }) => {
  const chatRes = await page.request.post("http://localhost:8000/api/chats", {
    data: { title: null },
  });
  const chat = await chatRes.json();

  await page.goto(`/chat/${chat.id}`);
  await page.waitForSelector("textarea");

  // Use a simpler query that triggers tools but completes faster
  const textarea = page.locator("textarea");
  await textarea.fill("what is the weather today?");
  await page.keyboard.press("Enter");

  const startTime = Date.now();
  let sawActionText = false;
  let sawStreamingWithAction = false;

  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    const dots = await page.locator('[class*="animate-bounce"]').count();
    const streaming = await page.locator('.streaming-cursor').count();

    // Look for action text specifically in the loading indicator
    const loadingBubbles = page.locator('.rounded-bl-md >> text=/Using|Generating/');
    const actionVisible = await loadingBubbles.count();

    if (actionVisible > 0) sawActionText = true;
    if (actionVisible > 0 && streaming > 0) sawStreamingWithAction = true;

    console.log(`[${elapsed}s] dots=${dots > 0} action=${actionVisible > 0} streaming=${streaming > 0}`);

    if (dots === 0 && streaming === 0 && i > 5) break;
  }

  console.log(`\n[RESULT] sawActionText=${sawActionText} sawStreamingWithAction=${sawStreamingWithAction}`);

  await page.screenshot({ path: "tests/screenshots/verify-action.png" });
  await page.request.delete(`http://localhost:8000/api/chats/${chat.id}`);
});
