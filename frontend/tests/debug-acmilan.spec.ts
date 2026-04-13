import { test } from "@playwright/test";

const API = "http://localhost:8000";

test("reproduce: send long query, switch chat, reload, go back", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  // Capture ALL console output
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(`[BROWSER ERROR] ${msg.text().substring(0, 300)}`);
  });
  page.on("pageerror", (err) => console.log(`[PAGE ERROR] ${err.message.substring(0, 300)}`));

  // Login
  await context.request.post(`${API}/api/auth/login`, {
    data: { email: "ftest2@test.com", password: "Testpass123" },
  });

  await page.goto("/");
  await page.waitForTimeout(2000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  // Step 1: Create chat A
  const chatARes = await context.request.post(`${API}/api/chats`, {
    data: {},
    headers: { "Content-Type": "application/json" },
  });
  const chatA = (await chatARes.json())?.id;
  console.log(`[STEP 1] Created chat A: ${chatA}`);

  // Step 2: Go to chat A and send the AC Milan query
  await page.goto(`/chat/${chatA}`);
  await page.waitForTimeout(2000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  const textarea = page.locator("textarea").first();
  await textarea.fill("latest AC Milan match, results and scorers");
  await page.keyboard.press("Enter");
  console.log("[STEP 2] Sent AC Milan query");

  // Step 3: Wait for streaming to start — web search needs 10-15s
  await page.waitForTimeout(12000);
  await page.screenshot({ path: "tests/screenshots/acmilan-1-streaming.png", fullPage: true });

  // Step 4: Create chat B and navigate to it
  const chatBRes = await context.request.post(`${API}/api/chats`, {
    data: {},
    headers: { "Content-Type": "application/json" },
  });
  const chatB = (await chatBRes.json())?.id;
  console.log(`[STEP 4] Created chat B: ${chatB}, navigating to it`);

  await page.goto(`/chat/${chatB}`);
  await page.waitForTimeout(2000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  console.log(`[STEP 4] Now on chat B: ${page.url()}`);

  // Step 5: RELOAD the page (this is key to reproducing)
  console.log("[STEP 5] Reloading page...");
  await page.reload();
  await page.waitForTimeout(3000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  console.log(`[STEP 5] After reload: ${page.url()}`);

  // Step 6: Navigate back to chat A
  console.log(`[STEP 6] Going back to chat A: /chat/${chatA}`);
  await page.goto(`/chat/${chatA}`);
  await page.waitForTimeout(5000);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  // Check results
  await page.screenshot({ path: "tests/screenshots/acmilan-2-back.png", fullPage: true });
  console.log(`[RESULT] URL: ${page.url()}`);

  // Check if redirected to home
  const isHome = page.url() === "http://localhost:3000/" || !page.url().includes("/chat/");
  console.log(`[RESULT] Redirected to home: ${isHome}`);

  // Check API directly
  const apiRes = await context.request.get(`${API}/api/chats/${chatA}?limit=20`);
  console.log(`[API] status=${apiRes.status()}`);
  if (apiRes.ok()) {
    const data = await apiRes.json();
    console.log(`[API] messages=${data.messages?.length} title="${data.title}"`);
    for (const m of data.messages || []) {
      console.log(`[API]   ${m.role}: ${m.content?.substring(0, 80)}...`);
    }
  } else {
    const body = await apiRes.text();
    console.log(`[API] error: ${body.substring(0, 200)}`);
  }

  // Check backend error logs
  // (we can't do this from playwright, but we'll check docker logs separately)

  await context.close();
});
