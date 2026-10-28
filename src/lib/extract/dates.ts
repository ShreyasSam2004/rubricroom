// Deterministic date mention parser. Used both as the offline extractor and to verify
// AI-extracted dates against the retrieved source text.

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11,
  november: 11, dec: 12, december: 12,
};

export const TZ_OFFSETS: Record<string, string> = {
  IST: "+05:30", UTC: "+00:00", GMT: "+00:00", Z: "+00:00", PST: "-08:00", PDT: "-07:00", PT: "-07:00",
  EST: "-05:00", EDT: "-04:00", ET: "-04:00", CST: "-06:00", CDT: "-05:00", MST: "-07:00", MDT: "-06:00",
  CET: "+01:00", CEST: "+02:00", BST: "+01:00", AEST: "+10:00", AEDT: "+11:00", SGT: "+08:00", JST: "+09:00",
  KST: "+09:00", WAT: "+01:00", EAT: "+03:00", GST: "+04:00", PKT: "+05:00", NPT: "+05:45",
};

export const TZ_NAMES: Record<string, string> = {
  IST: "Asia/Kolkata", UTC: "UTC", GMT: "UTC", PST: "America/Los_Angeles", PDT: "America/Los_Angeles", PT: "America/Los_Angeles",
  EST: "America/New_York", EDT: "America/New_York", ET: "America/New_York", CET: "Europe/Paris", CEST: "Europe/Paris",
  BST: "Europe/London", SGT: "Asia/Singapore", JST: "Asia/Tokyo",
};

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Turn whatever a source or model wrote ("IST (India Standard Time, UTC+05:30)") into an IANA zone, or null. */
export function normalizeTimezone(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (TZ_NAMES[v.toUpperCase()]) return TZ_NAMES[v.toUpperCase()];
  if (/^[A-Za-z]+\/[A-Za-z_]+/.test(v) && isValidTimeZone(v.split(/\s/)[0])) return v.split(/\s/)[0];
  const abbr = (v.match(/\b[A-Z]{2,5}\b/g) ?? []).find((a) => TZ_NAMES[a]);
  if (abbr) return TZ_NAMES[abbr];
  if (/india/i.test(v) || /\+0?5:30/.test(v)) return "Asia/Kolkata";
  return isValidTimeZone(v) && /\//.test(v) ? v : null;
}

export function normalizeFormat(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (/hybrid/.test(v) || (/(online|virtual|remote)/.test(v) && /(in[- ]person|offline|on[- ]site|venue)/.test(v))) return "hybrid";
  if (/(online|virtual|remote)/.test(v)) return "online";
  if (/(in[- ]person|offline|on[- ]site|venue)/.test(v)) return "in-person";
  return value.length <= 24 ? value : null;
}

export interface DateMention {
  index: number;
  raw: string;
  year: number | null;
  month: number;
  day: number;
  hour: number | null;
  minute: number | null;
  tz: string | null;
}

const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const WEEKDAY_RE = "(?:(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|nesday|sday|urday)?\\.?,?\\s+)?";
const TIME_RE =
  "(?:\\s*,?\\s*(?:at\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)?\\s*\\(?(?:(" +
  Object.keys(TZ_OFFSETS).join("|") +
  ")\\b)?\\)?)?";

