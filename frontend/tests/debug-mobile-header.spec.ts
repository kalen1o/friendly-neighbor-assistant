import { test } from "@playwright/test";

test("debug: mobile chat header layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); // iPhone 14

  const email = `mobile-${Date.now()}@test.com`;
  await page.request.post("http://localhost:8000/api/auth/register", {
    data: { email, password: "TestPass1234", name: "Mobile Tester" },
  });
  await page.request.post("http://localhost:8000/api/auth/login", {
    data: { email, password: "TestPass1234" },
  });

  const chatRes = await page.request.post("http://localhost:8000/api/chats", {
    data: { title: "Mobile Test" },
  });
  const chat = await chatRes.json();

  await page.goto(`/chat/${chat.id}`);
  await page.waitForSelector("textarea");
  await page.locator("textarea").fill("Hello");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(5000);

  await page.screenshot({ path: "tests/screenshots/mobile-chat.png", fullPage: true });
  await page.request.delete(`http://localhost:8000/api/chats/${chat.id}`);
});
