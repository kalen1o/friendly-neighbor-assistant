import { test } from "@playwright/test";

const API = "http://localhost:8000";

test("background task: AC Milan response saved after nav away", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  await context.request.post(`${API}/api/auth/login`, {
    data: { email: "ftest2@test.com", password: "Testpass123" },
  });

  await page.goto("/");
  await page.waitForTimeout(2000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  const chatRes = await context.request.post(`${API}/api/chats`, { data: {} });
  const chatId = (await chatRes.json())?.id;
  console.log(`[CHAT] ${chatId}`);

  await page.goto(`/chat/${chatId}`);
  await page.waitForTimeout(2000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  const textarea = page.locator("textarea").first();
  await textarea.fill("latest AC Milan match, results and scorers");
  await page.keyboard.press("Enter");
  console.log("[SEND] sent");

  // Navigate away after 2s
  await page.waitForTimeout(2000);
  await page.goto("/skills");
  console.log("[NAV] on /skills");

  // Poll API until response appears (max 60s)
  let found = false;
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(5000);
    const res = await context.request.get(`${API}/api/chats/${chatId}?limit=20`);
    const data = await res.json();
    const assistant = data.messages?.find((m: any) => m.role === "assistant" && m.content?.length > 10);
    if (assistant) {
      console.log(`[POLL ${i+1}] FOUND! ${assistant.content.length} chars: ${assistant.content.substring(0, 120)}...`);
      found = true;
      break;
    }
    console.log(`[POLL ${i+1}] not yet (${data.messages?.length} msgs)`);
  }

  console.log(`[RESULT] response saved: ${found}`);

  // Navigate back to chat
  if (found) {
    await page.goto(`/chat/${chatId}`);
    await page.waitForTimeout(3000);
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.screenshot({ path: "tests/screenshots/bg-final-result.png", fullPage: true });

    const mainText = await page.locator("main").textContent();
    console.log(`[UI] page length: ${mainText?.length}`);
    console.log(`[UI] contains Milan: ${mainText?.includes("Milan")}`);
  }

  await context.close();
});
