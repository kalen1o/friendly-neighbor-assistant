import { test } from "@playwright/test";

const API = "http://localhost:8000";

test("partial response saved when navigating away mid-stream", async ({ browser }) => {
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

  // Create chat
  const createRes = await context.request.post(`${API}/api/chats`, {
    data: {},
    headers: { "Content-Type": "application/json" },
  });
  const chatId = (await createRes.json())?.id;
  console.log(`[CHAT] ${chatId}`);

  // Go to chat and send message
  await page.goto(`/chat/${chatId}`);
  await page.waitForTimeout(2000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  const textarea = page.locator("textarea").first();
  await textarea.fill("Write a short poem about the moon");
  await page.keyboard.press("Enter");
  console.log("[SEND] sent");

  // Wait for streaming to start
  await page.waitForTimeout(3000);

  // Navigate away (kills SSE)
  await page.goto("/skills");
  console.log("[NAV] navigated away");

  // Wait for backend to save partial response
  await page.waitForTimeout(5000);

  // Check if message was saved
  const chatRes = await context.request.get(`${API}/api/chats/${chatId}?limit=50`);
  const data = await chatRes.json();
  console.log(`[API] status=${chatRes.status()} keys=${Object.keys(data)}`);
  console.log(`[API] messages=${data.messages?.length}`);
  for (const m of data.messages || []) {
    console.log(`[MSG] role=${m.role} len=${m.content?.length} content="${m.content?.substring(0, 80)}..."`);
  }

  // Navigate back to chat
  await page.goto(`/chat/${chatId}`);
  await page.waitForTimeout(3000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.screenshot({ path: "tests/screenshots/partial-save-result.png", fullPage: true });

  // Check what's displayed
  const mainText = await page.locator("main").textContent();
  const hasResponse = mainText && mainText.length > 100;
  console.log(`[UI] has content=${hasResponse} length=${mainText?.length}`);

  await context.close();
});