const DAY_MONTH = new RegExp(`\\b${WEEKDAY_RE}(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\b\\.?,?(?:\\s+(\\d{4}))?${TIME_RE}`, "gi");
const MONTH_DAY = new RegExp(`\\b${WEEKDAY_RE}${MONTH_RE}\\.?\\s+(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?,?(?:\\s+(\\d{4}))?${TIME_RE}`, "gi");
const ISO = /\b(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/g;

function toHour(h: string | undefined, ampm: string | undefined): number | null {
  if (h === undefined) return null;
  let hour = Number(h);
  if (hour > 23) return null;
  const ap = ampm?.toLowerCase().replace(/\./g, "");
  if (ap === "pm" && hour < 12) hour += 12;
  if (ap === "am" && hour === 12) hour = 0;
  return hour;
}

export function findDateMentions(text: string): DateMention[] {
  const out: DateMention[] = [];
  const push = (m: Omit<DateMention, "hour" | "minute" | "tz"> & { h?: string; mi?: string; ap?: string; tz?: string }) => {
    if (m.day < 1 || m.day > 31 || m.month < 1 || m.month > 12) return;
    // A bare number before "am/pm" without a timezone or colon is ambiguous with list numbering; require ":" or am/pm.
    const hasTime = m.h !== undefined && (m.mi !== undefined || m.ap !== undefined);
    out.push({
      index: m.index,
      raw: m.raw.trim(),
      year: m.year,
      month: m.month,
      day: m.day,
      hour: hasTime ? toHour(m.h, m.ap) : null,
      minute: hasTime ? Number(m.mi ?? 0) : null,
      tz: m.tz ? m.tz.toUpperCase() : null,
    });
  };
  for (const m of text.matchAll(DAY_MONTH)) {
    push({ index: m.index!, raw: m[0], day: Number(m[1]), month: MONTHS[m[2].toLowerCase()], year: m[3] ? Number(m[3]) : null, h: m[4], mi: m[5], ap: m[6], tz: m[7] });
  }
  for (const m of text.matchAll(MONTH_DAY)) {
    if (out.some((o) => Math.abs(o.index - m.index!) < 4)) continue;
    push({ index: m.index!, raw: m[0], month: MONTHS[m[1].toLowerCase()], day: Number(m[2]), year: m[3] ? Number(m[3]) : null, h: m[4], mi: m[5], ap: m[6], tz: m[7] });
  }
  for (const m of text.matchAll(ISO)) {
    out.push({ index: m.index!, raw: m[0], year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: m[4] ? Number(m[4]) : null, minute: m[5] ? Number(m[5]) : null, tz: null });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** "16 to 31 October" style ranges. */
export function findDateRanges(text: string) {
  // "17-26 April 2026"
  const dayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:to|-|–|—|until|through)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\.?(?:\\s+(\\d{4}))?`, "gi");
  // "Apr 17 - Apr 26, 2026" or "Apr 17-26, 2026"
  const monthFirst = new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:to|-|–|—|until|through)\\s*(?:${MONTH_RE}\\.?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, "gi");
  const ranges = [
    ...[...text.matchAll(dayFirst)].map((m) => {
      const month = MONTHS[m[3].toLowerCase()];
      return { index: m.index!, raw: m[0], startDay: Number(m[1]), endDay: Number(m[2]), month, endMonth: month, year: m[4] ? Number(m[4]) : null };
    }),
    ...[...text.matchAll(monthFirst)].map((m) => {
      const month = MONTHS[m[1].toLowerCase()];
      return { index: m.index!, raw: m[0], startDay: Number(m[2]), endDay: Number(m[4]), month, endMonth: m[3] ? MONTHS[m[3].toLowerCase()] : month, year: m[5] ? Number(m[5]) : null };
    }),
  ];
  return ranges.filter((r) => r.startDay >= 1 && r.startDay <= 31 && r.endDay >= 1 && r.endDay <= 31).sort((a, b) => a.index - b.index);
}

/** Most common plausible year mentioned in the text(s), used when a date omits its year. */
export function inferYear(texts: string[], now = new Date()): { year: number; inferred: "stated" | "context" | "current" } {
  const counts = new Map<number, number>();
  for (const t of texts) {
    for (const m of t.matchAll(/\b(20[2-3]\d)\b/g)) counts.set(Number(m[1]), (counts.get(Number(m[1])) ?? 0) + 1);
  }
  if (counts.size) {
    const [year] = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    return { year, inferred: "context" };
  }
  return { year: now.getFullYear(), inferred: "current" };
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/**
 * Convert a mention to an ISO instant. When the time is missing we use 23:59 local and say so;
 * when the timezone is missing we fall back to `defaultTz` (or UTC) and say so.
 */
export function mentionToIso(m: DateMention, fallbackYear: number, defaultTz?: string | null) {
  const year = m.year ?? fallbackYear;
  const notes: string[] = [];
  if (m.year === null) notes.push(`year not stated next to the date; ${year} inferred from page context`);
  const hour = m.hour ?? 23;
  const minute = m.minute ?? 59;
  if (m.hour === null) notes.push("time not stated; end of day assumed");
  const tz = m.tz ?? defaultTz ?? null;
  const offset = tz ? TZ_OFFSETS[tz] : undefined;
  if (!m.tz) notes.push(tz ? `timezone not stated next to the date; ${tz} used from elsewhere on the page` : "timezone not stated; UTC assumed");
  const iso = `${year}-${pad(m.month)}-${pad(m.day)}T${pad(hour)}:${pad(minute)}:00${offset ?? "+00:00"}`;
  const d = new Date(iso);
  return { iso: Number.isNaN(d.getTime()) ? null : d.toISOString(), tz, notes };
}

export function describeMention(m: DateMention, fallbackYear: number) {
  const months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const base = `${m.day} ${months[m.month]} ${m.year ?? fallbackYear}`;
  if (m.hour === null) return base;
  return `${base}, ${pad(m.hour)}:${pad(m.minute ?? 0)}${m.tz ? ` ${m.tz}` : ""}`;
}
