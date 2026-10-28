import { expect, test } from "@playwright/test";

// Example runs open from the dashboard into the visitor's own workspace, fully navigable, with the
// disclosure of what was captured and what was written for the example.

test("an example run opens with its dossier, debate, research and plan", async ({ page }) => {
  await page.goto("/");
  const cards = page.getByTestId("example-card");
  expect(await cards.count()).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId("example-runs")).toContainText("sample ideas, not a real team's submission");

  await cards.first().getByTestId("open-example").click();
  await expect(page).toHaveURL(/\/ideas\/idea_/, { timeout: 30_000 });
  const banner = page.getByTestId("example-banner");
  await expect(banner).toContainText("Example run");
  await expect(page.getByText("Sample idea (editable)")).toBeVisible();

  await banner.getByRole("link", { name: "Competitor research" }).click();
  await expect(page.getByTestId("originality-report")).toBeVisible();
  expect(await page.getByTestId("competitor-link").count()).toBeGreaterThan(0);

  await banner.getByRole("link", { name: "Judge's Room session" }).click();
  await expect(page.getByTestId("user-turn")).toHaveCount(2);
  await expect(page.getByTestId("judge-turn").first()).toBeVisible();

  await page.goBack();
  await page.getByTestId("example-banner").getByRole("link", { name: "Build plan + demo script" }).click();
  await expect(page.getByTestId("plan-board")).toBeVisible();
  await expect(page.getByTestId("demo-segments").locator("li").first()).toBeVisible();

  await page.goBack();
  await page.getByTestId("example-banner").getByRole("link", { name: "Event dossier" }).click();
  await expect(page.getByTestId("hackathon-title")).toBeVisible();
  await expect(page.getByTestId("example-banner")).toBeVisible();
  await expect(page.getByText("Cached", { exact: false }).first()).toBeVisible();

  // Opening it again reuses the same copy.
  const url = page.url();
  await page.goto("/");
  await page.getByTestId("example-card").first().getByTestId("open-example").click();
  await expect(page).toHaveURL(/\/ideas\/idea_/, { timeout: 30_000 });
  await page.getByTestId("example-banner").getByRole("link", { name: "Event dossier" }).click();
  await expect(page).toHaveURL(url);
});
