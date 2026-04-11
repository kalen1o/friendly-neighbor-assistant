import { test, expect } from "@playwright/test";

test("debug: reload /chat/{id} should show skeleton then messages, not welcome", async ({ page }) => {
  // Step 1: Register and login to get auth cookies
  const email = `reload-test-${Date.now()}@test.com`;
  const password = "TestPass1234";

  await page.request.post("http://localhost:8000/api/auth/register", {
    data: { email, password, name: "Reload Tester" },
  });
  const loginRes = await page.request.post("http://localhost:8000/api/auth/login", {
    data: { email, password },
  });
  console.log("[setup] Login status:", loginRes.status());

  // Step 2: Create a chat via API (cookies are on the page.request context)
  const chatRes = await page.request.post("http://localhost:8000/api/chats", {
    data: { title: "Reload Test Chat" },
  });
  const chat = await chatRes.json();
  const chatId = chat.id;
  console.log("[setup] Created chat:", chatId);

  // Step 3: Navigate and send a message so the chat has content
  await page.goto(`/chat/${chatId}`);
  await page.waitForSelector("textarea");

  const textarea = page.locator("textarea");
  await textarea.fill("Say hello back in one sentence");
  await page.keyboard.press("Enter");

  // Wait for the assistant to respond
  await page.waitForTimeout(8000);
  await page.screenshot({ path: "tests/screenshots/reload-before-reload.png", fullPage: true });

  // Step 4: Count messages before reload
  const pageContent = await page.textContent("body");
  const hasAssistantResponse = pageContent?.includes("hello") || pageContent?.includes("Hello");
  console.log("[step4] Has assistant response:", hasAssistantResponse);

  // Step 5: RELOAD
  console.log("[step5] Reloading...");
  await page.reload();

  // Step 6: Rapid checks right after reload
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(100);
    const elapsed = (i + 1) * 100;

    const hasWelcome = await page.locator("text=What can I help").isVisible().catch(() => false);
    const hasSkeleton = await page.evaluate(() =>
      document.querySelector('[class*="animate-pulse"]') !== null
    );
    const bodyText = await page.textContent("body") || "";
    const hasMessages = bodyText.includes("hello") || bodyText.includes("Hello") || bodyText.includes("Say hello");

    console.log(`[${elapsed}ms] welcome=${hasWelcome} skeleton=${hasSkeleton} hasMessages=${hasMessages}`);

    if (i === 0) {
      await page.screenshot({ path: "tests/screenshots/reload-0ms.png", fullPage: true });
    }
    if (i === 4) {
      await page.screenshot({ path: "tests/screenshots/reload-500ms.png", fullPage: true });
    }
  }

  // Step 7: Wait for full load
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "tests/screenshots/reload-final.png", fullPage: true });

  const finalWelcome = await page.locator("text=What can I help").isVisible().catch(() => false);
  console.log("[final] welcome visible:", finalWelcome);

  expect(finalWelcome).toBe(false);

  // Cleanup
  await page.request.delete(`http://localhost:8000/api/chats/${chatId}`);
});
