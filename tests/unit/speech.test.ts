// The global speech store: one mute silences every voice, one stop interrupts whatever is talking,
// and both settings survive a reload. Runs in node with a fake speechSynthesis + localStorage.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeUtterance {
  rate = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

function setup(stored: Record<string, string> = {}) {
  const store = new Map(Object.entries(stored));
  const spoken: FakeUtterance[] = [];
  const synth = {
    speak: vi.fn((u: FakeUtterance) => spoken.push(u)),
    cancel: vi.fn(),
  };
  const video = { paused: false, pause: vi.fn(function (this: { paused: boolean }) { this.paused = true; }) };
  vi.stubGlobal("window", { speechSynthesis: synth });
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  vi.stubGlobal("document", { querySelectorAll: () => [video] });
  return { store, spoken, synth, video };
}

async function load() {
  const mod = await import("@/lib/speech");
  mod.__resetSpeechForTests();
  return mod;
}

describe("speech store", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("speaks, tracks what is playing, and clears when the utterance ends", async () => {
    const { spoken, synth } = setup();
    const { speech } = await load();
    expect(speech.getSnapshot().supported).toBe(true);
    expect(speech.speak("Who is the user?", "turn-1")).toBe(true);
    expect(synth.speak).toHaveBeenCalledOnce();
    expect(speech.getSnapshot()).toMatchObject({ speaking: true, currentId: "turn-1" });
    spoken[0].onend?.();
    expect(speech.getSnapshot()).toMatchObject({ speaking: false, currentId: null });
  });

  it("stop cancels speech, pauses page media, and notifies subscribers", async () => {
    const { synth, video } = setup();
    const { speech } = await load();
    const listener = vi.fn();
    speech.subscribe(listener);
    speech.speak("Long judge reply", "turn-1");
    speech.stop();
    expect(synth.cancel).toHaveBeenCalled();
    expect(video.pause).toHaveBeenCalled();
    expect(speech.getSnapshot().speaking).toBe(false);
    expect(listener).toHaveBeenCalled();
  });

  it("muting interrupts current speech and blocks every later voice", async () => {
    const { synth } = setup();
    const { speech } = await load();
    speech.speak("First reply", "turn-1");
    synth.cancel.mockClear();
    speech.setMuted(true);
    expect(synth.cancel).toHaveBeenCalled();
    expect(speech.getSnapshot()).toMatchObject({ muted: true, speaking: false });
    synth.speak.mockClear();
    expect(speech.speak("Second reply", "turn-2")).toBe(false);
    expect(synth.speak).not.toHaveBeenCalled();
    speech.setMuted(false);
    expect(speech.speak("Third reply", "turn-3")).toBe(true);
  });

  it("an old utterance finishing does not clear a newer one", async () => {
    const { spoken } = setup();
    const { speech } = await load();
    speech.speak("one", "a");
    speech.speak("two", "b");
    spoken[0].onend?.(); // late event from the replaced utterance
    expect(speech.getSnapshot()).toMatchObject({ speaking: true, currentId: "b" });
    // Same id replayed: the cancelled first copy's late error must not stop the second.
    speech.speak("two again", "b");
    spoken[1].onerror?.();
    expect(speech.getSnapshot()).toMatchObject({ speaking: true, currentId: "b" });
    spoken[2].onend?.();
    expect(speech.getSnapshot().speaking).toBe(false);
  });

  it("persists mute and auto-read across reloads", async () => {
    const { store } = setup();
    const first = await load();
    first.speech.setMuted(true);
    first.speech.setAutoRead(true);
    expect(store.get("rr-voice-muted")).toBe("1");
    expect(store.get("rr-voice-autoread")).toBe("1");

    vi.resetModules();
    setup(Object.fromEntries(store));
    const second = await load();
    expect(second.speech.getSnapshot()).toMatchObject({ muted: true, autoRead: true });
  });

  it("is a silent no-op without speech synthesis or storage", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    const { speech } = await load();
    expect(speech.getSnapshot()).toMatchObject({ supported: false, muted: false });
    expect(speech.speak("hello")).toBe(false);
    expect(() => speech.setMuted(true)).not.toThrow();
    expect(() => speech.stop()).not.toThrow();
  });
});
