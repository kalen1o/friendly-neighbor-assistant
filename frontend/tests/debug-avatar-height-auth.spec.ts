import { test } from "@playwright/test";

test("debug: skeleton → avatar height jump (authenticated)", async ({ page }) => {
  // First login to get a session
  await page.goto("/");
  await page.waitForTimeout(500);

  // Check if already logged in
  const hasAvatar = await page.locator("aside .rounded-full.bg-primary").count();
  if (hasAvatar === 0) {
    // Need to login first
    const signInBtn = page.locator("aside").locator("text=Sign in");
    if (await signInBtn.count() > 0) {
      await signInBtn.click();
      await page.waitForTimeout(500);
      const emailInput = page.locator('input[type="email"]');
      if (await emailInput.count() > 0) {
        await emailInput.fill("test@test.com");
        await page.locator('input[type="password"]').first().fill("Test1234");
        await page.locator('form button[type="submit"]').click();
        await page.waitForTimeout(2000);
      }
    }
  }

  // Now reload to measure skeleton → avatar transition
  const heights: { time: number; height: number; state: string }[] = [];

  await page.goto("/");
  const start = Date.now();

  // Poll rapidly for 3 seconds
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(50);

    const userAreas = page.locator("aside .border-t").last();
    const exists = await userAreas.count() > 0;

    if (exists) {
      const box = await userAreas.boundingBox();
      const html = await userAreas.innerHTML();

      let state = "unknown";
      if (html.includes("animate-pulse")) state = "skeleton";
      else if (html.includes("Sign in") || html.includes("border-dashed")) state = "sign-in";
      else if (html.includes("bg-primary")) state = "avatar";

      if (box) {
        heights.push({ time: Date.now() - start, height: Math.round(box.height), state });
      }
    }
  }

  console.log("\n[HEIGHT TIMELINE]");
  let prevHeight = 0;
  let prevState = "";
  for (const h of heights) {
    if (h.height !== prevHeight || h.state !== prevState) {
      console.log(`  ${h.time}ms: height=${h.height}px state=${h.state} ← CHANGED`);
    }
    prevHeight = h.height;
    prevState = h.state;
  }

  const uniqueHeights = [...new Set(heights.map(h => h.height))];
  const states = [...new Set(heights.map(h => h.state))];
  console.log(`\n[UNIQUE HEIGHTS]: ${uniqueHeights.join(", ")}px`);
  console.log(`[STATES SEEN]: ${states.join(" → ")}`);
  console.log(`[JUMP DETECTED]: ${uniqueHeights.length > 1 ? "YES" : "NO"}`);
});
