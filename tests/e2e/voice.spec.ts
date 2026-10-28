import { expect, test, type Page } from "@playwright/test";

// Every voice in the app can be stopped and muted. The browser's speechSynthesis is replaced with a
// fake that keeps "talking" until cancelled, so the test sees exactly what a long judge reply does.

test.describe.configure({ mode: "serial" });

let page: Page;
let debateUrl = "";

declare global {
  interface Window {
    __voice: { spoken: string[]; cancels: number; talking: boolean };
  }
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.addInitScript(() => {
    const log = { spoken: [] as string[], cancels: 0, talking: false };
    let current: SpeechSynthesisUtterance | null = null;
    const fake = {
      get speaking() { return log.talking; },
      pending: false,
      paused: false,
      speak(u: SpeechSynthesisUtterance) { log.spoken.push(u.text); current = u; log.talking = true; },
      cancel() {
        log.cancels += 1;
        log.talking = false;
        const u = current;
        current = null;
        // Real browsers report a cancelled utterance as an "interrupted" error, after the fact.
        if (u) setTimeout(() => u.onerror?.({ error: "interrupted" } as SpeechSynthesisErrorEvent), 0);
      },
      pause() {}, resume() {}, getVoices: () => [], addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, onvoiceschanged: null,
    };
    Object.defineProperty(window, "speechSynthesis", { value: fake, configurable: true });
    window.__voice = log;
  });
  await page.goto("/");
  await page.getByTestId("demo-button").first().click();
  await expect(page.getByTestId("hackathon-title")).toHaveText("No Hands: The Wispr Challenge", { timeout: 30_000 });
});

test.afterAll(async () => {
  await page.close();
});

const talking = () => page.evaluate(() => window.__voice.talking);

test("a judge reply can be read aloud and stopped from the reply or the top bar", async () => {
  await page.goto("/judge");
  await page.getByTestId("idea-select").selectOption({ label: "AI Interview Academy" });
  await page.getByTestId("start-judges").click();
  await expect(page.getByTestId("judge-turn")).toHaveCount(1, { timeout: 30_000 });
  debateUrl = page.url();
  await expect(page.getByTestId("voice-stop")).toHaveCount(0);

  const read = page.getByTestId("read-aloud").first();
  await read.click();
  expect(await talking()).toBe(true);
  await expect(read).toHaveAttribute("data-playing", "true");
  await expect(page.getByTestId("voice-stop")).toBeVisible();

  // Stop from the reply's own button.
  await read.click();
  expect(await talking()).toBe(false);
  await expect(page.getByTestId("voice-stop")).toHaveCount(0);
  await expect(read).toHaveAttribute("data-playing", "false");

  // Stop from the global top-bar button.
  await read.click();
  await page.getByTestId("voice-stop").click();
  expect(await talking()).toBe(false);
  await expect(page.getByTestId("voice-stop")).toHaveCount(0);

  // Esc stops too.
  await read.click();
  await expect(page.getByTestId("voice-stop")).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await talking()).toBe(false);
  await expect(page.getByTestId("voice-stop")).toHaveCount(0);
});

test("auto-read speaks new replies, and leaving the page silences it", async () => {
  await page.getByTestId("auto-read").click();
  await expect(page.getByTestId("auto-read")).toHaveAttribute("aria-pressed", "true");
  const before = await page.evaluate(() => window.__voice.spoken.length);
  await page.getByTestId("debate-input").fill("I personally prepare for interviews every day and forget my weak answers.");
  await page.getByTestId("debate-send").click();
  await expect(page.getByTestId("judge-turn")).toHaveCount(2, { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => window.__voice.spoken.length)).toBe(before + 1);
  expect(await talking()).toBe(true);
  await expect(page.getByTestId("voice-stop")).toBeVisible();

  await page.getByRole("link", { name: "Dashboard" }).first().click();
  await expect(page).toHaveURL(/\/$/);
  expect(await talking()).toBe(false);
  await expect(page.getByTestId("voice-stop")).toHaveCount(0);
});

test("mute silences every voice immediately and stays muted after reload", async () => {
  await page.goto(debateUrl);
  await expect(page.getByTestId("judge-turn")).toHaveCount(2);
  const read = page.getByTestId("read-aloud").first();
  await read.click();
  expect(await talking()).toBe(true);

  const mute = page.getByTestId("voice-mute");
  await mute.click();
  await expect(mute).toHaveAttribute("aria-pressed", "true");
  expect(await talking()).toBe(false);
  await expect(page.getByTestId("voice-stop")).toHaveCount(0);
  await expect(read).toBeDisabled();
  await expect(page.getByTestId("auto-read")).toContainText("Voices muted");

  // Muted replies are not read aloud even with auto-read on.
  const before = await page.evaluate(() => window.__voice.spoken.length);
  await page.getByTestId("debate-input").fill("My friends also forget which interview answers they fumbled.");
  await page.getByTestId("debate-send").click();
  await expect(page.getByTestId("judge-turn")).toHaveCount(3, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__voice.spoken.length)).toBe(before);

  await page.reload();
  await expect(page.getByTestId("voice-mute")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("read-aloud").first()).toBeDisabled();

  await page.getByTestId("voice-mute").click();
  await expect(page.getByTestId("voice-mute")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("read-aloud").first().click();
  expect(await talking()).toBe(true);
});
