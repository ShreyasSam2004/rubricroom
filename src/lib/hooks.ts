"use client";

import { useSyncExternalStore } from "react";

/** Current time, bucketed so the snapshot is stable between ticks. `null` on the server (no hydration mismatch). */
export function useNow(intervalMs = 30_000): Date | null {
  const bucket = useSyncExternalStore(
    (cb) => {
      const t = setInterval(cb, intervalMs);
      return () => clearInterval(t);
    },
    () => Math.floor(Date.now() / intervalMs),
    () => null,
  );
  return bucket === null ? null : new Date(bucket * intervalMs);
}

const THEME_EVENT = "rr-theme-change";

export function useDarkMode(): [boolean, (dark: boolean) => void] {
  const dark = useSyncExternalStore(
    (cb) => {
      window.addEventListener(THEME_EVENT, cb);
      return () => window.removeEventListener(THEME_EVENT, cb);
    },
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
  const set = (next: boolean) => {
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("rr-theme", next ? "dark" : "light");
    } catch {
      /* storage unavailable */
    }
    window.dispatchEvent(new Event(THEME_EVENT));
  };
  return [dark, set];
}
