// Checks extracted values against the retrieved text, and resolves disagreements between sources
// using the source-authority hierarchy. Nothing here calls a model.

import { normalize, tokenize } from "@/lib/text";
import type { ClaimVerification, Conflict, ConflictValue } from "@/lib/types";

export type QuoteMatch = "exact" | "close" | "missing";

/** Does `quote` actually appear in `text`? Exact (normalized) substring, or ≥85% token coverage in one window. */
export function matchQuote(quote: string | null | undefined, text: string): QuoteMatch {
  if (!quote || !text) return "missing";
  const q = normalize(quote);
  const t = normalize(text);
  if (q.length < 3) return "missing";
  if (t.includes(q)) return "exact";
  const qTokens = tokenize(quote);
  if (qTokens.length === 0) return "missing";
  const tTokens = tokenize(text);
  const windowSize = Math.max(qTokens.length + 6, Math.ceil(qTokens.length * 1.6));
  const need = new Map<string, number>();
  for (const tok of qTokens) need.set(tok, (need.get(tok) ?? 0) + 1);
  let best = 0;
  for (let start = 0; start < tTokens.length; start += Math.max(1, Math.floor(qTokens.length / 3))) {
    const window = tTokens.slice(start, start + windowSize);
    const have = new Map<string, number>();
    for (const tok of window) have.set(tok, (have.get(tok) ?? 0) + 1);
    let hit = 0;
    for (const [tok, n] of need) hit += Math.min(n, have.get(tok) ?? 0);
    best = Math.max(best, hit / qTokens.length);
    if (best >= 0.999) break;
  }
  return best >= 0.85 ? "close" : "missing";
}

/**
 * Map a quote match + source authority to a claim verification status.
 * Official sources (authority ≤ 4) with an exact quote → verified.
 */
export function verificationFor(match: QuoteMatch, authority: number, viaMarkup = false): ClaimVerification {
  if (match === "missing") return viaMarkup ? "partially_verified" : "not_verified";
  if (match === "exact" && authority <= 4) return viaMarkup ? "partially_verified" : "verified";
  return "partially_verified";
}

export const SINGLE_VALUED_FIELDS = new Set([
  "deadline",
  "start_date",
  "team_size",
  "format",
  "timezone",
  "location",
  "judging_dates",
  "winner_announcement",
]);

export interface ComparableClaim {
  id: string;
  field: string;
  value: string;
  dateIso?: string | null;
  source: { id: string; title: string; url: string; authority: number; publishedAt?: string | null; retrievedAt?: string | null };
}

function comparableValue(c: ComparableClaim): string {
  if (c.dateIso) return c.dateIso.slice(0, 16); // to the minute
  return normalize(c.value).replace(/\s+/g, " ");
}

const AUTHORITY_LABEL: Record<number, string> = {
  1: "current official rules / schedule",
  2: "official event, judging or track page",
  3: "official event update",
  4: "official FAQ",
  5: "organizer blog post",
  6: "secondary coverage",
  7: "community discussion",
};

export function authorityLabel(a: number) {
  return AUTHORITY_LABEL[a] ?? "unranked source";
}

function newer(a?: string | null, b?: string | null) {
  if (!a) return false;
  if (!b) return true;
  return new Date(a).getTime() > new Date(b).getTime();
}

/**
 * Group claims for single-valued fields; when sources disagree, keep every value, pick the
 * highest-authority (then most recently published) one, and explain why. Returns the conflicts
 * plus the ids of claims that lost (to be marked `conflict`).
 */
