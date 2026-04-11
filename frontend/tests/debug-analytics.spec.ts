import { test } from "@playwright/test";

test("debug: analytics recharts", async ({ page }) => {
  // Login
  try {
    await page.request.post("http://localhost:8000/api/auth/login", {
      data: { email: "testuser@example.com", password: "TestPass1234" },
    });
  } catch {
    console.log("Backend not reachable, trying page directly");
  }

  await page.goto("http://localhost:3000/analytics", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  // Check for recharts SVG elements
  const svgs = page.locator("svg.recharts-surface");
  console.log("Recharts SVGs:", await svgs.count());

  const bars = page.locator("rect.recharts-bar-rectangle");
  console.log("Recharts bar rects:", await bars.count());

  // Check for any error overlay
  const errorOverlay = page.locator('[id="__next-build-error"]');
  console.log("Build error overlay:", await errorOverlay.count());

  await page.screenshot({ path: "tests/screenshots/analytics-recharts.png", fullPage: true });
});
