import { test } from "@playwright/test";

test("debug: mobile and desktop sidebar layout", async ({ page }) => {
  // Desktop view
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "tests/screenshots/sidebar-desktop.png", fullPage: true });

  // Check desktop sidebar
  const desktopSidebar = page.locator("aside");
  const desktopSidebarCount = await desktopSidebar.count();
  const desktopSidebarVisible = desktopSidebarCount > 0 ? await desktopSidebar.first().isVisible() : false;
  console.log(`[DESKTOP] sidebar count=${desktopSidebarCount} visible=${desktopSidebarVisible}`);

  if (desktopSidebarVisible) {
    const box = await desktopSidebar.first().boundingBox();
    console.log(`[DESKTOP] sidebar width=${box?.width} height=${box?.height}`);
  }

  // Mobile view
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "tests/screenshots/sidebar-mobile-closed.png", fullPage: true });

  // Check what's visible on mobile
  const mobileHeader = page.locator(".md\\:hidden");
  const mobileHeaderCount = await mobileHeader.count();
  console.log(`[MOBILE] header elements: ${mobileHeaderCount}`);

  // Check for hamburger/menu button
  const menuBtns = page.locator("button").filter({ has: page.locator('svg') });
  const allBtnTexts: string[] = [];
  const btnCount = await menuBtns.count();
  for (let i = 0; i < Math.min(btnCount, 10); i++) {
    const text = await menuBtns.nth(i).textContent();
    const visible = await menuBtns.nth(i).isVisible();
    if (visible) allBtnTexts.push(text?.trim() || `[btn ${i}]`);
  }
  console.log(`[MOBILE] visible buttons: ${allBtnTexts.join(", ")}`);

  // Check for MobileSidebar component
  const mobileSidebar = page.locator('[data-slot="dialog"]');
  console.log(`[MOBILE] drawer dialogs: ${await mobileSidebar.count()}`);

  // Try clicking the hamburger/menu
  const hamburger = page.locator(".md\\:hidden button").first();
  if (await hamburger.isVisible()) {
    console.log("[MOBILE] clicking hamburger");
    await hamburger.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: "tests/screenshots/sidebar-mobile-open.png", fullPage: true });

    const drawer = page.locator('[data-slot="dialog"]');
    console.log(`[MOBILE] drawer visible: ${await drawer.count()}`);
  }

  // Check current layout structure
  const layoutHTML = await page.locator("body > div").first().evaluate((el) => {
    const children = Array.from(el.children).map(c => ({
      tag: c.tagName,
      classes: c.className.split(" ").slice(0, 5).join(" "),
      visible: (c as HTMLElement).offsetWidth > 0,
    }));
    return children;
  });
  console.log("[LAYOUT]", JSON.stringify(layoutHTML, null, 2));

  // Tablet view
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "tests/screenshots/sidebar-tablet.png", fullPage: true });
});
