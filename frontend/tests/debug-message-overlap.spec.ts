import { test } from "@playwright/test";

test("debug: messages hidden behind input on long conversations", async ({ page }) => {
  const email = `overlap2-${Date.now()}@test.com`;
  await page.request.post("http://localhost:8000/api/auth/register", {
    data: { email, password: "TestPass1234", name: "Overlap Tester" },
  });
  await page.request.post("http://localhost:8000/api/auth/login", {
    data: { email, password: "TestPass1234" },
  });

  const chatRes = await page.request.post("http://localhost:8000/api/chats", {
    data: { title: "Overlap Test" },
  });
  const chat = await chatRes.json();

  await page.goto(`/chat/${chat.id}`);
  await page.waitForSelector("textarea");

  // Send a message that will produce a long response
  await page.locator("textarea").fill("Write a 10-item numbered list about benefits of exercise");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(12000);

  // Screenshot after response
  await page.screenshot({ path: "tests/screenshots/overlap-long-response.png", fullPage: false });

  // Check if last message is visible or hidden behind input
  const lastMessageBottom = await page.evaluate(() => {
    const messages = document.querySelectorAll('[class*="max-w-3xl"]');
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg) return { visible: false, info: "no messages found" };

    const msgRect = lastMsg.getBoundingClientRect();
    const input = document.querySelector("textarea");
    const inputRect = input?.getBoundingClientRect();

    return {
      msgBottom: msgRect.bottom,
      inputTop: inputRect?.top,
      overlap: inputRect ? msgRect.bottom > inputRect.top : false,
      info: `msg bottom=${msgRect.bottom} input top=${inputRect?.top}`
    };
  });
  console.log("[overlap check]", JSON.stringify(lastMessageBottom));

  // Scroll to very bottom
  await page.evaluate(() => {
    const scrollable = document.querySelector('[class*="overflow-y-auto"]');
    if (scrollable) scrollable.scrollTop = scrollable.scrollHeight;
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "tests/screenshots/overlap-scrolled-bottom.png", fullPage: false });

  await page.request.delete(`http://localhost:8000/api/chats/${chat.id}`);
});
