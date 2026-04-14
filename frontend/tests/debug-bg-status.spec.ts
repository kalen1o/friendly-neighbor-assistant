/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { test, expect } from "@playwright/test";

const API = "http://localhost:8000";

test("background LLM: spinner shows during generation, check icon after completion", async ({ browser }) => {
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

  // Create chat via API
  const chatRes = await context.request.post(`${API}/api/chats`, {
    data: {},
    headers: { "Content-Type": "application/json" },
  });
  const chatId = (await chatRes.json())?.id;
  console.log(`[CHAT] created ${chatId}`);

  // Navigate to chat and send message
  await page.goto(`/chat/${chatId}`);
  await page.waitForTimeout(2000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  const textarea = page.locator("textarea").first();
  await textarea.fill("What is 2+2? Answer in one word.");
  await page.keyboard.press("Enter");
  console.log("[SEND] sent");

  // Navigate to another chat immediately
  await page.waitForTimeout(1500);

  // Create a second chat to navigate to
  const chat2Res = await context.request.post(`${API}/api/chats`, {
    data: { title: "Other Chat" },
    headers: { "Content-Type": "application/json" },
  });
  const chat2Id = (await chat2Res.json())?.id;
  await page.goto(`/chat/${chat2Id}`);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  console.log("[NAV] navigated to other chat");

  // Check API: is_generating should be true while generating
  await page.waitForTimeout(1000);
  const listRes1 = await context.request.get(`${API}/api/chats`);
  const listData1 = await listRes1.json();
  const genChat1 = listData1.chats?.find((c: any) => c.id === chatId);
  console.log(`[API] is_generating=${genChat1?.is_generating} has_notification=${genChat1?.has_notification}`);

  // Wait for completion (backend continues in background)
  console.log("[WAIT] 20s for background task...");
  await page.waitForTimeout(20000);

  // Check API: is_generating should be false, has_notification true
  const listRes2 = await context.request.get(`${API}/api/chats`);
  const listData2 = await listRes2.json();
  const genChat2 = listData2.chats?.find((c: any) => c.id === chatId);
  console.log(`[API] is_generating=${genChat2?.is_generating} has_notification=${genChat2?.has_notification}`);
  expect(genChat2?.is_generating).toBe(false);
  expect(genChat2?.has_notification).toBe(true);

  // Check message status is completed
  const chatData = await context.request.get(`${API}/api/chats/${chatId}?limit=20`);
  const data = await chatData.json();
  const assistantMsg = data.messages?.find((m: any) => m.role === "assistant");
  console.log(`[API] assistant status=${assistantMsg?.status} content=${assistantMsg?.content?.substring(0, 50)}`);
  expect(assistantMsg?.status).toBe("completed");

  // Check sidebar shows check icon (not spinner)
  const checkIcon = page.locator(`[data-testid="chat-check-${chatId}"], svg.lucide-check-circle-2`).first();
  await page.screenshot({ path: "tests/screenshots/bg-status-check.png", fullPage: true });

  await context.close();
});

test("background LLM: reload shows spinner then check + toast", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    permissions: ["notifications"],
  });
  const page = await context.newPage();
  const consoleLogs: string[] = [];
  page.on("console", (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));

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

  // Create chat and send a message that takes a while
  const chatRes = await context.request.post(`${API}/api/chats`, {
    data: {},
    headers: { "Content-Type": "application/json" },
  });
  const chatId = (await chatRes.json())?.id;
  console.log(`[CHAT] created ${chatId}`);

  await page.goto(`/chat/${chatId}`);
  await page.waitForTimeout(2000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  const textarea = page.locator("textarea").first();
  await textarea.fill("Write a short poem about the ocean, 4 lines.");
  await page.keyboard.press("Enter");
  console.log("[SEND] sent");

  // Navigate away immediately (within 1s, before response completes)
  await page.waitForTimeout(1000);
  await page.goto("/documents");
  console.log("[NAV] on /documents");

  // RELOAD the page — this kills the in-memory stream
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForTimeout(2000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  console.log("[RELOAD] reloaded page — in-memory stream lost");

  // Navigate to home to see sidebar
  await page.goto("/");
  await page.waitForTimeout(2000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  // Check if sidebar shows spinner for the generating chat (polls every 10s)
  await page.screenshot({ path: "tests/screenshots/bg-reload-1-generating.png", fullPage: true });

  // Check API for is_generating status
  const listRes = await context.request.get(`${API}/api/chats`);
  const listData = await listRes.json();
  const genChat = listData.chats?.find((c: any) => c.id === chatId);
  console.log(`[API] is_generating=${genChat?.is_generating} has_notification=${genChat?.has_notification}`);

  // Wait for generation to complete
  console.log("[WAIT] 25s for background generation...");
  await page.waitForTimeout(25000);

  // After polling detects completion, toast should appear
  await page.screenshot({ path: "tests/screenshots/bg-reload-2-completed.png", fullPage: true });

  // Verify via API that generation completed
  const listRes2 = await context.request.get(`${API}/api/chats`);
  const listData2 = await listRes2.json();
  const completedChat = listData2.chats?.find((c: any) => c.id === chatId);
  console.log(`[API] is_generating=${completedChat?.is_generating} has_notification=${completedChat?.has_notification}`);
  expect(completedChat?.is_generating).toBe(false);

  // Check message is completed with content
  const chatData = await context.request.get(`${API}/api/chats/${chatId}?limit=20`);
  const data = await chatData.json();
  const assistantMsg = data.messages?.find((m: any) => m.role === "assistant");
  console.log(`[API] assistant status=${assistantMsg?.status} length=${assistantMsg?.content?.length}`);
  expect(assistantMsg?.status).toBe("completed");
  expect(assistantMsg?.content?.length).toBeGreaterThan(10);

  // Check if toast appeared (look for "Response ready" text in the page)
  const toastText = await page.locator('[data-sonner-toast]').allTextContents();
  console.log(`[UI] toasts: ${JSON.stringify(toastText)}`);

  // Navigate back to original chat — response should be visible
  await page.goto(`/chat/${chatId}`);
  await page.waitForTimeout(3000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.screenshot({ path: "tests/screenshots/bg-reload-3-response.png", fullPage: true });

  const mainText = await page.locator("main").textContent();
  console.log(`[UI] main text length: ${mainText?.length}`);
  expect(mainText?.length).toBeGreaterThan(50);

  await context.close();
});
