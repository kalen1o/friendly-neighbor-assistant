/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from "@playwright/test";

const API = "http://localhost:8000";

test("notification: red dot appears via polling", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    permissions: ["notifications"],
  });
  const page = await context.newPage();

  // Login via API to get cookies on the backend domain
  const loginRes = await context.request.post(`${API}/api/auth/login`, {
    data: { email: "ftest2@test.com", password: "Testpass123" },
  });
  console.log(`[LOGIN] status=${loginRes.status()}`);

  // Now visit the app (frontend cookies set by the login response via Set-Cookie)
  await page.goto("/");
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    localStorage.setItem("notifications-enabled", "true");
    localStorage.setItem("notifications-preview", "true");
    localStorage.setItem("notifications-prompted", "true");
  });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  // Check if logged in
  const signInVisible = await page.getByText("Sign in").first().isVisible().catch(() => false);
  console.log(`[AUTH] signIn visible=${signInVisible} (should be false if logged in)`);

  // If not logged in via cookies, do it via UI
  if (signInVisible) {
    await page.getByText("Sign in").first().click();
    await page.waitForTimeout(1000);
    await page.locator('input[type="email"]').fill("ftest2@test.com");
    await page.locator('input[type="password"]').fill("Testpass123");
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(3000);
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  }

  // Create chat using context.request (shares cookies from login)
  const createRes = await context.request.post(`${API}/api/chats`, {
    data: {},
    headers: { "Content-Type": "application/json" },
  });
  console.log(`[CREATE] status=${createRes.status()}`);
  const chatData = await createRes.json().catch(() => ({}));
  const chatId = chatData?.id;
  console.log(`[CREATE] chatId=${chatId}`);

  if (!chatId) {
    console.log("[ERROR] No chatId, aborting");
    await context.close();
    return;
  }

  // Navigate to chat
  await page.goto(`/chat/${chatId}`);
  await page.waitForTimeout(2000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  console.log(`[CHAT] on ${page.url()}`);

  // Send message
  const textarea = page.locator("textarea").first();
  if (await textarea.isVisible()) {
    await textarea.fill("Say hi");
    await page.keyboard.press("Enter");
    console.log("[SEND] Sent");
    await page.waitForTimeout(1500);

    // Navigate away
    await page.goto("/skills");
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    console.log("[NAV] On /skills");

    // Wait for backend + polling (10s interval)
    console.log("[WAIT] 15s...");
    await page.waitForTimeout(15000);

    // Check API
    const listRes = await context.request.get(`${API}/api/chats`);
    const listData = await listRes.json();
    const withNotif = listData.chats?.filter((c: any) => c.has_notification) || [];
    console.log(`[API] chats=${listData.chats?.length} withNotif=${withNotif.length}`);
    for (const c of withNotif) {
      console.log(`[API]   ${c.id} "${c.title}" has_notification=true`);
    }

    // Check UI
    const redDots = page.locator(".bg-red-500");
    console.log(`[UI] red dots=${await redDots.count()}`);

    await page.screenshot({ path: "tests/screenshots/notif-flow-result.png", fullPage: true });
  }

  await context.close();
});
