import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { claims, hackathonRules, hackathons, judgingCriteria } from "@/lib/db/schema";
import type { Extraction, SourceForExtraction } from "@/lib/extract/contract";
import { findDateMentions, normalizeFormat, normalizeTimezone } from "@/lib/extract/dates";
import { resolveDeadline } from "@/lib/deadline";
import { isPlaceholder, newId } from "@/lib/text";
import type { ClaimMethod, ClaimVerification, Confidence, DossierItem, EventDossier, SubmissionRequirement, WeightBasis } from "@/lib/types";
import { matchQuote, resolveConflicts, verificationFor, type ComparableClaim } from "./verify";

interface ClaimDraft {
  id: string;
  field: string;
  value: string;
  sourceId: string | null;
  quote: string | null;
  verification: ClaimVerification;
  confidence: Confidence;
  method: ClaimMethod;
  note: string | null;
  dateIso?: string | null;
}

/**
 * Persist an extraction: verify each quote against the retrieved text, resolve conflicting
 * single-valued fields by source authority, and write claims, rules, criteria and the dossier.
 * Re-running research replaces the previous extraction for this hackathon (sources are kept).
 */
export async function persistExtraction(opts: {
  workspaceId: string;
  hackathonId: string;
  sources: SourceForExtraction[];
  extraction: Extraction;
  method: "ai" | "heuristic";
  notes: string[];
}) {
  const { workspaceId, hackathonId, sources, extraction: x } = opts;
  const db = await getDb();
  const byRef = new Map(sources.map((s) => [s.ref, s]));
  const drafts: ClaimDraft[] = [];

  const make = (field: string, value: string, sourceRef: number, quote: string, confidence: Confidence = "medium", note: string | null = null, opt: { viaMarkup?: boolean; dateIso?: string | null } = {}) => {
    const src = byRef.get(sourceRef);
    const match = src ? matchQuote(quote, `${src.text}\n${src.markupHints.map((h) => h.text).join("\n")}`) : "missing";
    let verification = src ? verificationFor(match, src.authority, opt.viaMarkup) : "not_verified";
    if (verification === "verified" && note && /assumed/i.test(note)) verification = "partially_verified";
    const draft: ClaimDraft = {
      id: newId("clm"),
      field,
      value,
      sourceId: src?.sourceId ?? null,
      quote: quote || null,
      verification,
      confidence: match === "missing" ? "low" : confidence,
      method: opt.viaMarkup ? "markup_recovered" : opts.method,
      note: match === "missing" && src ? `${note ? `${note} ` : ""}Quote not found in the retrieved text — treat as unverified.` : note,
      dateIso: opt.dateIso ?? null,
    };
    drafts.push(draft);
    return draft;
  };

  for (const f of x.facts) make(f.field, f.value, f.sourceRef, f.quote, f.confidence, f.note, { dateIso: f.dateIso });
  const item = (field: string) => (i: { text: string; sourceRef: number; quote: string }): DossierItem => ({ text: i.text, claimIds: [make(field, i.text, i.sourceRef, i.quote).id] });

  const dossier: EventDossier = {
    summary: x.summary,
    whatToBuild: x.whatToBuild,
    tracks: x.tracks.map((t) => ({ name: t.name, audience: t.audience, description: t.description, claimIds: [make("track", t.name, t.sourceRef, t.quote).id] })),
    prizes: x.prizes.map(item("prize")),
    submission: x.submission.filter((s, i, all) => all.findIndex((o) => o.label.toLowerCase() === s.label.toLowerCase() || (s.key !== "other" && o.key === s.key)) === i).map(
      (s): SubmissionRequirement => ({ key: s.key, label: s.label, detail: s.detail ?? undefined, required: s.required, claimIds: [make("submission", s.label, s.sourceRef, s.quote, "high", s.detail).id] }),
    ),
    sponsors: x.sponsors.map((s) => ({ name: s.name, technology: s.technology, usageRequirement: s.usageRequirement, claimIds: [make("sponsor", s.name, s.sourceRef, s.quote).id] })),
    judgesReward: x.judgesReward.map(item("judges_reward")),
    prohibited: x.prohibited.map(item("prohibited")),
    mandatory: x.mandatory.map(item("mandatory")),
    recommendations: x.recommendations.map(item("recommendation")),
    uncertainties: x.uncertainties,
    timeline: x.timeline.map((t) => ({ label: t.label, date: t.dateIso, dateText: t.dateText, claimIds: [make("timeline", `${t.dateText}: ${t.label}`, t.sourceRef, t.quote, "medium", null, { dateIso: t.dateIso }).id] })),
    conflicts: [],
    extractionNotes: [...opts.notes, ...sources.flatMap((s) => s.markupHints.filter((h) => !h.label).map((h) => `${s.title ?? s.url}: ${h.text}`))],
  };

  // Criteria
  const criteriaRows = x.criteria.map((c, i) => {
    const viaMarkup = c.weightFromMarkupHint;
    const claim = make("criterion", `${c.name} — ${c.weight !== null ? `${c.weight}%` : "weight not published"}`, c.sourceRef, c.quote, "high", viaMarkup ? "Weight recovered from the judging page markup; the visible text shows an animated 0%." : null, {
      viaMarkup: false,
    });
    if (viaMarkup) claim.method = "markup_recovered";
    const weightBasis: WeightBasis = c.weight === null ? "illustrative" : viaMarkup ? "markup_recovered" : "official";
    return {
      id: newId("crit"),
      workspaceId,
      hackathonId,
      track: c.track,
      name: c.name,
      description: c.description,
      weight: c.weight,
      weightBasis,
      position: i,
      claimIds: [claim.id],
      verification: claim.verification,
      quote: c.quote,
    };
  });

  const ruleRows = x.rules.map((r, i) => {
    const claim = make("rule", r.text, r.sourceRef, r.quote, "medium");
    return {
      id: newId("rule"),
      workspaceId,
      hackathonId,
      category: r.category,
      text: r.text,
      applicability: r.applicability,
      level: r.level,
      claimIds: [claim.id],
      verification: claim.verification,
      position: i,
    };
  });

  // Conflicts between sources for single-valued fields.
  const comparable: ComparableClaim[] = drafts
    .filter((d) => d.sourceId)
    .map((d) => {
      const src = sources.find((s) => s.sourceId === d.sourceId)!;
      return {
        id: d.id,
        field: d.field,
        value: d.value,
        dateIso: d.dateIso,
        source: { id: src.sourceId, title: src.title ?? src.url, url: src.url, authority: src.authority, publishedAt: src.publishedAt, retrievedAt: src.retrievedAt },
      };
    });
  const { conflicts, losingClaimIds, preferredByField } = resolveConflicts(comparable);
  dossier.conflicts = conflicts;
  for (const d of drafts) if (losingClaimIds.includes(d.id)) d.verification = "conflict";

  const preferred = (field: string) => {
    const p = preferredByField.get(field);
    return p ? drafts.find((d) => d.id === p.id) : drafts.find((d) => d.field === field);
  };
  const deadline = preferred("deadline");
  const tz = preferred("timezone");
  // A zone the source gives for one session only ("BST for kickoff livestream only") isn't the event's.
  const partialZone = tz && /\b(only|not (specified|stated|given)|unclear|unknown)\b/i.test(`${tz.value} ${tz.note ?? ""}`);
  const timezone = (partialZone ? null : normalizeTimezone(tz?.value)) ?? (deadline?.dateIso ? normalizeTimezone(deadline.value) : null);
  const due = deadline?.dateIso ? resolveDeadline({ value: deadline.value, quote: deadline.quote, dateIso: deadline.dateIso, written: findDateMentions(deadline.value) }, timezone) : null;
  const formatClaim = preferred("format");
  const location = preferred("location");
  const reg = preferred("registration");

  await db.transaction(async (tx) => {
    await tx.delete(claims).where(and(eq(claims.workspaceId, workspaceId), eq(claims.hackathonId, hackathonId)));
    await tx.delete(hackathonRules).where(and(eq(hackathonRules.workspaceId, workspaceId), eq(hackathonRules.hackathonId, hackathonId)));
    await tx.delete(judgingCriteria).where(and(eq(judgingCriteria.workspaceId, workspaceId), eq(judgingCriteria.hackathonId, hackathonId)));
    if (drafts.length) {
      await tx.insert(claims).values(
        drafts.map((d) => ({ id: d.id, workspaceId, hackathonId, field: d.field, value: d.value, sourceId: d.sourceId, quote: d.quote, verification: d.verification, confidence: d.confidence, method: d.method, note: d.note })),
      );
    }
    if (criteriaRows.length) await tx.insert(judgingCriteria).values(criteriaRows);
    if (ruleRows.length) await tx.insert(hackathonRules).values(ruleRows);
    await tx
      .update(hackathons)
      .set({
        name: isPlaceholder(x.name) ? undefined : x.name,
        organizer: isPlaceholder(x.organizer) ? null : x.organizer,
        description: x.summary || null,
        format: normalizeFormat(formatClaim?.value),
        location: location?.value ?? null,
        timezone,
        deadlineAt: due?.at ?? null,
        deadlineText: deadline?.value ?? null,
        deadlineHasTime: due ? due.hasTime : null,
        registrationStatus: reg?.value ?? null,
        dossier,
        updatedAt: new Date(),
      })
      .where(and(eq(hackathons.id, hackathonId), eq(hackathons.workspaceId, workspaceId)));
  });

  return { claims: drafts.length, criteria: criteriaRows.length, rules: ruleRows.length, conflicts: conflicts.length, verified: drafts.filter((d) => d.verification === "verified").length };
}
