import { test } from "@playwright/test";

const API = "http://localhost:8000";

test("debug: send message, navigate away, come back - chat not found error", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    permissions: ["notifications"],
  });
  const page = await context.newPage();

  // Login
  const loginRes = await context.request.post(`${API}/api/auth/login`, {
    data: { email: "ftest2@test.com", password: "Testpass123" },
  });
  console.log(`[LOGIN] ${loginRes.status()}`);

  await page.goto("/");
  await page.waitForTimeout(2000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  // Capture console errors
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(`PAGE: ${err.message}`));

  // Step 1: Create a chat
  const createRes = await context.request.post(`${API}/api/chats`, {
    data: {},
    headers: { "Content-Type": "application/json" },
  });
  const chatId = (await createRes.json())?.id;
  console.log(`[CHAT] created ${chatId}`);

  // Step 2: Go to the chat
  await page.goto(`/chat/${chatId}`);
  await page.waitForTimeout(2000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  // Step 3: Send a long message (will take time to respond)
  const textarea = page.locator("textarea").first();
  await textarea.fill("latest AC Milan match, results and scorers");
  await page.keyboard.press("Enter");
  console.log("[SEND] Message sent");

  // Step 4: Wait a bit for streaming to start
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "tests/screenshots/chat-nav-1-streaming.png", fullPage: true });

  // Step 5: Create another chat and navigate to it
  const createRes2 = await context.request.post(`${API}/api/chats`, {
    data: {},
    headers: { "Content-Type": "application/json" },
  });
  const chatId2 = (await createRes2.json())?.id;
  console.log(`[CHAT2] created ${chatId2}`);

  await page.goto(`/chat/${chatId2}`);
  await page.waitForTimeout(2000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  console.log(`[NAV] Now on chat2: ${page.url()}`);

  // Step 6: Wait for the first chat's response to complete
  await page.waitForTimeout(10000);

  // Step 7: Try navigating back to the first chat
  console.log(`[NAV] Going back to chat1: /chat/${chatId}`);
  await page.goto(`/chat/${chatId}`);
  await page.waitForTimeout(3000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.screenshot({ path: "tests/screenshots/chat-nav-2-back.png", fullPage: true });

  // Check for errors
  console.log(`[ERRORS] count=${errors.length}`);
  for (const e of errors.slice(-10)) {
    console.log(`[ERROR] ${e.substring(0, 200)}`);
  }

  // Check if chat loaded
  const pageText = await page.locator("main").textContent();
  const hasError = pageText?.includes("not found") || pageText?.includes("error");
  console.log(`[PAGE] has error text=${hasError}`);
  console.log(`[PAGE] url=${page.url()}`);

  // Check API directly - can we fetch this chat?
  const chatRes = await context.request.get(`${API}/api/chats/${chatId}?limit=20`);
  console.log(`[API] GET chat status=${chatRes.status()}`);
  if (chatRes.status() !== 200) {
    const body = await chatRes.text();
    console.log(`[API] error body=${body.substring(0, 200)}`);
  } else {
    const data = await chatRes.json();
    console.log(`[API] chat title="${data.title}" messages=${data.messages?.length}`);
  }

  // Also try clicking the chat in the sidebar
  await page.goto("/");
  await page.waitForTimeout(2000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  // Find the chat in sidebar by looking for its title or "New Chat"
  const sidebarChats = page.locator("aside [class*='cursor-pointer']");
  const chatCount = await sidebarChats.count();
  console.log(`[SIDEBAR] chat count=${chatCount}`);

  if (chatCount > 0) {
    // Click the first chat
    await sidebarChats.first().click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: "tests/screenshots/chat-nav-3-sidebar-click.png", fullPage: true });
    console.log(`[SIDEBAR CLICK] url=${page.url()}`);

    // Check for errors after sidebar click
    const errorsAfter = errors.slice(-5);
    for (const e of errorsAfter) {
      console.log(`[SIDEBAR ERROR] ${e.substring(0, 200)}`);
    }
  }

  await context.close();
});
