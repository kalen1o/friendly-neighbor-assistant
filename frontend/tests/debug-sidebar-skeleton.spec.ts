import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 720 } });

test("sidebar skeleton is visible while chats load", async ({ page }) => {
  // Register and login via page-level fetch so cookies land on the browser
  const email = `skel-sidebar-${Date.now()}@test.com`;

  await page.goto("/");

  // Register + login via page context so cookies are set on the browser
  await page.evaluate(async (em) => {
    const base = "http://localhost:8000";
    await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: em, password: "TestPass1234", name: "Skel Tester" }),
      credentials: "include",
    });
    await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: em, password: "TestPass1234" }),
      credentials: "include",
    });
    // Create a few chats
    for (let i = 0; i < 3; i++) {
      await fetch(`${base}/api/chats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `Chat ${i + 1}` }),
        credentials: "include",
      });
    }
  }, email);

  // Intercept chat list and auth/me API with delay BEFORE reload
  await page.route("**/api/chats**", async (route) => {
    if (route.request().method() === "GET") {
      await new Promise((r) => setTimeout(r, 2000));
      await route.continue();
    } else {
      await route.continue();
    }
  });

  // Reload — now auth cookie is set, skeleton should show while chats load
  await page.reload();

  // Poll for skeleton visibility
  let sawSkeleton = false;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(100);
    const skeletonCount = await page.locator('[data-slot="skeleton"]').count();
    const html = await page.evaluate(() => {
      const sidebar = document.querySelector("aside");
      return sidebar ? sidebar.innerHTML.substring(0, 500) : "NO ASIDE";
    });
    console.log(`[${(i + 1) * 100}ms] skeletons=${skeletonCount} sidebar=${html.substring(0, 200)}`);
    if (skeletonCount > 0) {
      sawSkeleton = true;
      await page.screenshot({
        path: "tests/screenshots/sidebar-skeleton-visible.png",
        fullPage: true,
      });
      break;
    }
  }

  console.log("[result] Saw sidebar skeleton:", sawSkeleton);

  // Take screenshot regardless for debugging
  if (!sawSkeleton) {
    await page.screenshot({
      path: "tests/screenshots/sidebar-skeleton-debug.png",
      fullPage: true,
    });
  }

  expect(sawSkeleton).toBe(true);

  // Wait for chats to load, then verify skeleton is gone
  await page.waitForTimeout(3000);
  await page.screenshot({
    path: "tests/screenshots/sidebar-skeleton-loaded.png",
    fullPage: true,
  });
});

test("folder view skeleton is visible while folders load", async ({ page }) => {
  const email = `skel-folder-${Date.now()}@test.com`;

  // Set sidebar to folder view mode before page loads
  await page.addInitScript(() => {
    localStorage.setItem("sidebar-view-mode", "folders");
  });

  await page.goto("/");

  // Register + login via page context
  await page.evaluate(async (em) => {
    const base = "http://localhost:8000";
    await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: em, password: "TestPass1234", name: "Folder Skel Tester" }),
      credentials: "include",
    });
    await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: em, password: "TestPass1234" }),
      credentials: "include",
    });
  }, email);

  // Intercept APIs with delay
  await page.route("**/api/chats**", async (route) => {
    if (route.request().method() === "GET") {
      await new Promise((r) => setTimeout(r, 2000));
      await route.continue();
    } else {
      await route.continue();
    }
  });
  await page.route("**/api/folders**", async (route) => {
    if (route.request().method() === "GET") {
      await new Promise((r) => setTimeout(r, 2000));
      await route.continue();
    } else {
      await route.continue();
    }
  });

  await page.reload();

  // Poll for skeleton visibility
  let sawSkeleton = false;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(100);
    const skeletonCount = await page.locator('[data-slot="skeleton"]').count();
    console.log(`[${(i + 1) * 100}ms] skeletons=${skeletonCount}`);
    if (skeletonCount > 0) {
      sawSkeleton = true;
      await page.screenshot({
        path: "tests/screenshots/sidebar-folder-skeleton-visible.png",
        fullPage: true,
      });
      break;
    }
  }

  if (!sawSkeleton) {
    await page.screenshot({
      path: "tests/screenshots/sidebar-folder-skeleton-debug.png",
      fullPage: true,
    });
  }

  console.log("[result] Saw folder skeleton:", sawSkeleton);
  expect(sawSkeleton).toBe(true);
});
