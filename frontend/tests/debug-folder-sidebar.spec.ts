import { test } from "@playwright/test";

test("debug: new folder shows inline rename input", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  // Capture errors
  page.on("pageerror", (err) => console.log(`[PAGE ERROR] ${err.message}`));

  // Login
  await page.goto("/");
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "tests/screenshots/rename-0-initial.png", fullPage: true });

  const signInBtn = page.getByText("Sign in").first();
  const signInVisible = await signInBtn.isVisible().catch(() => false);
  console.log(`[AUTH] Sign in visible=${signInVisible}`);

  if (signInVisible) {
    await signInBtn.click();
    await page.waitForTimeout(1000);

    const emailInput = page.locator('input[type="email"]');
    const emailVisible = await emailInput.isVisible().catch(() => false);
    console.log(`[AUTH] Email input visible=${emailVisible}`);

    if (emailVisible) {
      await emailInput.fill("ftest2@test.com");
      await page.locator('input[type="password"]').fill("Testpass123");
      await page.screenshot({ path: "tests/screenshots/rename-1-login-form.png", fullPage: true });
      await page.locator('button[type="submit"]').click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: "tests/screenshots/rename-2-after-login.png", fullPage: true });
    }
  }

  // Check what we see now
  const sidebar = page.locator("aside");
  const sidebarText = await sidebar.first().textContent().catch(() => "NO SIDEBAR");
  console.log(`[SIDEBAR] ${sidebarText?.substring(0, 300)}`);

  // Check for Folders button
  const foldersBtn = page.getByText("Folders", { exact: true });
  const foldersCount = await foldersBtn.count();
  console.log(`[TOGGLE] Folders count=${foldersCount}`);

  if (foldersCount === 0) {
    console.log("[SKIP] No Folders button found, stopping test");
    await context.close();
    return;
  }

  // Switch to Folders view
  await foldersBtn.first().click();
  await page.waitForTimeout(500);

  // Click New Folder
  const newFolderBtn = page.locator('button[title="New folder"]');
  console.log(`[NEW FOLDER] button count=${await newFolderBtn.count()}`);
  await newFolderBtn.click();
  await page.waitForTimeout(1500);

  // Check for inline input (rename mode)
  const renameInput = sidebar.locator("input");
  const inputCount = await renameInput.count();
  console.log(`[RENAME] input count=${inputCount}`);

  if (inputCount > 0) {
    const isFocused = await renameInput.first().evaluate((el) => el === document.activeElement);
    console.log(`[RENAME] input focused=${isFocused}`);
    const value = await renameInput.first().inputValue();
    console.log(`[RENAME] input value="${value}"`);
  }

  await sidebar.first().screenshot({ path: "tests/screenshots/rename-3-inline-input.png" });

  // Type a name and press Enter
  if (inputCount > 0) {
    await renameInput.first().fill("My Projects");
    await renameInput.first().press("Enter");
    await page.waitForTimeout(1000);
    await sidebar.first().screenshot({ path: "tests/screenshots/rename-4-after-name.png" });

    const folderText = page.getByText("My Projects");
    console.log(`[RESULT] "My Projects" visible=${await folderText.count() > 0}`);
  }

  await context.close();
});
