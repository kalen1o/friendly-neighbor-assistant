import { test } from "@playwright/test";

test("debug: inspect raw message content", async ({ page }) => {
  // Create chat and send message
  const chatRes = await page.request.post("http://localhost:8000/api/chats", {
    data: { title: null },
  });
  const chat = await chatRes.json();
  const chatId = chat.id;

  await page.goto(`/chat/${chatId}`);
  await page.waitForSelector("textarea");

  const textarea = page.locator("textarea");
  await textarea.fill("Write a python hello world in a code block. Keep it to 2 lines max.");
  await page.keyboard.press("Enter");

  // Wait for streaming to finish
  const streamingCursor = page.locator(".streaming-cursor");
  await streamingCursor.waitFor({ state: "visible", timeout: 30000 });
  await streamingCursor.waitFor({ state: "detached", timeout: 120000 });
  await page.waitForTimeout(1000);

  // Fetch the chat from API and inspect raw content
  const apiRes = await page.request.get(`http://localhost:8000/api/chats/${chatId}`);
  const chatData = await apiRes.json();
  const assistantMsg = chatData.messages.find((m: any) => m.role === "assistant");

  if (assistantMsg) {
    console.log("[RAW CONTENT]:");
    console.log(JSON.stringify(assistantMsg.content));
    console.log("\n[CONTENT LENGTH]:", assistantMsg.content.length);
    console.log("[HAS NEWLINES]:", assistantMsg.content.includes("\n"));
    console.log("[NEWLINE COUNT]:", (assistantMsg.content.match(/\n/g) || []).length);
  } else {
    console.log("No assistant message found!");
  }

  // Also check what's currently rendered in the DOM
  const bubbles = page.locator('[class*="rounded-bl-md"]');
  const lastBubble = bubbles.last();
  const innerHTML = await lastBubble.innerHTML();
  console.log("\n[RENDERED HTML] (first 800):", innerHTML.substring(0, 800));

  // Cleanup
  await page.request.delete(`http://localhost:8000/api/chats/${chatId}`);
});
