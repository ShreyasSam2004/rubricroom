import type { CitationClaim } from "@/components/research/claim-citation";
import { authorityLabel } from "@/lib/research/verify";
import type { claims, researchSources } from "@/lib/db/schema";

type ClaimRow = typeof claims.$inferSelect;
type SourceRow = Omit<typeof researchSources.$inferSelect, "extractedText">;

/** Serializable claim → citation map for client citation popovers. */
export function citationMap(claimRows: ClaimRow[], sources: SourceRow[]): Record<string, CitationClaim> {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const out: Record<string, CitationClaim> = {};
  for (const c of claimRows) {
    const s = c.sourceId ? byId.get(c.sourceId) : undefined;
    out[c.id] = {
      id: c.id,
      field: c.field,
      value: c.value,
      quote: c.quote,
      verification: c.verification,
      method: c.method,
      note: c.note,
      source: s
        ? { title: s.title, url: s.url, finalUrl: s.finalUrl, retrievedAt: s.retrievedAt?.toISOString() ?? null, cached: s.cached, authorityLabel: `Authority ${s.authority}: ${authorityLabel(s.authority)}` }
        : null,
    };
  }
  return out;
}

export function firstClaim(map: Record<string, CitationClaim>, field: string) {
  return Object.values(map).find((c) => c.field === field && c.verification !== "conflict") ?? Object.values(map).find((c) => c.field === field);
}
