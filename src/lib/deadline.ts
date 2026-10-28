// Deadlines as the page states them. A page that gives only a date ("Apr 26, 2026") has no time
// of day to convert between time zones, so RubricRoom shows just that date and counts down to the
// end of that day, instead of reading it as midnight UTC (which showed as "5:30 am" in IST).

import { formatDate, formatDateTime } from "./utils";

const TIME_OF_DAY = /\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}\s?(am|pm|a\.m\.|p\.m\.)|\b(noon|midnight)\b/i;

/** Whether text states a time of day ("11:59 pm", "23:59", "noon"). */
export function statesTime(text: string | null | undefined) {
  return Boolean(text && TIME_OF_DAY.test(text));
}

export interface DeadlineFields {
  deadlineAt: Date | string | null;
  deadlineText?: string | null;
  deadlineHasTime?: boolean | null;
  timezone?: string | null;
}

/** Older rows have no flag; their deadline text tells whether a time was given. */
export function hasTimeOfDay(h: DeadlineFields) {
  return h.deadlineHasTime ?? statesTime(h.deadlineText);
}

/** "26 Apr 2026" when the page gives only a date; otherwise the date and time in the event's zone. */
export function formatDeadline(h: DeadlineFields, fallbackTz = "Asia/Kolkata") {
  if (!h.deadlineAt) return "Not verified";
  if (hasTimeOfDay(h)) return formatDateTime(h.deadlineAt, h.timezone ?? fallbackTz);
  // A date-only deadline is stored as the end of that day in the event's zone (UTC when unknown).
  return formatDate(h.deadlineAt, h.timezone ?? "UTC");
}

/** Milliseconds the zone is ahead of UTC at a given instant. */
function zoneOffsetMs(utcMs: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - utcMs;
}

/** A wall-clock time in an IANA zone (23:59 by default: the end of that day), as an instant. */
export function endOfDay(year: number, month: number, day: number, timeZone: string, hour = 23, minute = 59) {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  try {
    let at = wall - zoneOffsetMs(wall, timeZone);
    const again = wall - zoneOffsetMs(at, timeZone); // DST: the offset at the result may differ
    if (again !== at) at = again;
    return new Date(at);
  } catch {
    return new Date(wall); // unknown zone: UTC
  }
}

/**
 * The instant to store for an extracted deadline. With a stated time, the extracted instant is
 * used as is; with only a date, the end of that day in the event's zone (UTC when unknown).
 */
export interface WrittenDate {
  year: number | null;
  month: number;
  day: number;
  hour?: number | null;
  minute?: number | null;
}

export function resolveDeadline(d: { value: string; quote?: string | null; dateIso: string; written?: WrittenDate[] }, timeZone: string | null): { at: Date; hasTime: boolean } | null {
  const hasTime = statesTime(d.value) || statesTime(d.quote);
  if (hasTime && /T\d{2}:\d{2}/.test(d.dateIso)) {
    const at = new Date(d.dateIso);
    return Number.isNaN(at.getTime()) ? null : { at, hasTime };
  }
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(d.dateIso.trim());
  if (!ymd) return null;
  const iso = { year: Number(ymd[1]), month: Number(ymd[2]), day: Number(ymd[3]) };
  // A date written in the text corrects the ISO date only by a day (an instant already shifted
  // into another zone); text such as "Apr 26 (runs Apr 17–26)" also names other dates.
  const isoDay = Date.UTC(iso.year, iso.month - 1, iso.day);
  const near = (d.written ?? [])
    .map((w) => ({ w, gap: Math.abs(Date.UTC(w.year ?? iso.year, w.month - 1, w.day) - isoDay) }))
    .filter((x) => x.gap <= 86_400_000)
    .sort((a, b) => a.gap - b.gap)[0]?.w;
  const year = near?.year ?? iso.year;
  const month = near?.month ?? iso.month;
  const day = near?.day ?? iso.day;
  // A stated time with a date-only instant: use the time as written, in the event's zone.
  const at = hasTime && near?.hour != null ? endOfDay(year, month, day, timeZone ?? "UTC", near.hour, near.minute ?? 0) : endOfDay(year, month, day, timeZone ?? "UTC");
  return { at, hasTime: hasTime && near?.hour != null };
}

/** Whether a deadline is still ahead. Unknown deadlines are not "upcoming". */
export function isUpcoming(h: { deadlineAt: Date | string | null }, now = new Date()) {
  return Boolean(h.deadlineAt && new Date(h.deadlineAt).getTime() > now.getTime());
}
