import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});

test.afterAll(async () => {
  await page.close();
});

test("dashboard loads without login", async () => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Find the idea worth building." })).toBeVisible();
  await expect(page.getByTestId("analyze-form")).toBeVisible();
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === "rr_ws")?.httpOnly).toBe(true);
});

test("a first-time visitor lands in the labelled sample workspace, not empty pages", async () => {
  await expect(page.getByTestId("sample-workspace")).toBeVisible();
  await expect(page.getByTestId("tour-section")).toBeVisible();
  await page.goto("/ideas");
  await expect(page.getByTestId("idea-row")).toHaveCount(3);
  await page.goto("/judge");
  expect(await page.locator('a[href^="/judge/deb_"]').count()).toBe(2);
  await page.locator('a[href^="/judge/deb_"]').first().click();
  await expect(page.getByTestId("sample-banner")).toBeVisible();
  await expect(page.getByTestId("user-turn").first()).toBeVisible();
  await page.goto("/plan");
  await expect(page.getByTestId("plan-board")).toBeVisible();
  await page.goto("/evidence");
  await expect(page.getByTestId("readiness")).toHaveText("1 of 4 required artifacts prepared");
});

test("the live demo opens the real hackathon with cited rubric and deadline", async () => {
  await page.goto("/");
  await page.getByTestId("demo-button").first().click();
  await expect(page.getByTestId("hackathon-title")).toHaveText("No Hands: The Wispr Challenge", { timeout: 30_000 });
  await expect(page.getByTestId("deadline")).toContainText("31 Oct 2026");
  await expect(page.getByText("Cached", { exact: false }).first()).toBeVisible();
  await page.getByTestId("tab-judging").click();
  await expect(page.getByTestId("criterion-weight")).toHaveText(["30%", "30%", "25%", "15%"]);
  await expect(page.getByText("Weight recovered from page markup").first()).toBeVisible();
  // Open a citation and see the verbatim quote + source.
  await page.getByTestId("citation").first().click();
  await expect(page.getByText("Open source page").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("tab-sources").click();
  await expect(page.getByTestId("source-list").locator("li")).toHaveCount(4);
  await expect(page.getByTestId("coverage")).toContainText("Not searched");
});

test("the demo ships only labelled sample ideas", async () => {
  await page.goto("/ideas");
  const rows = page.getByTestId("idea-row");
  await expect(rows).toHaveCount(3);
  for (const row of await rows.all()) await expect(row).toContainText("Sample idea");
  await expect(rows.filter({ hasText: "RubricRoom" })).toHaveCount(0);
});

test("Judge's Room: debate, evidence-gated revision, and a confirmed correction", async () => {
  await page.goto("/judge");
  await page.getByTestId("idea-select").selectOption({ label: "AI Interview Academy" });
  await page.getByTestId("mode-critical").click();
  await page.getByTestId("start-judges").click();
  await expect(page.getByTestId("debate-title")).toContainText("AI Interview Academy", { timeout: 30_000 });
  await expect(page.getByTestId("judge-turn")).toHaveCount(1);

  // Speculation alone changes nothing.
  await page.getByTestId("debate-input").fill("Judges will love it, it is guaranteed to win.");
  await page.getByTestId("debate-send").click();
  await expect(page.getByTestId("judge-turn")).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByTestId("claim").last()).toContainText("rejected");

  // First-hand experience is accepted as user-reported and moves one criterion by one step.
  await page.getByTestId("debate-input").fill("I personally prepare for interviews every day. My version remembers each weakness and retests me after tutoring.");
  await page.getByTestId("debate-send").click();
  await expect(page.getByTestId("judge-turn")).toHaveCount(3, { timeout: 30_000 });
  const [, from, to] = (await page.getByTestId("revision").last().textContent())!.match(/(\d)→(\d)/)!;
  expect(Number(to)).toBe(Number(from) + 1);

  // A correction is proposed, then applied only on confirmation.
  await page.getByTestId("debate-input").fill("You misunderstood my idea. Remove the video calls from the MVP and focus on the web dashboard.");
  await page.getByTestId("debate-send").click();
  await expect(page.getByTestId("idea-update")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("apply-update").click();
  await expect(page.getByText(/Idea updated to version 2/)).toBeVisible({ timeout: 30_000 });

  // Persisted: reload and the transcript is still there.
  await page.reload();
  await expect(page.getByTestId("user-turn")).toHaveCount(3);
  const download = page.waitForEvent("download");
  await page.getByTestId("export-debate").click();
  expect((await download).suggestedFilename()).toMatch(/judges-room-.*\.md/);
});

test("build plan: create, update progress, export", async () => {
  await page.goto("/plan?create=1");
  await page.getByTestId("create-plan-submit").click();
  await expect(page.getByTestId("plan-board")).toBeVisible({ timeout: 30_000 });
  const days = await page.getByTestId("plan-day").count();
  expect(days).toBeGreaterThan(0);
  expect(days).toBeLessThanOrEqual(30);
  await page.getByTestId("task-toggle").first().click(); // todo → doing
  await expect(page.getByTestId("task").first().locator("svg").first()).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByTestId("export-plan").click();
  expect((await download).suggestedFilename()).toBe("build-plan.md");
  await page.getByTestId("demo-generate").click();
  await expect(page.getByTestId("demo-segments").locator("li").first()).toBeVisible({ timeout: 30_000 });
});

test("evidence board shows honest readiness", async () => {
  await page.goto("/evidence");
  await expect(page.getByTestId("readiness")).toHaveText(/of 4 required artifacts prepared/);
  await expect(page.getByTestId("criterion-evidence")).toHaveCount(4);
});

test("Ask RubricRoom maps a spoken command to a real navigation", async () => {
  await page.goto("/");
  await page.getByTestId("ask-open").click();
  await page.getByTestId("ask-input").fill("Open Opportunity Radar");
  await page.getByTestId("ask-submit").click();
  await expect(page).toHaveURL(/\/radar/);
  await expect(page.getByTestId("radar-controls")).toBeVisible();
});

test("a new spoken pitch is analyzed by the backend", async () => {
  await page.goto("/ideas");
  await page.getByTestId("pitch-input").fill("Main ek tool banana chahta hoon for clinic receptionists jo daily follow-up calls bhool jaate hain. Receptionists dictate call notes and the tool schedules reminders and drafts WhatsApp messages.");
  await page.getByTestId("pitch-submit").click();
  await expect(page.getByTestId("idea-title")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Original pitch \(hinglish\)/)).toBeVisible(); // original language preserved
  await page.getByRole("tab", { name: /Assessment/ }).click();
  await expect(page.getByRole("tabpanel").getByTestId("criterion-row")).toHaveCount(4);
});

test("unsafe URLs are refused before anything is fetched", async () => {
  await page.goto("/hackathons");
  await page.getByTestId("analyze-url").fill("http://169.254.169.254/latest/meta-data");
  await page.getByTestId("analyze-submit").click();
  await expect(page.getByText(/private, loopback or link-local/)).toBeVisible();
});
