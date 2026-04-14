/* eslint-disable @typescript-eslint/no-unused-vars */
import { test } from "@playwright/test";

test("debug: forced loading/sign-in/avatar height comparison", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(1000);

  // Measure each state by injecting styles/content directly
  const sidebar = page.locator("aside").first();

  // Get current state height
  const userArea = page.locator("aside .border-t").last();
  const currentBox = await userArea.boundingBox();
  const currentHTML = await userArea.innerHTML();
  let currentState = "unknown";
  if (currentHTML.includes("animate-pulse")) currentState = "skeleton";
  else if (currentHTML.includes("Sign in")) currentState = "sign-in";
  else if (currentHTML.includes("bg-primary")) currentState = "avatar";

  console.log(`[CURRENT] state=${currentState} height=${currentBox?.height}px`);

  // Now simulate all 3 states by replacing the content and measuring
  // State 1: Skeleton
  await page.evaluate(() => {
    const area = document.querySelector("aside .border-t:last-child") as HTMLElement;
    if (area) {
      area.innerHTML = `
        <div class="flex items-center gap-2.5 p-3">
          <div class="h-8 w-8 shrink-0 animate-pulse rounded-full bg-gray-200"></div>
          <div class="flex-1 space-y-1.5">
            <div class="h-3.5 w-20 animate-pulse rounded bg-gray-200"></div>
            <div class="h-3 w-28 animate-pulse rounded bg-gray-200"></div>
          </div>
        </div>
      `;
    }
  });
  const skeletonBox = await userArea.boundingBox();
  console.log(`[SKELETON] height=${skeletonBox?.height}px`);

  // State 2: Sign in
  await page.evaluate(() => {
    const area = document.querySelector("aside .border-t:last-child") as HTMLElement;
    if (area) {
      area.innerHTML = `
        <button class="flex w-full items-center gap-2.5 p-3 text-left">
          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-dashed text-xs">?</div>
          <span class="text-sm">Sign in</span>
        </button>
      `;
    }
  });
  const signInBox = await userArea.boundingBox();
  console.log(`[SIGN-IN] height=${signInBox?.height}px`);

  // State 3: Avatar
  await page.evaluate(() => {
    const area = document.querySelector("aside .border-t:last-child") as HTMLElement;
    if (area) {
      area.innerHTML = `
        <button class="flex w-full items-center gap-2.5 p-3 text-left">
          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-600 text-sm font-semibold text-white">K</div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">Kalen</p>
            <p class="truncate text-xs text-gray-500">kalen@example.com</p>
          </div>
          <span class="h-4 w-4">▲</span>
        </button>
      `;
    }
  });
  const avatarBox = await userArea.boundingBox();
  console.log(`[AVATAR] height=${avatarBox?.height}px`);

  // Summary
  const heights = [skeletonBox?.height, signInBox?.height, avatarBox?.height];
  const allSame = heights.every(h => h === heights[0]);
  console.log(`\n[SUMMARY] skeleton=${skeletonBox?.height} sign-in=${signInBox?.height} avatar=${avatarBox?.height}`);
  console.log(`[ALL SAME HEIGHT]: ${allSame ? "YES ✓" : "NO ✗ — JUMP DETECTED"}`);
});
