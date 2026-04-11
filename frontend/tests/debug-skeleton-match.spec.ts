import { test, expect } from "@playwright/test";

test("skeleton matches real message bubble styles", async ({ page }) => {
  const email = `match-${Date.now()}@test.com`;
  await page.request.post("http://localhost:8000/api/auth/register", {
    data: { email, password: "TestPass1234", name: "Match Tester" },
  });
  await page.request.post("http://localhost:8000/api/auth/login", {
    data: { email, password: "TestPass1234" },
  });

  const chatRes = await page.request.post("http://localhost:8000/api/chats", {
    data: { title: "Skeleton Match" },
  });
  const chat = await chatRes.json();

  // Step 1: Send a message and wait for response
  await page.goto(`/chat/${chat.id}`);
  await page.waitForSelector("textarea");
  await page.locator("textarea").fill("Say hi in one sentence");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(8000);

  // Step 2: Capture real message bubble styles
  const realStyles = await page.evaluate(() => {
    const bubbles = document.querySelectorAll('[class*="rounded-[20px]"]');
    const results: { role: string; classes: string; rect: DOMRect }[] = [];
    bubbles.forEach((el) => {
      const classes = el.className;
      const isUser = classes.includes("bg-primary");
      results.push({
        role: isUser ? "user" : "assistant",
        classes,
        rect: el.getBoundingClientRect(),
      });
    });
    return results;
  });
  console.log("[real bubbles]", JSON.stringify(realStyles, null, 2));
  await page.screenshot({ path: "tests/screenshots/match-real.png", fullPage: false });

  // Step 3: Intercept API to add delay, then reload to see skeleton
  await page.route("**/api/chats/**", async (route) => {
    await new Promise((r) => setTimeout(r, 2000));
    await route.continue();
  });
  await page.reload();
  await page.waitForTimeout(300);

  // Step 4: Capture skeleton styles
  const skeletonStyles = await page.evaluate(() => {
    const bubbles = document.querySelectorAll('[class*="rounded-[20px]"]');
    const results: { role: string; classes: string; rect: DOMRect }[] = [];
    bubbles.forEach((el) => {
      const classes = el.className;
      const isUser = classes.includes("bg-primary");
      results.push({
        role: isUser ? "user" : "assistant",
        classes,
        rect: el.getBoundingClientRect(),
      });
    });
    return results;
  });
  console.log("[skeleton bubbles]", JSON.stringify(skeletonStyles, null, 2));
  await page.screenshot({ path: "tests/screenshots/match-skeleton.png", fullPage: false });

  // Step 5: Compare styles
  // Both should have user bubbles with bg-primary and rounded-br-md
  const realUser = realStyles.find((s) => s.role === "user");
  const skelUser = skeletonStyles.find((s) => s.role === "user");
  const realAssistant = realStyles.find((s) => s.role === "assistant");
  const skelAssistant = skeletonStyles.find((s) => s.role === "assistant");

  console.log("\n=== COMPARISON ===");

  // User bubble checks
  if (realUser && skelUser) {
    const userChecks = {
      "rounded-[20px]": [realUser.classes.includes("rounded-[20px]"), skelUser.classes.includes("rounded-[20px]")],
      "rounded-br-md": [realUser.classes.includes("rounded-br-md"), skelUser.classes.includes("rounded-br-md")],
      "bg-primary": [realUser.classes.includes("bg-primary"), skelUser.classes.includes("bg-primary")],
      "shadow-sm": [realUser.classes.includes("shadow-sm"), skelUser.classes.includes("shadow-sm")],
      "shadow-primary/20": [realUser.classes.includes("shadow-primary/20"), skelUser.classes.includes("shadow-primary/20")],
      "px-4 py-3 or px-3 py-2": [/px-[34]/.test(realUser.classes), /px-[34]/.test(skelUser.classes)],
    };
    console.log("[USER BUBBLE]");
    for (const [prop, [real, skel]] of Object.entries(userChecks)) {
      const match = real === skel ? "MATCH" : "MISMATCH";
      console.log(`  ${prop}: real=${real} skeleton=${skel} → ${match}`);
    }
  }

  // Assistant bubble checks
  if (realAssistant && skelAssistant) {
    const assistantChecks = {
      "rounded-[20px]": [realAssistant.classes.includes("rounded-[20px]"), skelAssistant.classes.includes("rounded-[20px]")],
      "rounded-bl-md": [realAssistant.classes.includes("rounded-bl-md"), skelAssistant.classes.includes("rounded-bl-md")],
      "border-border/60": [realAssistant.classes.includes("border-border/60"), skelAssistant.classes.includes("border-border/60")],
      "bg-card": [realAssistant.classes.includes("bg-card"), skelAssistant.classes.includes("bg-card")],
      "shadow-sm": [realAssistant.classes.includes("shadow-sm"), skelAssistant.classes.includes("shadow-sm")],
      "px-4 py-3 or px-3 py-2": [/px-[34]/.test(realAssistant.classes), /px-[34]/.test(skelAssistant.classes)],
    };
    console.log("[ASSISTANT BUBBLE]");
    for (const [prop, [real, skel]] of Object.entries(assistantChecks)) {
      const match = real === skel ? "MATCH" : "MISMATCH";
      console.log(`  ${prop}: real=${real} skeleton=${skel} → ${match}`);
    }
  }

  // Alignment checks
  if (realUser && skelUser) {
    // User should be right-aligned — check x position is similar
    const realRight = realUser.rect.right;
    const skelRight = skelUser.rect.right;
    console.log(`[ALIGNMENT] User right edge: real=${realRight.toFixed(0)} skeleton=${skelRight.toFixed(0)} diff=${Math.abs(realRight - skelRight).toFixed(0)}px`);
  }
  if (realAssistant && skelAssistant) {
    const realLeft = realAssistant.rect.left;
    const skelLeft = skelAssistant.rect.left;
    console.log(`[ALIGNMENT] Assistant left edge: real=${realLeft.toFixed(0)} skeleton=${skelLeft.toFixed(0)} diff=${Math.abs(realLeft - skelLeft).toFixed(0)}px`);
  }

  // Assertions
  expect(skelUser).toBeTruthy();
  expect(skelAssistant).toBeTruthy();
  expect(skelUser!.classes).toContain("rounded-[20px]");
  expect(skelUser!.classes).toContain("rounded-br-md");
  expect(skelAssistant!.classes).toContain("rounded-[20px]");
  expect(skelAssistant!.classes).toContain("rounded-bl-md");
  expect(skelAssistant!.classes).toContain("border-border/60");
  expect(skelAssistant!.classes).toContain("bg-card");

  await page.request.delete(`http://localhost:8000/api/chats/${chat.id}`);
});
