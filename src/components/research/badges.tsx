import { BadgeCheck, CircleAlert, CircleDashed, CircleHelp, CircleX, Clock, Flag, Lock, MinusCircle } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import type { ClaimVerification, CoverageStatus, EvidenceStatus, OverlapLevel, StepStatus } from "@/lib/types";

export function VerificationBadge({ status, className }: { status: ClaimVerification; className?: string }) {
  switch (status) {
    case "verified":
      return (
        <Badge tone="teal" className={className}>
          <BadgeCheck /> Verified
        </Badge>
      );
    case "partially_verified":
      return (
        <Badge tone="amber" className={className}>
          <CircleAlert /> Partially verified
        </Badge>
      );
    case "conflict":
      return (
        <Badge tone="coral" className={className}>
          <CircleX /> Conflicting sources
        </Badge>
      );
    case "user_flagged":
      return (
        <Badge tone="coral" className={className}>
          <Flag /> Reported incorrect
        </Badge>
      );
    default:
      return (
        <Badge tone="gray" className={className}>
          <CircleHelp /> Not verified
        </Badge>
      );
  }
}

export const COVERAGE_META: Record<CoverageStatus, { label: string; tone: "teal" | "amber" | "gray" | "coral" | "default"; icon: React.ComponentType<{ className?: string }> }> = {
  verified: { label: "Verified", tone: "teal", icon: BadgeCheck },
  partial: { label: "Partially verified", tone: "amber", icon: CircleAlert },
  not_available: { label: "Not available", tone: "gray", icon: MinusCircle },
  not_searched: { label: "Not searched", tone: "default", icon: CircleDashed },
  failed: { label: "Search failed", tone: "coral", icon: CircleX },
  not_configured: { label: "Not configured", tone: "gray", icon: Lock },
};

export function CoverageBadge({ status }: { status: CoverageStatus }) {
  const m = COVERAGE_META[status];
  return (
    <Badge tone={m.tone}>
      <m.icon /> {m.label}
    </Badge>
  );
}

export const STEP_META: Record<StepStatus, { label: string; tone: "teal" | "amber" | "gray" | "coral" | "primary" | "default" }> = {
  pending: { label: "Waiting", tone: "default" },
  running: { label: "Running", tone: "primary" },
  done: { label: "Done", tone: "teal" },
  skipped: { label: "Skipped", tone: "gray" },
  failed: { label: "Failed", tone: "coral" },
  not_configured: { label: "Not configured", tone: "gray" },
  budget_exhausted: { label: "Budget reached", tone: "amber" },
};

export const EVIDENCE_META: Record<EvidenceStatus, { label: string; tone: "teal" | "amber" | "gray" | "coral" | "primary" | "default" }> = {
  missing: { label: "Missing", tone: "coral" },
  planned: { label: "Planned", tone: "default" },
  submitted: { label: "Submitted by you", tone: "primary" },
  auto_verified: { label: "Reachability verified", tone: "teal" },
  needs_human: { label: "Needs human verification", tone: "amber" },
};

export function EvidenceBadge({ status }: { status: EvidenceStatus }) {
  const m = EVIDENCE_META[status];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export const OVERLAP_META: Record<OverlapLevel, { label: string; tone: "coral" | "amber" | "primary" | "gray" }> = {
  strong: { label: "Strong overlap", tone: "coral" },
  moderate: { label: "Moderate overlap", tone: "amber" },
  adjacent: { label: "Adjacent concept", tone: "primary" },
  different: { label: "Different core problem", tone: "gray" },
};

export function OverlapBadge({ level }: { level: OverlapLevel }) {
  const m = OVERLAP_META[level];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function CachedBadge({ at }: { at: Date | string | null }) {
  const d = at ? new Date(at) : null;
  return (
    <Badge tone="gray" title="Previously retrieved and cached — not a live search">
      <Clock /> Cached{d ? ` · ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}
    </Badge>
  );
}

export function MethodBadge({ method }: { method: string | null | undefined }) {
  if (method === "ai") return <Badge tone="primary">AI analysis</Badge>;
  if (method === "markup_recovered") return <Badge tone="amber">Recovered from markup</Badge>;
  if (method === "curated") return <Badge tone="gray">Curated</Badge>;
  return <Badge tone="gray">Rule-based</Badge>;
}
