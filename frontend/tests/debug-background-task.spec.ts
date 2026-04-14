/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from "@playwright/test";

const API = "http://localhost:8000";

test("background task: response saved after navigating away", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    permissions: ["notifications"],
  });
  const page = await context.newPage();

  // Login
  await context.request.post(`${API}/api/auth/login`, {
    data: { email: "ftest2@test.com", password: "Testpass123" },
  });

  await page.goto("/");
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    localStorage.setItem("notifications-enabled", "true");
    localStorage.setItem("notifications-preview", "true");
    localStorage.setItem("notifications-prompted", "true");
  });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  // Create chat
  const chatRes = await context.request.post(`${API}/api/chats`, {
    data: {},
    headers: { "Content-Type": "application/json" },
  });
  const chatId = (await chatRes.json())?.id;
  console.log(`[CHAT] created ${chatId}`);

  // Go to chat
  await page.goto(`/chat/${chatId}`);
  await page.waitForTimeout(2000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  // Send AC Milan query
  const textarea = page.locator("textarea").first();
  await textarea.fill("latest AC Milan match, results and scorers");
  await page.keyboard.press("Enter");
  console.log("[SEND] sent");

  // Wait 2s then navigate away
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "tests/screenshots/bg-1-streaming.png" });

  // Navigate to skills (different page)
  await page.goto("/skills");
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  console.log("[NAV] on /skills — SSE disconnected, background task should keep running");

  // Wait for background task to complete
  console.log("[WAIT] 20s for background task...");
  await page.waitForTimeout(20000);

  // Check API — response should be saved
  const chatData = await context.request.get(`${API}/api/chats/${chatId}?limit=20`);
  const data = await chatData.json();
  console.log(`[API] messages=${data.messages?.length}`);
  for (const m of data.messages || []) {
    console.log(`[API]   ${m.role} (${m.content?.length} chars): ${m.content?.substring(0, 120)}...`);
  }

  const hasAssistant = data.messages?.some((m: any) => m.role === "assistant" && m.content?.length > 0);
  console.log(`[RESULT] assistant response saved: ${hasAssistant}`);

  // Check red dot in sidebar
  const redDots = page.locator(".bg-red-500");
  console.log(`[UI] red dot count: ${await redDots.count()}`);

  // Navigate back to the chat
  await page.goto(`/chat/${chatId}`);
  await page.waitForTimeout(3000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.screenshot({ path: "tests/screenshots/bg-2-back.png", fullPage: true });
  console.log(`[BACK] on ${page.url()}`);

  // Check page content
  const mainText = await page.locator("main").textContent();
  const hasContent = mainText && mainText.includes("Milan");
  console.log(`[UI] page contains "Milan": ${hasContent}`);

  await context.close();
});

test("background task: stays streaming when user watches", async ({ browser }) => {
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
  const chatRes = await context.request.post(`${API}/api/chats`, {
    data: {},
    headers: { "Content-Type": "application/json" },
  });
  const chatId = (await chatRes.json())?.id;

  await page.goto(`/chat/${chatId}`);
  await page.waitForTimeout(2000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  // Send a simple message (stays on page)
  const textarea = page.locator("textarea").first();
  await textarea.fill("Say hello in 3 words");
  await page.keyboard.press("Enter");
  console.log("[SEND] sent simple message");

  // Wait for response to complete (user stays on page)
  await page.waitForTimeout(15000);
  await page.screenshot({ path: "tests/screenshots/bg-3-stayed.png", fullPage: true });

  // Check API
  const chatData = await context.request.get(`${API}/api/chats/${chatId}?limit=20`);
  const data = await chatData.json();
  console.log(`[API] messages=${data.messages?.length}`);
  for (const m of data.messages || []) {
    console.log(`[API]   ${m.role}: ${m.content?.substring(0, 100)}...`);
  }

  // Check UI shows response
  const mainText = await page.locator("main").textContent();
  const hasResponse = mainText && mainText.length > 100;
  console.log(`[UI] has visible response: ${hasResponse}`);

  await context.close();
});

test("background task: response survives reload", async ({ browser }) => {
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
  const chatRes = await context.request.post(`${API}/api/chats`, {
    data: {},
    headers: { "Content-Type": "application/json" },
  });
  const chatId = (await chatRes.json())?.id;
  console.log(`[CHAT] ${chatId}`);

  await page.goto(`/chat/${chatId}`);
  await page.waitForTimeout(2000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  // Send query
  const textarea = page.locator("textarea").first();
  await textarea.fill("What is the capital of France? Answer in one sentence.");
  await page.keyboard.press("Enter");
  console.log("[SEND] sent");

  // Navigate away immediately
  await page.waitForTimeout(1000);
  await page.goto("/documents");
  console.log("[NAV] on /documents");

  // Wait for task
  await page.waitForTimeout(15000);

  // RELOAD then navigate to chat
  await page.reload();
  await page.waitForTimeout(2000);
  await page.goto(`/chat/${chatId}`);
  await page.waitForTimeout(3000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.screenshot({ path: "tests/screenshots/bg-4-reload.png", fullPage: true });

  // Check
  const chatData = await context.request.get(`${API}/api/chats/${chatId}?limit=20`);
  const data = await chatData.json();
  console.log(`[API] messages=${data.messages?.length}`);
  for (const m of data.messages || []) {
    console.log(`[API]   ${m.role}: ${m.content?.substring(0, 100)}...`);
  }

  const hasAssistant = data.messages?.some((m: any) => m.role === "assistant" && m.content?.length > 0);
  console.log(`[RESULT] response survived reload: ${hasAssistant}`);

  await context.close();
});
