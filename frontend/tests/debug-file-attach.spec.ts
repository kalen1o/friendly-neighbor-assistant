import { test, expect } from "@playwright/test";

test("debug: file attachment in chat", async ({ page }) => {
  // Collect console logs
  const logs: string[] = [];
  page.on("console", (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => logs.push(`[PAGE ERROR] ${err.message}`));

  // Login first
  await page.goto("http://localhost:3000/chat/chat-f8aafb45", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  // Take screenshot of current state
  await page.screenshot({ path: "tests/screenshots/file-attach-1-initial.png", fullPage: true });

  // Check for user messages with images
  const userMessages = page.locator('[class*="primary"]'); // user bubbles have primary bg
  const messageCount = await userMessages.count();
  console.log("User message bubbles found:", messageCount);

  // Check for any img tags in the chat area
  const images = page.locator('.mx-auto img');
  const imgCount = await images.count();
  console.log("Images in chat area:", imgCount);

  // Check all img tags on page
  const allImages = page.locator('img');
  const allImgCount = await allImages.count();
  console.log("All images on page:", allImgCount);
  for (let i = 0; i < allImgCount; i++) {
    const src = await allImages.nth(i).getAttribute('src');
    const alt = await allImages.nth(i).getAttribute('alt');
    console.log(`  img[${i}]: src=${src?.substring(0, 80)}, alt=${alt}`);
  }

  // Check if fileUrls is being set - look at the message data
  // Try to find the React state by checking rendered content
  const messageTexts = page.locator('[class*="whitespace-pre-wrap"]');
  const textCount = await messageTexts.count();
  console.log("Message text blocks:", textCount);
  for (let i = 0; i < textCount; i++) {
    const text = await messageTexts.nth(i).textContent();
    console.log(`  msg[${i}]: "${text?.substring(0, 60)}..."`);
  }

  // Check network requests for file uploads
  const fileApiCalls = logs.filter(l => l.includes('/api/uploads'));
  console.log("File API calls in logs:", fileApiCalls);

  // Print all console logs
  console.log("\n--- All console logs ---");
  for (const log of logs) {
    console.log(log);
  }
});
