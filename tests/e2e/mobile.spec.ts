import { expect, test } from "@playwright/test";

test("mobile navigation works and pages fit the screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Find the idea worth building." })).toBeVisible();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: "My Ideas" }).click();
  await expect(page).toHaveURL(/\/ideas/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
