// Proof — Evidence Auditor. Maps rubric criteria to observable evidence and checks what can be
// checked automatically. A reachable URL is recorded as reachable — never as "the app works".

import * as cheerio from "cheerio";
import { safeFetch, SafeFetchError, HTML_TYPES } from "@/lib/net/safe-fetch";
import type { EvidenceStatus, SubmissionRequirement, UrlCheck } from "@/lib/types";
import { categorizeCriterion, type CriterionCategory } from "./roles";

export interface EvidenceSuggestion {
  title: string;
  artifactType: "url" | "video" | "screenshot" | "note" | "usage_card" | "test_report" | "repo";
}

const TEMPLATES: Record<CriterionCategory, EvidenceSuggestion[]> = {
  problem: [
    { title: "Original workflow description (what you did before this tool)", artifactType: "note" },
    { title: "Time spent on the problem before building (your own estimate)", artifactType: "note" },
    { title: "A real decision or result produced with the product", artifactType: "note" },
    { title: "Feedback from a real user (quote or message)", artifactType: "note" },
  ],
  sponsor: [
    { title: "Genuine usage card / insights screenshot", artifactType: "usage_card" },
    { title: "Feature requests or specs you dictated while building", artifactType: "note" },
    { title: "Recording of the voice-first interaction in the product", artifactType: "video" },
    { title: "Example of a voice-based refinement (before → after)", artifactType: "screenshot" },
  ],
  working: [
    { title: "Public deployed URL (no login)", artifactType: "url" },
    { title: "Successful end-to-end run of the core flow", artifactType: "screenshot" },
    { title: "Automated test results", artifactType: "test_report" },
    { title: "Public repository", artifactType: "repo" },
  ],
  demo: [
    { title: "Demo video URL", artifactType: "video" },
    { title: "Demo script with timings", artifactType: "note" },
    { title: "Runtime under the time limit", artifactType: "note" },
    { title: "The measurable result shown in the demo", artifactType: "note" },
  ],
  originality: [
    { title: "Competitor comparison showing what's different", artifactType: "note" },
    { title: "The differentiating interaction, recorded", artifactType: "video" },
  ],
  other: [{ title: "Evidence that directly addresses this criterion", artifactType: "note" }],
};

export function suggestionsFor(criterionName: string, description = ""): EvidenceSuggestion[] {
  return TEMPLATES[categorizeCriterion(criterionName, description)];
}

/** Reachability check through the SSRF-safe fetcher. Says exactly what was (and wasn't) verified. */
export async function checkUrl(url: string): Promise<UrlCheck> {
  const checkedAt = new Date().toISOString();
  try {
    const res = await safeFetch(url, { maxBytes: 400_000, timeoutMs: 10_000, allowedTypes: [...HTML_TYPES, "application/pdf", "video/", "image/", "application/json"] });
    let title: string | undefined;
    if (res.contentType.includes("html")) {
      const $ = cheerio.load(res.body.toString("utf8"));
      title = ($('meta[property="og:title"]').attr("content") || $("title").first().text() || "").trim().slice(0, 160) || undefined;
    }
    const login = /\/(login|signin|sign-in|auth)\b/i.test(res.finalUrl);
    return {
      checkedAt,
      reachable: true,
      httpStatus: res.status,
      contentType: res.contentType.split(";")[0],
      title,
      detail: login
        ? "Reachable, but it redirected to a sign-in page — judges may not be able to open it without logging in."
        : "Reachable over HTTPS. Reachability doesn't prove the product works; a human should still try the main flow.",
    };
  } catch (e) {
    const err = e as SafeFetchError;
    return { checkedAt, reachable: false, httpStatus: err.status, detail: `Not reachable: ${err.message}` };
  }
}

export function statusAfterCheck(artifactType: string, check: UrlCheck | null, hasUpload: boolean): EvidenceStatus {
  if (hasUpload) return "needs_human"; // a screenshot can't be machine-verified as genuine
  if (!check) return artifactType === "note" ? "submitted" : "submitted";
  if (!check.reachable) return "needs_human";
  return "auto_verified";
}

export interface ReadinessItem {
  key: string;
  label: string;
  detail?: string;
  prepared: boolean;
  evidenceIds: string[];
  status: EvidenceStatus;
}

export function submissionReadiness(requirements: SubmissionRequirement[], evidence: { id: string; deliverableKey: string | null; status: EvidenceStatus }[]) {
  const unique = requirements.filter((r, i, all) => r.required && all.findIndex((o) => o.key === r.key && (r.key !== "other" || o.label === r.label)) === i);
  const items: ReadinessItem[] = unique
    .map((r) => {
      const ev = evidence.filter((e) => e.deliverableKey === r.key);
      const best = ev.find((e) => e.status === "auto_verified") ?? ev.find((e) => e.status === "needs_human" || e.status === "submitted") ?? ev[0];
      return {
        key: r.key,
        label: r.label,
        detail: r.detail,
        prepared: ev.some((e) => e.status === "auto_verified" || e.status === "submitted" || e.status === "needs_human"),
        evidenceIds: ev.map((e) => e.id),
        status: best?.status ?? "missing",
      };
    });
  return { items, prepared: items.filter((i) => i.prepared).length, required: items.length };
}
