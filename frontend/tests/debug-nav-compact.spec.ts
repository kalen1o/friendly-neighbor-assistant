import { test } from "@playwright/test";
test("nav items visual check", async ({ page }) => {
  const email = `nav-${Date.now()}@test.com`;
  await page.request.post("http://localhost:8000/api/auth/register", {
    data: { email, password: "TestPass1234", name: "Nav Test" },
  });
  await page.request.post("http://localhost:8000/api/auth/login", {
    data: { email, password: "TestPass1234" },
  });
  await page.goto("/");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "tests/screenshots/nav-compact.png", fullPage: false });
});
