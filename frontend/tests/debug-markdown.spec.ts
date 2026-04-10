import { test } from "@playwright/test";

test("debug: render markdown code block directly", async ({ page }) => {
  // Navigate to an existing chat, then inject test content
  const chatRes = await page.request.post("http://localhost:8000/api/chats", {
    data: { title: null },
  });
  const chat = await chatRes.json();

  await page.goto(`/chat/${chat.id}`);
  await page.waitForSelector("textarea");

  // Inject test markdown content directly via the page console
  const testContent = '```python\nprint("hello")\n```\n\n- item 1\n- item 2';

  const result = await page.evaluate((content) => {
    // Find ReactMarkdown in the page and render test content
    // Instead, let's just check what the DOM looks like for a message
    const div = document.createElement("div");
    div.innerHTML = `<pre><code>${content}</code></pre>`;
    return div.innerHTML;
  }, testContent);

  console.log("Basic HTML:", result);

  // Better: send a message and compare streaming vs final
  const textarea = page.locator("textarea");
  await textarea.fill("Reply with exactly this and nothing else:\n```python\nprint(\"hello\")\n```\n\n- one\n- two");
  await page.keyboard.press("Enter");

  // Wait for streaming to start
  const cursor = page.locator(".streaming-cursor");
  await cursor.waitFor({ state: "visible", timeout: 30000 });

  // Capture streaming state
  const streamHTML = await cursor.innerHTML();
  console.log("\n[STREAMING HTML]:", streamHTML.substring(0, 500));

  // Wait for final
  await cursor.waitFor({ state: "detached", timeout: 120000 });
  await page.waitForTimeout(500);

  // Capture final state
  const bubbles = page.locator('[class*="rounded-bl-md"]');
  const lastBubble = bubbles.last();
  const finalHTML = await lastBubble.innerHTML();
  console.log("\n[FINAL HTML]:", finalHTML.substring(0, 800));

  // Check if code block rendered properly
  const hasCodeBlock = finalHTML.includes("group/code");
  const hasList = finalHTML.includes("list-disc");
  console.log("\n[HAS CODE BLOCK]:", hasCodeBlock);
  console.log("[HAS LIST]:", hasList);

  // Check for the actual code content
  const hasHelloContent = finalHTML.includes('print');
  console.log("[HAS PRINT]:", hasHelloContent);

  // Screenshot
  await page.screenshot({ path: "tests/screenshots/markdown-test.png", fullPage: true });

  await page.request.delete(`http://localhost:8000/api/chats/${chat.id}`);
});
