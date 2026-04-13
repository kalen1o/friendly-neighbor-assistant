import { test } from "@playwright/test";

test("model picker UI audit across viewports", async ({ page }) => {
  const email = `model-${Date.now()}@test.com`;
  await page.request.post("http://localhost:8000/api/auth/register", {
    data: { email, password: "TestPass1234", name: "Model Test" },
  });
  await page.request.post("http://localhost:8000/api/auth/login", {
    data: { email, password: "TestPass1234" },
  });

  const chatRes = await page.request.post("http://localhost:8000/api/chats", {
    headers: { "Content-Type": "application/json" },
    data: JSON.stringify({ title: "Model Picker Test" }),
  });
  const chat = await chatRes.json();

  // === Desktop (1280x720) ===
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/chat/${chat.id}`);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "tests/screenshots/model-desktop-closed.png", fullPage: false });

  // Find and click model picker
  const picker = page.locator("text=glm").first();
  if (await picker.isVisible({ timeout: 3000 })) {
    await picker.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: "tests/screenshots/model-desktop-open.png", fullPage: false });

    // Check dropdown position vs input
    const dropdown = page.locator('[role="menu"]').first();
    const input = page.locator("textarea").first();
    if (await dropdown.isVisible() && await input.isVisible()) {
      const ddBox = await dropdown.boundingBox();
      const inputBox = await input.boundingBox();
      if (ddBox && inputBox) {
        const overlaps = ddBox.y < inputBox.y + inputBox.height && ddBox.y + ddBox.height > inputBox.y;
        console.log(`[Desktop] dropdown: y=${ddBox.y.toFixed(0)} h=${ddBox.height.toFixed(0)}`);
        console.log(`[Desktop] input: y=${inputBox.y.toFixed(0)} h=${inputBox.height.toFixed(0)}`);
        console.log(`[Desktop] overlaps input: ${overlaps}`);
      }
    }
    await page.keyboard.press("Escape");
  } else {
    console.log("[Desktop] Model picker not found");
  }

  // === Home page (empty state, centered) ===
  await page.goto("/");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "tests/screenshots/model-home-closed.png", fullPage: false });

  const homePicker = page.locator("text=glm").first();
  if (await homePicker.isVisible({ timeout: 3000 })) {
    await homePicker.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: "tests/screenshots/model-home-open.png", fullPage: false });
    await page.keyboard.press("Escape");
  }

  // === Tablet (768x1024) ===
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(`/chat/${chat.id}`);
  await page.waitForTimeout(2000);

  const tabletPicker = page.locator("text=glm").first();
  if (await tabletPicker.isVisible({ timeout: 3000 })) {
    await tabletPicker.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: "tests/screenshots/model-tablet-open.png", fullPage: false });

    const dropdown = page.locator('[role="menu"]').first();
    const input = page.locator("textarea").first();
    if (await dropdown.isVisible() && await input.isVisible()) {
      const ddBox = await dropdown.boundingBox();
      const inputBox = await input.boundingBox();
      if (ddBox && inputBox) {
        const overlaps = ddBox.y < inputBox.y + inputBox.height && ddBox.y + ddBox.height > inputBox.y;
        console.log(`[Tablet] dropdown: y=${ddBox.y.toFixed(0)} h=${ddBox.height.toFixed(0)}`);
        console.log(`[Tablet] input: y=${inputBox.y.toFixed(0)} h=${inputBox.height.toFixed(0)}`);
        console.log(`[Tablet] overlaps input: ${overlaps}`);
      }
    }
    await page.keyboard.press("Escape");
  }

  // === Mobile (390x844) ===
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/chat/${chat.id}`);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "tests/screenshots/model-mobile-closed.png", fullPage: false });

  const mobilePicker = page.locator("text=glm").first();
  if (await mobilePicker.isVisible({ timeout: 3000 })) {
    await mobilePicker.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: "tests/screenshots/model-mobile-open.png", fullPage: false });

    const dropdown = page.locator('[role="menu"]').first();
    const input = page.locator("textarea").first();
    if (await dropdown.isVisible() && await input.isVisible()) {
      const ddBox = await dropdown.boundingBox();
      const inputBox = await input.boundingBox();
      if (ddBox && inputBox) {
        const overlaps = ddBox.y < inputBox.y + inputBox.height && ddBox.y + ddBox.height > inputBox.y;
        const offscreen = ddBox.x < 0 || ddBox.x + ddBox.width > 390;
        console.log(`[Mobile] dropdown: x=${ddBox.x.toFixed(0)} y=${ddBox.y.toFixed(0)} w=${ddBox.width.toFixed(0)} h=${ddBox.height.toFixed(0)}`);
        console.log(`[Mobile] input: y=${inputBox.y.toFixed(0)} h=${inputBox.height.toFixed(0)}`);
        console.log(`[Mobile] overlaps input: ${overlaps}, offscreen: ${offscreen}`);
      }
    }
    await page.keyboard.press("Escape");
  }

  await page.request.delete(`http://localhost:8000/api/chats/${chat.id}`);
});
