"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Flag, Quote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/overlays";
import { Input } from "@/components/ui/primitives";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";
import type { ClaimVerification } from "@/lib/types";
import { MethodBadge, VerificationBadge } from "./badges";

export interface CitationClaim {
  id: string;
  field: string;
  value: string;
  quote: string | null;
  verification: ClaimVerification;
  method: string;
  note: string | null;
  source: { title: string | null; url: string; finalUrl: string | null; retrievedAt: string | null; cached: boolean; authorityLabel: string } | null;
}

const DOT: Record<ClaimVerification, string> = {
  verified: "bg-teal",
  partially_verified: "bg-amber",
  conflict: "bg-coral",
  user_flagged: "bg-coral",
  not_verified: "bg-unverified",
};

/** Inline citation marker. Opens the exact source quote, retrieval time and verification method. */
export function ClaimCitation({ claim, label, className }: { claim: CitationClaim | undefined; label?: string; className?: string }) {
  const router = useRouter();
  const [reporting, setReporting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (!claim) {
    return (
      <span className={cn("inline-flex items-center gap-1 align-middle text-[11px] text-unverified", className)} title="No source">
        <span className="size-1.5 rounded-full bg-unverified" /> Not verified
      </span>
    );
  }
  const url = claim.source?.finalUrl ?? claim.source?.url ?? "";
  const isWeb = /^https?:/.test(url);
  return (
    <Popover
      trigger={
        <button type="button" className={cn("inline-flex items-center gap-1 rounded-full border bg-card px-1.5 py-0.5 align-middle text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground", className)} aria-label={`Source for ${label ?? claim.field}`} data-testid="citation">
          <span className={cn("size-1.5 rounded-full", DOT[claim.verification])} aria-hidden />
          {label ?? "source"}
        </button>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <VerificationBadge status={claim.verification} />
          <MethodBadge method={claim.method} />
        </div>
        {claim.quote && (
          <blockquote className="flex gap-2 rounded-lg bg-muted/60 p-2.5 text-[13px] leading-relaxed">
            <Quote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span>{claim.quote}</span>
          </blockquote>
        )}
        {claim.note && <p className="text-xs text-muted-foreground">{claim.note}</p>}
        {claim.source && (
          <div className="space-y-0.5 text-xs">
            <div className="font-medium text-foreground">{claim.source.title ?? url}</div>
            <div className="text-muted-foreground">
              {claim.source.authorityLabel}
              {claim.source.retrievedAt && ` · retrieved ${new Date(claim.source.retrievedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`}
              {claim.source.cached && " · cached"}
            </div>
            {isWeb && (
              <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                Open source page <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        )}
        {claim.verification !== "user_flagged" &&
          (reporting ? (
            <div className="flex gap-2">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's wrong?" className="h-8 text-xs" autoFocus />
              <Button
                size="sm"
                variant="destructive"
                loading={busy}
                disabled={note.trim().length < 3}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api(`/api/claims/${claim.id}`, { note });
                    router.refresh();
                  } finally {
                    setBusy(false);
                    setReporting(false);
                  }
                }}
              >
                Report
              </Button>
            </div>
          ) : (
            <button type="button" onClick={() => setReporting(true)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-coral">
              <Flag className="size-3" /> Report incorrect extraction
            </button>
          ))}
      </div>
    </Popover>
  );
}
