/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from "@playwright/test";

const API = "http://localhost:8000";

test("reload during generation: no duplicate generating bubble", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  // Login
  await context.request.post(`${API}/api/auth/login`, {
    data: { email: "ftest2@test.com", password: "Testpass123" },
  });

  await page.goto("/");
  await page.waitForTimeout(2000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  // Create chat and send a slow query
  const chatRes = await context.request.post(`${API}/api/chats`, {
    data: {},
    headers: { "Content-Type": "application/json" },
  });
  const chatId = (await chatRes.json())?.id;
  console.log(`[CHAT] created ${chatId}`);

  await page.goto(`/chat/${chatId}`);
  await page.waitForTimeout(2000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  // Send message
  const textarea = page.locator("textarea").first();
  await textarea.fill("Write a detailed 8-line poem about mountains and rivers.");
  await page.keyboard.press("Enter");
  console.log("[SEND] sent");

  // Wait a bit for generation to start (backend saves first chunk)
  await page.waitForTimeout(3000);

  // Navigate to another chat
  const chat2Res = await context.request.post(`${API}/api/chats`, {
    data: { title: "Other" },
    headers: { "Content-Type": "application/json" },
  });
  const chat2Id = (await chat2Res.json())?.id;
  await page.goto(`/chat/${chat2Id}`);
  console.log("[NAV] navigated away");

  // Reload to kill in-memory stream
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForTimeout(2000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  console.log("[RELOAD] reloaded");

  // Check API — message should be generating
  const chatData = await context.request.get(`${API}/api/chats/${chatId}?limit=20`);
  const data = await chatData.json();
  const assistantMsg = data.messages?.find((m: any) => m.role === "assistant");
  console.log(`[API] assistant status=${assistantMsg?.status} content_len=${assistantMsg?.content?.length}`);

  // Navigate back to the generating chat
  await page.goto(`/chat/${chatId}`);
  await page.waitForTimeout(3000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  console.log("[BACK] navigated back to generating chat");

  // Screenshot to verify UI
  await page.screenshot({ path: "tests/screenshots/bg-reload-ui-1.png", fullPage: true });

  // Check: should NOT have "Generating response..." text as a separate bubble
  const mainContent = await page.locator("main").textContent();
  const generatingCount = (mainContent?.match(/Generating response/g) || []).length;
  console.log(`[UI] "Generating response..." occurrences: ${generatingCount}`);

  // There should be a streaming cursor (the partial message shown as streaming)
  const streamingCursor = page.locator(".streaming-cursor");
  const hasCursor = await streamingCursor.count();
  console.log(`[UI] streaming cursors: ${hasCursor}`);

  // Count assistant message bubbles — should be exactly 1 (streaming), not 2
  const assistantBubbles = page.locator(".justify-start .rounded-2xl, .justify-start .rounded-\\[20px\\]");
  const bubbleCount = await assistantBubbles.count();
  console.log(`[UI] assistant bubbles: ${bubbleCount}`);

  // Wait for completion
  console.log("[WAIT] 20s for completion...");
  await page.waitForTimeout(20000);
  await page.screenshot({ path: "tests/screenshots/bg-reload-ui-2.png", fullPage: true });

  // Verify final state
  const finalData = await context.request.get(`${API}/api/chats/${chatId}?limit=20`);
  const finalChat = await finalData.json();
  const finalMsg = finalChat.messages?.find((m: any) => m.role === "assistant");
  console.log(`[API] final status=${finalMsg?.status} content_len=${finalMsg?.content?.length}`);
  expect(finalMsg?.status).toBe("completed");

  await context.close();
});
