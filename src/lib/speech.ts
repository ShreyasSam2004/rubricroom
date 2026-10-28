"use client";

// The one place RubricRoom produces sound. Every voice in the app goes through `speech`, so a
// single mute silences everything, a single stop interrupts anything that is talking, and the
// state is shared by the top bar and the pages. Wispr Flow dictation is input, not output, and
// is never affected.

import { useSyncExternalStore } from "react";

export interface SpeechState {
  supported: boolean;
  /** Global mute: nothing speaks while true. Persisted per browser. */
  muted: boolean;
  /** Judge's Room preference: read new judge replies aloud automatically. Persisted per browser. */
  autoRead: boolean;
  speaking: boolean;
  /** Which item is being read (e.g. a debate turn id), so its button can show "stop". */
  currentId: string | null;
}

const MUTE_KEY = "rr-voice-muted";
const AUTOREAD_KEY = "rr-voice-autoread";

const SERVER_STATE: SpeechState = { supported: false, muted: false, autoRead: false, speaking: false, currentId: null };

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function write(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* private mode / blocked storage: the setting just won't persist */
  }
}

function synth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
}

let state: SpeechState | null = null;
const listeners = new Set<() => void>();
/** The utterance currently playing. Browsers fire end/error late for cancelled ones; only this one counts. */
let active: SpeechSynthesisUtterance | null = null;

function current(): SpeechState {
  if (!state) state = { supported: Boolean(synth()), muted: read(MUTE_KEY), autoRead: read(AUTOREAD_KEY), speaking: false, currentId: null };
  return state;
}

function update(patch: Partial<SpeechState>) {
  state = { ...current(), ...patch };
  for (const l of listeners) l();
}

/** Silence any page media too (e.g. an embedded demo video), so "stop" means stop. */
function pauseMedia() {
  if (typeof document === "undefined") return;
  document.querySelectorAll<HTMLMediaElement>("audio, video").forEach((m) => {
    if (!m.paused) m.pause();
  });
}

export const speech = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: current,
  getServerSnapshot: () => SERVER_STATE,

  /** Speak text unless muted. Returns false when nothing was spoken. */
  speak(text: string, id: string | null = null): boolean {
    const s = synth();
    if (!s || current().muted || !text.trim()) return false;
    active = null;
    s.cancel(); // one voice at a time
    const u = new SpeechSynthesisUtterance(text.replace(/[“”]/g, '"'));
    u.rate = 1.03;
    const done = () => {
      if (active !== u) return; // a replaced or stopped utterance reporting in late
      active = null;
      update({ speaking: false, currentId: null });
    };
    u.onend = done;
    u.onerror = done;
    active = u;
    update({ speaking: true, currentId: id });
    s.speak(u);
    return true;
  },

  /** Stop whatever is talking right now (speech and page media). */
  stop() {
    active = null;
    synth()?.cancel();
    pauseMedia();
    if (current().speaking || current().currentId) update({ speaking: false, currentId: null });
  },

  setMuted(muted: boolean) {
    if (muted) speech.stop();
    write(MUTE_KEY, muted);
    update({ muted });
  },

  setAutoRead(autoRead: boolean) {
    if (!autoRead) speech.stop();
    write(AUTOREAD_KEY, autoRead);
    update({ autoRead });
  },
};

export function useSpeech(): SpeechState {
  return useSyncExternalStore(speech.subscribe, speech.getSnapshot, speech.getServerSnapshot);
}

/** Test helper: forget cached state so a test can start from fresh storage. */
export function __resetSpeechForTests() {
  state = null;
  active = null;
  listeners.clear();
}
