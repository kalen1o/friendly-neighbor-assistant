import { test, expect } from "@playwright/test";

test("debug: artifact page errors", async ({ page }) => {
  // Collect all console messages including from iframes
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => {
    errors.push(`PAGE ERROR: ${err.message}`);
  });

  await page.goto("http://localhost:3000/chat/chat-fd406bf4", {
    waitUntil: "networkidle",
  });

  // Wait a bit for any deferred errors
  await page.waitForTimeout(3000);

  // Check for artifact panel
  const artifactPanel = page.locator('[class*="artifact"]');
  console.log("Artifact panel found:", await artifactPanel.count());

  // Check for iframes
  const iframes = page.frames();
  console.log("Frames count:", iframes.length);

  for (const frame of iframes) {
    if (frame === page.mainFrame()) continue;
    console.log("Frame URL:", frame.url());
    try {
      const content = await frame.content();
      console.log("Frame content (first 500 chars):", content.substring(0, 500));
    } catch (e) {
      console.log("Cannot read frame content:", e);
    }
  }

  // Take screenshot
  await page.screenshot({ path: "tests/screenshots/artifact-debug.png", fullPage: true });

  // Print collected errors
  console.log("Collected errors:", JSON.stringify(errors, null, 2));
});
