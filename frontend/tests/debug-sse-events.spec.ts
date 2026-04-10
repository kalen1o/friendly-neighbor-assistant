import { test } from "@playwright/test";

test("debug: raw SSE events for web scraping query", async ({ page }) => {
  // Create chat
  const chatRes = await page.request.post("http://localhost:8000/api/chats", {
    data: { title: null },
  });
  const chat = await chatRes.json();
  const chatId = chat.id;

  // Directly call the SSE endpoint and log all events
  console.log("[TEST] Sending message via API...");
  const startTime = Date.now();

  const res = await page.request.fetch(
    `http://localhost:8000/api/chats/${chatId}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ content: "scrap for me first 10 post of https://dev.to/" }),
    }
  );

  const body = await res.text();
  const elapsed = Date.now() - startTime;
  console.log(`[TEST] Response received in ${elapsed}ms`);
  console.log(`[TEST] Response length: ${body.length}`);

  // Parse SSE events
  const events = body.split("\n\n").filter(Boolean);
  console.log(`[TEST] Total SSE events: ${events.length}`);

  for (const event of events) {
    const lines = event.split("\n");
    let eventType = "";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event:")) eventType = line.slice(6).trim();
      if (line.startsWith("data:")) {
        const raw = line.slice(5);
        data = raw.startsWith(" ") ? raw.slice(1) : raw;
      }
    }
    // Truncate long messages
    const displayData = data.length > 100 ? data.substring(0, 100) + "..." : data;
    console.log(`  [SSE] ${eventType}: ${displayData}`);
  }

  // Cleanup
  await page.request.delete(`http://localhost:8000/api/chats/${chatId}`);
});
