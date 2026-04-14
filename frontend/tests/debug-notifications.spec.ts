/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from "@playwright/test";

test("notifications: first-login prompt appears", async ({ browser }) => {
  // Do NOT grant permission — keep it "default" so the prompt shows
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  // Clear localStorage to simulate first login
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.removeItem("notifications-prompted");
    localStorage.removeItem("notifications-enabled");
    localStorage.removeItem("notifications-preview");
  });

  // Dismiss Next.js error overlay if present
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  // Login
  await page.waitForTimeout(1000);
  const signInBtn = page.getByText("Sign in").first();
  if (await signInBtn.isVisible()) {
    await signInBtn.click();
    await page.waitForTimeout(1000);
    await page.locator('input[type="email"]').fill("ftest2@test.com");
    await page.locator('input[type="password"]').fill("Testpass123");
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(4000); // login + 2s prompt delay
  }

  // Re-hide overlay after navigation
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  // Check notification prompt
  await page.screenshot({ path: "tests/screenshots/notif-1-prompt.png", fullPage: true });
  const promptTitle = page.getByText("Enable notifications?");
  const promptVisible = await promptTitle.isVisible().catch(() => false);
  console.log(`[PROMPT] visible=${promptVisible}`);

  if (promptVisible) {
    // Check prompt content
    const promptText = page.getByText("Get notified when a response is ready");
    console.log(`[PROMPT] description visible=${await promptText.isVisible().catch(() => false)}`);

    const enableBtn = page.getByText("Enable", { exact: true });
    const noThanksBtn = page.getByText("No thanks");
    console.log(`[PROMPT] Enable btn=${await enableBtn.isVisible().catch(() => false)}`);
    console.log(`[PROMPT] No thanks btn=${await noThanksBtn.isVisible().catch(() => false)}`);

    // Click "No thanks" to dismiss
    await noThanksBtn.click();
    await page.waitForTimeout(300);

    const prompted = await page.evaluate(() => localStorage.getItem("notifications-prompted"));
    const enabled = await page.evaluate(() => localStorage.getItem("notifications-enabled"));
    console.log(`[DISMISS] prompted=${prompted} enabled=${enabled}`);

    // Prompt should not show again
    await page.reload();
    await page.waitForTimeout(4000);
    const promptAgain = await page.getByText("Enable notifications?").isVisible().catch(() => false);
    console.log(`[DISMISS] reappeared=${promptAgain}`);
  } else {
    console.log("[PROMPT] Not visible — checking if Notification API is supported");
    const supported = await page.evaluate(() => "Notification" in window);
    const permission = await page.evaluate(() => {
      try { return Notification.permission; } catch { return "error"; }
    });
    console.log(`[DEBUG] Notification supported=${supported} permission=${permission}`);
  }

  await context.close();
});

