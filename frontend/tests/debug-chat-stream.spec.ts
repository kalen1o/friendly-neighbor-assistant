import { test, expect } from "@playwright/test";

test("new assistant message should appear after streaming completes", async ({
  page,
}) => {
  const consoleLogs: string[] = [];
  page.on("console", (msg) => {
    const text = `[${msg.type()}] ${msg.text()}`;
    consoleLogs.push(text);
  });

  // 1) Create a new chat
  await page.goto("/");
  await page.getByRole("button", { name: "New Chat" }).click();
  await page.waitForURL(/\/chat\/\d+/);

  // 2) Send a message
  const textarea = page.getByPlaceholder("Type a message...");
  await textarea.fill("Say hello in exactly 3 words");
  await textarea.press("Enter");

  // 3) User message appears immediately
  const userBubble = page.locator(".justify-end .rounded-2xl").first();
  await expect(userBubble).toContainText("Say hello in exactly 3 words");

  // 4) Wait for assistant streaming bubble to appear
  const assistantBubble = page.locator(".justify-start .rounded-2xl").first();
  await expect(assistantBubble).toBeVisible({ timeout: 15_000 });

  // 5) Wait for streaming to finish (input re-enabled)
  await expect(textarea).toBeEnabled({ timeout: 30_000 });

  // 6) Assistant message should be visible with content
  await page.waitForTimeout(500);
  const assistantMessages = page.locator(".justify-start .rounded-2xl");
  const count = await assistantMessages.count();
  expect(count).toBeGreaterThan(0);

  const textBeforeReload = await assistantMessages.first().textContent();
  expect(textBeforeReload?.trim().length).toBeGreaterThan(0);

  // 7) Reload and compare
  await page.reload();
  await page.waitForLoadState("networkidle");
  const assistantAfterReload = page.locator(".justify-start .rounded-2xl");
  await expect(assistantAfterReload.first()).toBeVisible({ timeout: 5_000 });
  const textAfterReload = await assistantAfterReload.first().textContent();

  console.log(`Before reload: "${textBeforeReload}"`);
  console.log(`After reload:  "${textAfterReload}"`);

  // Content should match (no lost spaces or missing messages)
  expect(textBeforeReload?.trim()).toBe(textAfterReload?.trim());
});