export function resolveConflicts(claims: ComparableClaim[]): { conflicts: Conflict[]; losingClaimIds: string[]; preferredByField: Map<string, ComparableClaim> } {
  const byField = new Map<string, ComparableClaim[]>();
  for (const c of claims) {
    if (!SINGLE_VALUED_FIELDS.has(c.field)) continue;
    byField.set(c.field, [...(byField.get(c.field) ?? []), c]);
  }
  const conflicts: Conflict[] = [];
  const losing: string[] = [];
  const preferredByField = new Map<string, ComparableClaim>();
  for (const [field, list] of byField) {
    const ranked = [...list].sort((a, b) => {
      if (a.source.authority !== b.source.authority) return a.source.authority - b.source.authority;
      if (newer(a.source.publishedAt, b.source.publishedAt)) return -1;
      if (newer(b.source.publishedAt, a.source.publishedAt)) return 1;
      if (newer(a.source.retrievedAt, b.source.retrievedAt)) return -1;
      if (newer(b.source.retrievedAt, a.source.retrievedAt)) return 1;
      return 0;
    });
    const preferred = ranked[0];
    preferredByField.set(field, preferred);
    const distinct = new Map<string, ComparableClaim[]>();
    for (const c of ranked) distinct.set(comparableValue(c), [...(distinct.get(comparableValue(c)) ?? []), c]);
    if (distinct.size <= 1) continue;

    const values: ConflictValue[] = ranked.map((c) => ({
      value: c.value,
      sourceId: c.source.id,
      sourceTitle: c.source.title,
      sourceUrl: c.source.url,
      authority: c.source.authority,
      publishedAt: c.source.publishedAt ?? null,
      retrievedAt: c.source.retrievedAt ?? null,
    }));
    const runnerUp = ranked.find((c) => comparableValue(c) !== comparableValue(preferred))!;
    let reason: string;
    if (preferred.source.authority < runnerUp.source.authority) {
      reason = `Preferring "${preferred.value}" from ${preferred.source.title} (${authorityLabel(preferred.source.authority)}) over "${runnerUp.value}" from ${runnerUp.source.title} (${authorityLabel(runnerUp.source.authority)}).`;
    } else if (newer(preferred.source.publishedAt, runnerUp.source.publishedAt)) {
      reason = `Both sources have the same authority; preferring the more recently published one (${preferred.source.title}).`;
    } else {
      reason = `Sources of equal authority disagree and neither is clearly newer. Showing "${preferred.value}" but treat this field as unresolved and check the organizer's latest announcement.`;
    }
    conflicts.push({ field, values, preferred: preferred.value, reason });
    for (const c of ranked) if (comparableValue(c) !== comparableValue(preferred)) losing.push(c.id);
  }
  return { conflicts, losingClaimIds: losing, preferredByField };
}

/** Classify a URL relative to the event's official domain into a source type + authority. */
export function classifySource(url: string, officialHost: string | null, title = "", eventPathPrefix: string | null = null): { sourceType: import("@/lib/types").SourceType; authority: number } {
  let host = "";
  let path = "";
  try {
    const u = new URL(url);
    host = u.hostname.replace(/^www\./, "");
    path = `${u.pathname} ${title}`.toLowerCase();
  } catch {
    return { sourceType: "web_result", authority: 7 };
  }
  const official = officialHost ? host === officialHost || host.endsWith(`.${officialHost}`) || officialHost.endsWith(`.${host}`) : false;
  if (/(^|\.)reddit\.com$|news\.ycombinator\.com$|discord\.(gg|com)$|(^|\.)x\.com$|twitter\.com$/.test(host)) {
    return { sourceType: host.includes("ycombinator") ? "hn_discussion" : "community_discussion", authority: 7 };
  }
  if (official) {
    // Site-wide pages outside the event's own section (platform terms, other events) rank below event pages.
    let pathname = "";
    try {
      pathname = new URL(url).pathname.toLowerCase();
    } catch {
      /* ignore */
    }
    const outsideEvent = eventPathPrefix && eventPathPrefix !== "/" && !pathname.startsWith(eventPathPrefix);
    if (outsideEvent) {
      if (/rules|terms|eligibility|conduct|coc/.test(path)) return { sourceType: "official_rules", authority: 3 };
      return { sourceType: "official_page", authority: 4 };
    }
    if (/rules|terms|official-rules|eligibility/.test(path)) return { sourceType: "official_rules", authority: 1 };
    if (/schedule|timeline|dates|calendar/.test(path)) return { sourceType: "official_schedule", authority: 1 };
    if (/judg|criteria|rubric|scoring/.test(path)) return { sourceType: "official_judging", authority: 2 };
    if (/submit|submission/.test(path)) return { sourceType: "official_submission", authority: 2 };
    if (/update|announcement|news/.test(path)) return { sourceType: "official_page", authority: 3 };
    if (/faq|questions|help/.test(path)) return { sourceType: "official_faq", authority: 4 };
    if (/blog|post|article/.test(path)) return { sourceType: "organizer_blog", authority: 5 };
    return { sourceType: "official_page", authority: 2 };
  }
  if (/devpost\.com$/.test(host) && /\/software\//.test(path)) return { sourceType: "devpost_project", authority: 6 };
  if (/github\.com$/.test(host)) return { sourceType: "github_repo", authority: 6 };
  return { sourceType: "secondary_coverage", authority: 6 };
}
