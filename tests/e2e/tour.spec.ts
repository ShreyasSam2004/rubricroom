import { expect, test } from "@playwright/test";

// New visitors get the 2-minute product tour inline on the dashboard; everyone can open it from
// the hero. (Playwright's Chromium can't decode H.264, so this checks wiring, not playback.)

test("the product tour is on the dashboard for newcomers and one click away for everyone", async ({ page, request }) => {
  await page.goto("/");
  const section = page.getByTestId("tour-section");
  await expect(section).toBeVisible();
  const video = section.getByTestId("tour-video");
  const src = await video.getAttribute("src");
  expect(src).toBe("/demo/rubricroom-tour.mp4");
  const res = await request.get(src!, { headers: { range: "bytes=0-1023" } });
  expect([200, 206]).toContain(res.status());
  expect(res.headers()["content-type"]).toContain("video/mp4");

  const chapters = section.getByTestId("tour-chapter");
  await expect(chapters).toHaveCount(9);
  await expect(chapters.first()).toHaveAttribute("aria-current", "step");
  await chapters.filter({ hasText: "the Judge's Room" }).click();
  await expect(chapters.filter({ hasText: "the Judge's Room" })).toHaveAttribute("aria-current", "step");

  // Once the workspace has data, the inline tour steps aside; the hero button still opens it.
  await page.getByTestId("demo-button").first().click();
  await expect(page.getByTestId("hackathon-title")).toBeVisible({ timeout: 30_000 });
  await page.goto("/");
  await expect(page.getByTestId("tour-section")).toHaveCount(0);
  await page.getByTestId("tour-open").click();
  const dialog = page.getByRole("dialog", { name: "RubricRoom in 2 minutes" });
  await expect(dialog.getByTestId("tour-video")).toBeVisible();
  await expect(dialog.getByTestId("tour-chapter")).toHaveCount(9);
});
