import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

const SHOT_DIR = path.resolve(__dirname, "../../docs/screenshots");
const DEMO_NAME = "Demo User";
const DEMO_EMAIL = `demo+${Date.now()}@friendlyneighbor.local`;
const DEMO_PASSWORD = "Demopass123!";

async function shot(page: Page, name: string) {
  await page.waitForTimeout(600);
  await page.screenshot({
    path: path.join(SHOT_DIR, `${name}.png`),
    fullPage: false,
  });
  console.log(`  ✓ ${name}.png`);
}

test.describe("README screenshots", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("capture all key screens", async ({ page }) => {
    test.setTimeout(180_000);

    // Clear any leftover auth from previous runs
    await page.context().clearCookies();

    // ---- 1. Register page
    await page.goto("/register");
    await page.waitForLoadState("networkidle");
    await shot(page, "01-register");

    // Register a new user
    await page.getByLabel("Name").fill(DEMO_NAME);
    await page.getByLabel("Email").fill(DEMO_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(DEMO_PASSWORD);
    await page.getByLabel("Confirm Password").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: /create account/i }).click();

    // Wait for redirect to home
    await page.waitForURL("/", { timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    // Reload so auth state picks up the new cookie cleanly
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);

    // ---- 2. Landing / empty chat
    await shot(page, "02-landing");

    // ---- 3. Send a chat message (real LLM)
    const textarea = page.getByPlaceholder("Type a message...");
    await textarea.fill("Hello! Tell me what you can do in a short paragraph.");
    await textarea.press("Enter");

    // Wait for navigation to /chat/<id>
    await page.waitForURL(/\/chat\/.+/, { timeout: 15_000 });
    // Wait for streaming to finish. Heuristic: input enabled again & no .animate-pulse
    await page.waitForTimeout(2000);
    // Wait up to 60s for response to finish
    for (let i = 0; i < 60; i++) {
      const busy = await page.locator('[data-state="streaming"], .animate-pulse').count();
      const sendEnabled = await page.getByPlaceholder("Type a message...").isEditable();
      if (busy === 0 && sendEnabled) break;
      await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(1500);
    await shot(page, "03-chat-with-response");

    // ---- 4. Chat with sidebar (desktop layout already shows sidebar)
    // Take a shot at a wider viewport to show sidebar clearly
    await shot(page, "04-chat-sidebar");

    // ---- 4b. Artifact (split panel with rendered React)
    // Go back to home to start a fresh chat dedicated to the artifact
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const ta2 = page.getByPlaceholder("Type a message...");
    await ta2.fill(
      "Create a simple React counter component as an artifact. It should have a button that increments a number. Use Tailwind. Keep it under 30 lines."
    );
    await ta2.press("Enter");
    await page.waitForURL(/\/chat\/.+/, { timeout: 15_000 });

    // Wait for the artifact panel to appear, streaming to finish,
    // and the Sandpack preview to finish compiling.
    for (let i = 0; i < 120; i++) {
      const generating = await page.getByText(/Generating/i).count();
      const sendEnabled = await page
        .getByPlaceholder("Type a message...")
        .isEditable();
      if (generating === 0 && sendEnabled) break;
      await page.waitForTimeout(1000);
    }
    // Extra buffer for the Sandpack iframe to paint
    await page.waitForTimeout(6000);
    await shot(page, "11-artifact");

    // ---- 5. Skills page
    await page.goto("/skills");
    await page.waitForLoadState("networkidle");
    await shot(page, "05-skills");

    // ---- 6. Documents / Knowledge base
    await page.goto("/documents");
    await page.waitForLoadState("networkidle");
    await shot(page, "06-knowledge-base");

    // ---- 7. Analytics
    await page.goto("/analytics");
    await page.waitForLoadState("networkidle");
    await shot(page, "07-analytics");

    // ---- 8. MCP page
    await page.goto("/mcp");
    await page.waitForLoadState("networkidle");
    await shot(page, "08-mcp");

    // ---- 9. Schedules
    await page.goto("/schedules");
    await page.waitForLoadState("networkidle");
    await shot(page, "09-schedules");

    // ---- 10. Login page (log out first)
    // Clear auth cookies to see login page
    await page.context().clearCookies();
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await shot(page, "10-login");

    console.log(`\nSaved screenshots to ${SHOT_DIR}`);
    console.log(`Demo account: ${DEMO_EMAIL}`);
  });
});
