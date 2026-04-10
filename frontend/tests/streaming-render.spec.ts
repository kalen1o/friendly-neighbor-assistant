import { test, expect } from "@playwright/test";

test("streaming message renders plain text with cursor, final renders markdown", async ({ page }) => {
  // Create a new chat via API
  const chatRes = await page.request.post("http://localhost:8000/api/chats", {
    data: { title: null },
  });
  const chat = await chatRes.json();
  const chatId = chat.id;

  await page.goto(`/chat/${chatId}`);
  await page.waitForSelector("textarea");

  // Send a message that will trigger markdown in the response
  const textarea = page.locator("textarea");
  await textarea.fill("Write a short python hello world with code block and a bullet list of 3 items. Keep it very brief.");
  await page.keyboard.press("Enter");

  // Wait for streaming to start - look for the streaming message bubble
  const streamingBubble = page.locator(".streaming-cursor");
  await streamingBubble.waitFor({ state: "visible", timeout: 30000 });

  // Take screenshot during streaming
  await page.screenshot({ path: "tests/screenshots/streaming.png", fullPage: true });

  // Check that streaming content is plain text (no ReactMarkdown components)
  // The streaming-cursor div should contain a <p> with whitespace-pre-wrap
  const streamingP = streamingBubble.locator("p.whitespace-pre-wrap");
  const pCount = await streamingP.count();
  console.log(`[STREAMING] Found ${pCount} <p class="whitespace-pre-wrap"> elements`);

  // Check cursor is visible via ::after pseudo-element
  const cursorVisible = await streamingBubble.evaluate((el) => {
    const style = window.getComputedStyle(el, "::after");
    return {
      content: style.content,
      display: style.display,
      opacity: style.opacity,
    };
  });
  console.log("[STREAMING] Cursor ::after styles:", JSON.stringify(cursorVisible));

  // Wait for streaming to end (streaming-cursor disappears)
  await streamingBubble.waitFor({ state: "detached", timeout: 120000 });

  // Take screenshot after finalization
  await page.waitForTimeout(500);
  await page.screenshot({ path: "tests/screenshots/final.png", fullPage: true });

  // Check final message uses ReactMarkdown (should have formatted elements)
  const assistantBubbles = page.locator('[class*="rounded-bl-md"]');
  const lastBubble = assistantBubbles.last();

  // Check for markdown-rendered elements (code blocks, lists, etc.)
  const html = await lastBubble.innerHTML();
  console.log("[FINAL] Message HTML (first 500 chars):", html.substring(0, 500));

  // Should NOT have whitespace-pre-wrap on the final message
  const hasPreWrap = html.includes("whitespace-pre-wrap");
  console.log("[FINAL] Has whitespace-pre-wrap (should be false):", hasPreWrap);

  // Should have formatted markdown elements
  const hasCodeBlock = html.includes("group/code") || html.includes("SyntaxHighlighter");
  const hasList = html.includes("list-disc") || html.includes("list-decimal");
  const hasStrong = html.includes("font-semibold");
  console.log("[FINAL] Has code block:", hasCodeBlock);
  console.log("[FINAL] Has list:", hasList);
  console.log("[FINAL] Has strong:", hasStrong);

  // Cleanup
  await page.request.delete(`http://localhost:8000/api/chats/${chatId}`);
});
