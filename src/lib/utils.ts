import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDateTime(value: Date | string | null | undefined, timeZone?: string | null) {
  if (!value) return "Not verified";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "Not verified";
  try {
    return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: timeZone || undefined }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(d);
  }
}

export function formatDate(value: Date | string | null | undefined, timeZone?: string | null) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: timeZone || undefined }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(d);
  }
}

export function relativeTime(value: Date | string | null | undefined) {
  if (!value) return "never";
  const d = typeof value === "string" ? new Date(value) : value;
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [60_000, "second"],
    [3_600_000, "minute"],
    [86_400_000, "hour"],
    [604_800_000, "day"],
    [Infinity, "week"],
  ];
  const divisors: Record<string, number> = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 };
  const unit = units.find(([limit]) => abs < limit)![1];
  const n = Math.round(abs / divisors[unit]);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  return rtf.format(diff > 0 ? -n : n, unit as Intl.RelativeTimeFormatUnit);
}

export function timeRemaining(deadline: Date | string | null | undefined, now = new Date()) {
  if (!deadline) return null;
  const d = typeof deadline === "string" ? new Date(deadline) : deadline;
  const ms = d.getTime() - now.getTime();
  if (ms <= 0) return { passed: true, days: 0, hours: 0, minutes: 0, ms };
  return {
    passed: false,
    days: Math.floor(ms / 86_400_000),
    hours: Math.floor((ms % 86_400_000) / 3_600_000),
    minutes: Math.floor((ms % 3_600_000) / 60_000),
    ms,
  };
}

export function pluralize(n: number, word: string, plural = `${word}s`) {
  return `${n} ${n === 1 ? word : plural}`;
}
