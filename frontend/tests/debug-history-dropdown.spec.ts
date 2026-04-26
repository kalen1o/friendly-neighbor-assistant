import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

// Login via API so the browser context gets the session cookies, then
// navigate to the specific chat we need to debug.
//
// Credentials come from env vars (matches existing project convention in .env):
//   PLAYWRIGHT_TEST_USERNAME=you@example.com PLAYWRIGHT_TEST_PASSWORD=... \
//     npx playwright test tests/debug-history-dropdown.spec.ts

const EMAIL = process.env.PLAYWRIGHT_TEST_USERNAME;
const PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD;
const CHAT_ID = process.env.FN_TEST_CHAT_ID ?? "chat-56d1c4a0";
const API_BASE = process.env.FN_TEST_API_BASE ?? "http://localhost:8000";

test("history dropdown opens and Compare versions triggers the diff dialog", async ({ page }) => {
  expect(EMAIL, "PLAYWRIGHT_TEST_USERNAME env var required").toBeTruthy();
  expect(PASSWORD, "PLAYWRIGHT_TEST_PASSWORD env var required").toBeTruthy();

  // Buffer every browser console line + uncaught error — print on teardown.
  const consoleLines: string[] = [];
  page.on("console", (msg) => {
    consoleLines.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    consoleLines.push(`[pageerror] ${err.message}\n${err.stack ?? ""}`);
  });
  page.on("requestfailed", (req) => {
    consoleLines.push(`[requestfailed] ${req.method()} ${req.url()} — ${req.failure()?.errorText ?? "?"}`);
  });

  // 1. Log in — cookies land on page.context() automatically.
  const loginRes = await page.request.post(`${API_BASE}/api/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(loginRes.status(), `login failed: ${await loginRes.text()}`).toBe(200);

  // 2. Navigate to the target chat.
  await page.goto(`/chat/${CHAT_ID}`);

  // 3. Wait for the artifact panel to appear (it auto-opens on reload when
  // the latest artifact belongs to the last assistant message).
  const panel = page.locator('[class*="artifact"]').first();
  await page.waitForLoadState("networkidle");

  // Screenshot current state for visual confirmation.
  const shotDir = path.join(__dirname, "screenshots");
  fs.mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: path.join(shotDir, "history-00-landed.png"), fullPage: true });

  // 4. Find the History button. Its `title="Version history"` makes it locatable
  // regardless of icon rendering.
  const historyBtn = page.getByTitle("Version history");
  const btnCount = await historyBtn.count();
  console.log(`[debug] found ${btnCount} "Version history" button(s)`);

  if (btnCount === 0) {
    console.log("[debug] Artifact panel probably not mounted — dumping DOM structure of the chat page");
    const html = await page.content();
    fs.writeFileSync(path.join(shotDir, "history-no-button-dom.html"), html);
  }
  expect(btnCount, "Version history button should be present in the artifact panel").toBeGreaterThan(0);

  // 5. Click History. Screenshot right after — do we see a popup?
  await historyBtn.first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shotDir, "history-01-after-click.png"), fullPage: true });

  // Base UI Menu renders a popup with data-slot="dropdown-menu-content".
  const menu = page.locator('[data-slot="dropdown-menu-content"]');
  const menuVisible = (await menu.count()) > 0 && (await menu.first().isVisible().catch(() => false));
  console.log(`[debug] dropdown visible after click: ${menuVisible}`);

  if (!menuVisible) {
    // The failure mode the user reported.
    console.log("[debug] Version history dropdown did NOT open after clicking");
    console.log("[debug] DOM around history button:");
    const outerHTML = await historyBtn.first().evaluate((el) => el.parentElement?.outerHTML ?? el.outerHTML);
    console.log(outerHTML);

    // Is there a stray overlay covering the button?
    const overlays = await page.locator('[data-slot="dialog-overlay"], [data-slot="dropdown-menu-content"]').all();
    for (const o of overlays) {
      const box = await o.boundingBox();
      const isVisible = await o.isVisible().catch(() => false);
      console.log(`[debug] overlay/menu: visible=${isVisible} box=${JSON.stringify(box)}`);
    }
  }

  expect(menuVisible, "History dropdown should open when the History button is clicked").toBeTruthy();

  // 6. Inside the open menu, verify the "Compare versions…" item is present.
  const compare = page.getByRole("menuitem", { name: /Compare versions/i });
  const compareCount = await compare.count();
  console.log(`[debug] "Compare versions" menu item count: ${compareCount}`);
  expect(compareCount, "Compare versions menu item should exist when there are ≥2 versions").toBeGreaterThan(0);

  // 7. Click Compare — the diff dialog should open.
  const compareBox = await compare.first().boundingBox();
  console.log(`[debug] Compare item box: ${JSON.stringify(compareBox)}`);

  await compare.first().click();
  await page.waitForTimeout(800);

  // Did the dropdown close (indicates onSelect fired)?
  const menuStillOpen = (await menu.count()) > 0 && (await menu.first().isVisible().catch(() => false));
  console.log(`[debug] dropdown still open after Compare click: ${menuStillOpen}`);

  // Inspect what's in the DOM — any dialog-related node?
  const allDialogs = await page.locator('[data-slot^="dialog"]').count();
  console.log(`[debug] elements matching [data-slot^="dialog"]: ${allDialogs}`);

  const portals = await page.locator('[role="dialog"]').count();
  console.log(`[debug] elements with role="dialog": ${portals}`);

  await page.screenshot({ path: path.join(shotDir, "history-02-after-compare-click.png"), fullPage: true });

  // Dump a snippet of body innerHTML for any dialog-like structure
  const dialogHtml = await page.evaluate(() => {
    const el = document.querySelector('[data-slot^="dialog"]');
    if (el) return el.outerHTML.slice(0, 1500);
    return "(no dialog-prefixed element found in DOM)";
  });
  console.log(`[debug] dialog DOM snippet:\n${dialogHtml}`);

  // Print console lines NOW, before the assertion that may fail.
  if (consoleLines.length) {
    console.log("\n=== BROWSER CONSOLE / ERRORS (captured so far) ===");
    for (const line of consoleLines) console.log(line);
    console.log("=== END CONSOLE ===\n");
  } else {
    console.log("[debug] no browser console lines captured");
  }

  const dialog = page.locator('[data-slot="dialog-content"]');
  await expect(dialog).toBeVisible({ timeout: 3000 });
  await expect(dialog.getByText("Compare versions")).toBeVisible();

  console.log("[debug] diff dialog opened successfully");
});
