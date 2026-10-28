import crypto from "node:crypto";

export function newId(prefix = ""): string {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  return prefix ? `${prefix}_${id}` : id;
}

export function sha256(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** Lowercase, strip diacritics/punctuation, collapse whitespace. Unicode-aware (keeps Devanagari etc.). */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^\p{L}\p{N}%₹$.:'\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set(
  "a an the and or but if then else of for to in on at by with from into over under about as is are was were be been being this that these those it its it's i you he she they we our your their my me us them do does did doing have has had having can could should would will shall may might must not no nor so than too very just also only own same such both each few more most other some any all what which who whom whose when where why how there here up down out off again further once s t don now app tool tools platform using use based ai".split(
    " ",
  ),
);

export function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[\s.:'-]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

/** Tiny suffix stemmer — enough to match "interviews"/"interview", "planning"/"plan". */
export function stem(word: string): string {
  if (word.length <= 4) return word;
  for (const suffix of ["ations", "ation", "ings", "ing", "ers", "er", "ies", "es", "ed", "ly", "s"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      const base = word.slice(0, -suffix.length);
      return suffix === "ies" ? `${base}y` : base;
    }
  }
  return word;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function uniqueBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/** Canonical form for URL de-duplication: no hash, no tracking params, no trailing slash, lowercase host. */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_|ref$|ref_|fbclid|gclid|dub_id|promo_code)/i.test(p)) u.searchParams.delete(p);
    }
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return raw.trim();
  }
}

/**
 * A model's stand-in for a missing value, not a value: "[Name not explicitly stated on page]",
 * "Not specified", "Unknown", "N/A".
 */
export function isPlaceholder(value: string | null | undefined): boolean {
  const v = value?.trim() ?? "";
  if (!v) return true;
  if (/^[[(<{].*[\])>}]$/.test(v)) return true;
  return v.length <= 60 && /^(unknown|n\/?a|none|tbd|tba|unnamed|untitled|not (explicitly )?(stated|specified|mentioned|provided|available|found|given|listed|published)\b.*|no (name|title)\b.*)$/i.test(v);
}

export function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return raw;
  }
}

/** Detect the dominant script of a text so pitches in Hindi/Hinglish are preserved and labelled. */
export function detectLanguage(text: string): "en" | "hi" | "hinglish" | "other" {
  const devanagari = (text.match(/[ऀ-ॿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  const otherScripts = (text.match(/[^\u0000-ɏऀ-ॿ\s\d\p{P}\p{S}]/gu) ?? []).length;
  const total = devanagari + latin + otherScripts;
  if (total === 0) return "en";
  if (otherScripts / total > 0.3) return "other";
  if (devanagari / total > 0.6) return "hi";
  if (devanagari > 0) return "hinglish";
  const hinglishMarkers = /\b(hai|hain|nahi|nahin|kya|karna|karta|karti|karte|mujhe|mera|meri|apna|bahut|kaise|chahiye|chahta|chahti|matlab|yaar|accha|kuch|aur|lekin|hoon|hun|raha|rahi|jaate|jaati|kyunki|toh|bhi|wala|wali)\b/gi;
  const markers = (text.match(hinglishMarkers) ?? []).length;
  return markers >= 2 ? "hinglish" : "en";
}
