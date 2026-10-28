import { expect, test } from "@playwright/test";

// A common laptop width: two-column pages must fit without pushing the side panel off-screen.
test.use({ viewport: { width: 1280, height: 720 } });

test("pages fit a 1280px laptop screen", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("demo-button").first().click();
  await expect(page.getByTestId("hackathon-title")).toBeVisible({ timeout: 30_000 });
  const urls = [page.url(), "/ideas", "/judge", "/settings"];
  await page.goto("/ideas");
  await page.getByTestId("idea-row").first().click();
  await expect(page.getByTestId("idea-title")).toBeVisible();
  urls.push(page.url());
  for (const url of urls) {
    await page.goto(url);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, url).toBeLessThanOrEqual(1);
  }
});
