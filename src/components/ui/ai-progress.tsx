"use client";

import { useSyncExternalStore } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

function subscribe(cb: () => void) {
  const t = setInterval(cb, 1000);
  return () => clearInterval(t);
}

/** Whole seconds since `since` (a Date.now() timestamp taken when the action started). */
export function useElapsed(since: number) {
  return useSyncExternalStore(
    subscribe,
    () => Math.max(0, Math.floor((Date.now() - since) / 1000)),
    () => 0,
  );
}

/**
 * Shown under a button while an AI agent works, so a 10–30 s call never looks frozen: what is
 * happening, how long it has taken, and how long it usually takes. Render it only while busy.
 */
export function AiProgress({ since, label, detail, expected, className }: { since: number; label: string; detail?: string; expected: string; className?: string }) {
  const s = useElapsed(since);
  return (
    <div role="status" aria-live="polite" className={cn("flex items-start gap-2 rounded-lg border border-primary/20 bg-primary-soft/40 px-3 py-2 text-sm", className)} data-testid="ai-progress">
      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" aria-hidden />
      <div className="min-w-0">
        <div>
          <span className="font-medium">{label}</span> <span className="tabular-nums text-muted-foreground">· {s}s</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {detail ? `${detail} ` : ""}Usually {expected}.{s > 60 ? " Taking longer than usual; it will still finish or show an error." : ""}
        </div>
      </div>
    </div>
  );
}
