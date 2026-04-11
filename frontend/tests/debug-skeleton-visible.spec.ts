import { test, expect } from "@playwright/test";

test("debug: skeleton should be visible during slow chat load", async ({ page }) => {
  // Register and login
  const email = `skeleton-test-${Date.now()}@test.com`;
  await page.request.post("http://localhost:8000/api/auth/register", {
    data: { email, password: "TestPass1234", name: "Skeleton Tester" },
  });
  await page.request.post("http://localhost:8000/api/auth/login", {
    data: { email, password: "TestPass1234" },
  });

  // Create a chat with messages
  const chatRes = await page.request.post("http://localhost:8000/api/chats", {
    data: { title: "Skeleton Test" },
  });
  const chat = await chatRes.json();
  const chatId = chat.id;

  // Navigate and send a message
  await page.goto(`/chat/${chatId}`);
  await page.waitForSelector("textarea");
  await page.locator("textarea").fill("Hi");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(5000);

  // Now intercept the API to add a delay, simulating slow network
  await page.route("**/api/chats/**", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });

  // Reload — the API will take 1.5s, skeleton should show
  await page.reload();

  // Check for skeleton at multiple points
  let sawSkeleton = false;
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(100);
    const hasSkeleton = await page.evaluate(() =>
      document.querySelector('[class*="animate-pulse"]') !== null ||
      document.querySelector('[data-boneyard]') !== null
    );
    const hasWelcome = await page.locator("text=What can I help").isVisible().catch(() => false);
    const elapsed = (i + 1) * 100;
    console.log(`[${elapsed}ms] skeleton=${hasSkeleton} welcome=${hasWelcome}`);
    if (hasSkeleton) sawSkeleton = true;

    if (i === 2) {
      await page.screenshot({ path: "tests/screenshots/skeleton-during-load.png", fullPage: true });
    }
  }

  // Wait for full load
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "tests/screenshots/skeleton-after-load.png", fullPage: true });

  console.log("[result] Saw skeleton during load:", sawSkeleton);
  expect(sawSkeleton).toBe(true);

  // Cleanup
  await page.request.delete(`http://localhost:8000/api/chats/${chatId}`);
});