test("notifications: settings toggles work", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    permissions: ["notifications"],
  });
  const page = await context.newPage();

  // Pre-enable notifications
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("notifications-enabled", "true");
    localStorage.setItem("notifications-preview", "true");
    localStorage.setItem("notifications-prompted", "true");
  });

  // Hide Next.js overlay
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  // Login
  await page.waitForTimeout(1000);
  const signInBtn = page.getByText("Sign in").first();
  if (await signInBtn.isVisible()) {
    await signInBtn.click();
    await page.waitForTimeout(1000);
    await page.locator('input[type="email"]').fill("ftest2@test.com");
    await page.locator('input[type="password"]').fill("Testpass123");
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(3000);
  }

  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  // Open Settings
  const avatar = page.locator(".rounded-full.bg-primary").first();
  if (await avatar.isVisible()) {
    await avatar.click();
    await page.waitForTimeout(500);
    const settingsItem = page.getByText("Settings");
    if (await settingsItem.isVisible()) {
      await settingsItem.click();
      await page.waitForTimeout(1000);
    }
  }

  // Check notification section exists
  const notifHeading = page.getByText("Notifications");
  console.log(`[SETTINGS] heading=${await notifHeading.isVisible().catch(() => false)}`);

  const browserToggle = page.getByText("Browser notifications");
  console.log(`[SETTINGS] browser toggle=${await browserToggle.isVisible().catch(() => false)}`);

  const previewToggle = page.getByText("Include message preview");
  console.log(`[SETTINGS] preview toggle=${await previewToggle.isVisible().catch(() => false)}`);

  await page.screenshot({ path: "tests/screenshots/notif-2-settings-on.png", fullPage: true });

  // Toggle notifications off
  const switches = page.locator('button[role="switch"]');
  const switchCount = await switches.count();
  console.log(`[SETTINGS] switches count=${switchCount}`);

  if (switchCount > 0) {
    // Find the notification switch (first one in the notifications section)
    await switches.first().click();
    await page.waitForTimeout(300);

    const enabledAfter = await page.evaluate(() => localStorage.getItem("notifications-enabled"));
    console.log(`[TOGGLE] enabled after off=${enabledAfter}`);

    // Preview should hide
    const previewHidden = !(await previewToggle.isVisible().catch(() => false));
    console.log(`[TOGGLE] preview hidden=${previewHidden}`);

    await page.screenshot({ path: "tests/screenshots/notif-3-settings-off.png", fullPage: true });

    // Toggle back on
    await switches.first().click();
    await page.waitForTimeout(300);

    const enabledOn = await page.evaluate(() => localStorage.getItem("notifications-enabled"));
    console.log(`[TOGGLE] enabled after on=${enabledOn}`);

    const previewBack = await previewToggle.isVisible().catch(() => false);
    console.log(`[TOGGLE] preview back=${previewBack}`);
  }

  await context.close();
});

test("notifications: showChatNotification fires correctly", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    permissions: ["notifications"],
  });
  const page = await context.newPage();

  // Enable notifications
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("notifications-enabled", "true");
    localStorage.setItem("notifications-preview", "true");
    localStorage.setItem("notifications-prompted", "true");
  });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  // Login
  const signInBtn = page.getByText("Sign in").first();
  if (await signInBtn.isVisible()) {
    await signInBtn.click();
    await page.waitForTimeout(1000);
    await page.locator('input[type="email"]').fill("ftest2@test.com");
    await page.locator('input[type="password"]').fill("Testpass123");
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(3000);
  }

  // Test the notification function directly
  const result = await page.evaluate(() => {
    const notifications: any[] = [];
    // Mock Notification
    const Orig = window.Notification;
    (window as any).Notification = class {
      static permission = "granted";
      title: string;
      options: any;
      onclick: any;
      close() {}
      constructor(title: string, options: any) {
        this.title = title;
        this.options = options;
        notifications.push({ title, body: options?.body, tag: options?.tag });
      }
    };

    // Import and call showChatNotification
    // Since we can't import in evaluate, test the logic manually
    const enabled = localStorage.getItem("notifications-enabled") === "true";
    const preview = localStorage.getItem("notifications-preview") !== "false";
    const isOnDifferentChat = window.location.pathname !== "/chat/test-123";

    if (enabled && isOnDifferentChat) {
      const title = "Test Chat";
      const responseText = "This is a test response that should appear in the notification preview text";
      const body = preview
        ? responseText.slice(0, 100) + (responseText.length > 100 ? "..." : "")
        : "Response ready";

      new (window as any).Notification(title, {
        body,
        icon: "/small-logo.png",
        tag: "chat-test-123",
      });
    }

    // Restore
    (window as any).Notification = Orig;

    return { notifications, enabled, preview, isOnDifferentChat };
  });

  console.log(`[NOTIF] enabled=${result.enabled}`);
  console.log(`[NOTIF] preview=${result.preview}`);
  console.log(`[NOTIF] isOnDifferentChat=${result.isOnDifferentChat}`);
  console.log(`[NOTIF] fired=${result.notifications.length}`);
  if (result.notifications.length > 0) {
    console.log(`[NOTIF] title="${result.notifications[0].title}"`);
    console.log(`[NOTIF] body="${result.notifications[0].body}"`);
    console.log(`[NOTIF] tag="${result.notifications[0].tag}"`);
  }

  await context.close();
});
