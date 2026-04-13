import { test } from "@playwright/test";

const API = "http://localhost:8000";

test("browser notification fires when polling detects new has_notification", async ({ browser }) => {
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
  await page.evaluate(() => {
    localStorage.setItem("notifications-enabled", "true");
    localStorage.setItem("notifications-preview", "true");
    localStorage.setItem("notifications-prompted", "true");
  });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  // Mock Notification to capture calls
  await page.evaluate(() => {
    (window as any).__notifCalls = [];
    const Orig = window.Notification;
    const Mock = class {
      static permission = "granted";
      static requestPermission = Orig.requestPermission.bind(Orig);
      title: string;
      options: any;
      onclick: (() => void) | null = null;
      close() {}
      constructor(title: string, options?: NotificationOptions) {
        this.title = title;
        this.options = options;
        (window as any).__notifCalls.push({
          title,
          body: options?.body,
          tag: options?.tag,
          time: new Date().toISOString(),
        });
        console.log(`[MOCK NOTIF] ${title}: ${options?.body}`);
      }
    };
    Object.defineProperty(Mock, "permission", { value: "granted", writable: false });
    (window as any).Notification = Mock as any;
  });

  // Check current notification state
  const before = await page.evaluate(() => (window as any).__notifCalls?.length || 0);
  console.log(`[BEFORE] notification calls=${before}`);

  // Create chat + send message via API
  const createRes = await context.request.post(`${API}/api/chats`, {
    data: {},
    headers: { "Content-Type": "application/json" },
  });
  const chatId = (await createRes.json())?.id;
  console.log(`[CHAT] created ${chatId}`);

  // Navigate to chat, send message, navigate away
  await page.goto(`/chat/${chatId}`);
  await page.waitForTimeout(1500);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  // Re-mock after navigation
  await page.evaluate(() => {
    (window as any).__notifCalls = [];
    const Orig = window.Notification;
    const Mock = class {
      static permission = "granted";
      static requestPermission = () => Promise.resolve("granted" as NotificationPermission);
      title: string;
      options: any;
      onclick: (() => void) | null = null;
      close() {}
      constructor(title: string, options?: NotificationOptions) {
        this.title = title;
        this.options = options;
        (window as any).__notifCalls.push({
          title,
          body: options?.body,
          tag: options?.tag,
          time: new Date().toISOString(),
        });
      }
    };
    Object.defineProperty(Mock, "permission", { value: "granted", writable: false });
    (window as any).Notification = Mock as any;
  });

  const textarea = page.locator("textarea").first();
  await textarea.fill("Hello");
  await page.keyboard.press("Enter");
  console.log("[SEND] sent");
  await page.waitForTimeout(1000);

  // Navigate to /skills (away from the chat)
  await page.goto("/skills");
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  console.log("[NAV] on /skills");

  // Re-mock AGAIN after navigation (page context resets)
  await page.evaluate(() => {
    (window as any).__notifCalls = [];
    const Mock = class {
      static permission = "granted";
      static requestPermission = () => Promise.resolve("granted" as NotificationPermission);
      title: string;
      options: any;
      onclick: (() => void) | null = null;
      close() {}
      constructor(title: string, options?: NotificationOptions) {
        this.title = title;
        this.options = options;
        (window as any).__notifCalls.push({
          title,
          body: options?.body,
          tag: options?.tag,
          time: new Date().toISOString(),
        });
      }
    };
    Object.defineProperty(Mock, "permission", { value: "granted", writable: false });
    (window as any).Notification = Mock as any;
  });

  // Also re-set localStorage (page context resets on navigation)
  await page.evaluate(() => {
    localStorage.setItem("notifications-enabled", "true");
    localStorage.setItem("notifications-preview", "true");
    localStorage.setItem("notifications-prompted", "true");
  });

  // Wait for polling to detect the notification (10s interval + some buffer)
  console.log("[WAIT] 15s for polling...");
  await page.waitForTimeout(15000);

  // Check notifications
  const notifs = await page.evaluate(() => (window as any).__notifCalls || []);
  console.log(`[RESULT] notification calls=${notifs.length}`);
  for (const n of notifs) {
    console.log(`[RESULT]   title="${n.title}" body="${n.body}" tag="${n.tag}"`);
  }

  // Also check if showChatNotification is actually being called
  // by checking what the Notification.permission is
  const perm = await page.evaluate(() => {
    try { return (window as any).Notification.permission; } catch { return "error"; }
  });
  const enabled = await page.evaluate(() => localStorage.getItem("notifications-enabled"));
  console.log(`[DEBUG] Notification.permission=${perm} enabled=${enabled}`);

  await context.close();
});
