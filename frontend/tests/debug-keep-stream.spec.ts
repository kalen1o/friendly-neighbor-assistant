import { test } from "@playwright/test";

const API = "http://localhost:8000";

test("stream keeps running when clicking sidebar chat (SPA nav)", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  // Login
  await context.request.post(`${API}/api/auth/login`, {
    data: { email: "ftest2@test.com", password: "Testpass123" },
  });

  // Capture console logs
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("ACTIVE-STREAM")) console.log(`[BROWSER] ${text}`);
  });

  await page.goto("/");
  await page.waitForTimeout(2000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  // Create two chats via API
  const chatARes = await context.request.post(`${API}/api/chats`, { data: {} });
  const chatA = (await chatARes.json())?.id;
  const chatBRes = await context.request.post(`${API}/api/chats`, { data: {} });
  const chatB = (await chatBRes.json())?.id;
  console.log(`[SETUP] chatA=${chatA} chatB=${chatB}`);

  // Refresh sidebar to show new chats
  await page.evaluate(() => window.dispatchEvent(new Event("chat-title-updated")));
  await page.waitForTimeout(1000);

  // Go to chat A via sidebar click
  const chatALink = page.locator(`aside`).getByText("New Chat").first();
  await chatALink.click();
  await page.waitForTimeout(2000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  console.log(`[NAV] On: ${page.url()}`);

  // Verify we're on a chat page
  const onChat = page.url().includes("/chat/");
  if (!onChat) {
    console.log("[SKIP] Not on a chat page, aborting");
    await context.close();
    return;
  }

  const currentChatId = page.url().split("/chat/")[1];
  console.log(`[CHAT] On chat: ${currentChatId}`);

  // Send the AC Milan query
  const textarea = page.locator("textarea").first();
  await textarea.fill("latest AC Milan match, results and scorers");
  await page.keyboard.press("Enter");
  console.log("[SEND] Sent query");

  // Wait 3s for streaming to start
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "tests/screenshots/keep-stream-1-streaming.png" });

  // Click ANOTHER chat in sidebar (SPA navigation, not page.goto)
  const otherChat = page.locator("aside").locator("[class*='cursor-pointer']").nth(1);
  if (await otherChat.isVisible()) {
    await otherChat.click();
    await page.waitForTimeout(1000);
    console.log(`[NAV] Clicked sidebar, now on: ${page.url()}`);
  }

  // Wait for LLM to complete
  console.log("[WAIT] 25s...");
  await page.waitForTimeout(25000);

  // Check API for the original chat
  const chatData = await context.request.get(`${API}/api/chats/${currentChatId}?limit=20`);
  if (chatData.ok()) {
    const data = await chatData.json();
    console.log(`[API] messages=${data.messages?.length}`);
    for (const m of data.messages || []) {
      console.log(`[API]   ${m.role}: ${m.content?.substring(0, 100)}...`);
    }
  }

  // Click back to original chat in sidebar
  const origChat = page.locator("aside").locator("[class*='cursor-pointer']").first();
  await origChat.click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "tests/screenshots/keep-stream-2-back.png", fullPage: true });
  console.log(`[RESULT] URL: ${page.url()}`);

  await context.close();
});
