import { test } from "@playwright/test";
import { execSync } from "child_process";

test("screenshot citation badges closeup", async ({ page, context }) => {
  const token = execSync(
    `docker compose exec -T backend python -c "from app.auth.jwt import create_access_token; from app.config import get_settings; print(create_access_token('user-dfd0b777', get_settings()))"`,
    { encoding: "utf-8", cwd: "/Users/kalen_1o/startup/friendly-neighbor-assistant" }
  ).trim();

  await context.addCookies([
    { name: "access_token", value: token, domain: "localhost", path: "/" },
  ]);

  await page.goto("http://localhost:3000/chat/chat-b06771c6");
  await page.waitForTimeout(3000);

  // Find an assistant message with citation badges
  const assistantMsgs = page.locator(".justify-start .rounded-2xl");
  const msgCount = await assistantMsgs.count();

  if (msgCount > 0) {
    // Screenshot the last assistant message (which has citations)
    const lastMsg = assistantMsgs.last();
    await lastMsg.screenshot({ path: "tests/screenshots/cit-badge-closeup.png" });
  }

  // Full page for context
  await page.screenshot({ path: "tests/screenshots/cit-full-page.png" });
});
