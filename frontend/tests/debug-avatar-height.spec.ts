import { test } from "@playwright/test";

test("debug: skeleton → sign-in height jump", async ({ page }) => {
  // Clear any auth state
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());

  // Reload to trigger fresh auth check
  await page.goto("/");

  // Capture the user menu area height over time
  const heights: { time: number; height: number; state: string }[] = [];
  const start = Date.now();

  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(100);

    // Find the bottom border-t section in the sidebar (user menu area)
    const userArea = page.locator("aside .border-t").last();
    const exists = await userArea.count() > 0;

    if (exists) {
      const box = await userArea.boundingBox();
      const html = await userArea.innerHTML();

      let state = "unknown";
      if (html.includes("animate-pulse")) state = "skeleton";
      else if (html.includes("Sign in")) state = "sign-in";
      else if (html.includes("rounded-full bg-primary")) state = "avatar";

      if (box) {
        heights.push({ time: Date.now() - start, height: Math.round(box.height), state });
      }
    }
  }

  // Log all captured heights
  console.log("\n[HEIGHT TIMELINE]");
  let prevHeight = 0;
  for (const h of heights) {
    const changed = h.height !== prevHeight ? " ← CHANGED" : "";
    console.log(`  ${h.time}ms: height=${h.height}px state=${h.state}${changed}`);
    prevHeight = h.height;
  }

  // Check for jumps
  const uniqueHeights = [...new Set(heights.map(h => h.height))];
  console.log(`\n[UNIQUE HEIGHTS]: ${uniqueHeights.join(", ")}px`);
  console.log(`[JUMP DETECTED]: ${uniqueHeights.length > 1 ? "YES" : "NO"}`);

  // Screenshot at the end
  await page.screenshot({ path: "tests/screenshots/avatar-height.png" });
});
