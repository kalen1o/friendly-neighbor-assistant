import { test, expect } from "@playwright/test";
import { execSync } from "child_process";

test("screenshot workflow progress UI", async ({ page, context }) => {
  const token = execSync(
    `docker compose exec -T backend python -c "from app.auth.jwt import create_access_token; from app.config import get_settings; print(create_access_token('user-dfd0b777', get_settings()))"`,
    { encoding: "utf-8", cwd: "/Users/kalen_1o/startup/friendly-neighbor-assistant" }
  ).trim();

  await context.addCookies([
    { name: "access_token", value: token, domain: "localhost", path: "/" },
  ]);

  await page.goto("http://localhost:3000");
  await page.waitForTimeout(2000);

  // Create new chat and send workflow-triggering message
  const textarea = page.locator("textarea").first();
  await expect(textarea).toBeVisible({ timeout: 5000 });
  await textarea.fill("Research the latest AI development trends and predictions for 2025-2026");
  await textarea.press("Enter");

  // Wait for workflow steps to appear (poll for the workflow UI)
  let _foundWorkflow = false;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(2000);
    const workflowEl = page.locator("text=Workflow").first();
    if (await workflowEl.isVisible().catch(() => false)) {
      _foundWorkflow = true;
      await page.screenshot({ path: "tests/screenshots/workflow-running.png" });
      break;
    }
    // Also check if response already came
    const doneEl = page.locator("text=sources").first();
    if (await doneEl.isVisible().catch(() => false)) {
      await page.screenshot({ path: "tests/screenshots/workflow-done.png" });
      break;
    }
  }

  // Wait for response to finish
  await expect(textarea).toBeEnabled({ timeout: 300_000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "tests/screenshots/workflow-final.png" });
});
