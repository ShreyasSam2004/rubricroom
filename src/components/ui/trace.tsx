"use client";

import { CircleCheck, CircleDashed, CircleX, Loader2, MinusCircle } from "lucide-react";
import { useElapsed } from "@/components/ui/ai-progress";
import { cn } from "@/lib/utils";

export type TraceStatus = "pending" | "running" | "done" | "failed" | (string & {});

export function TraceIcon({ status }: { status: TraceStatus }) {
  if (status === "running") return <Loader2 className="size-4 animate-spin text-primary" />;
  if (status === "done") return <CircleCheck className="size-4 text-teal" />;
  if (status === "failed") return <CircleX className="size-4 text-coral" />;
  if (status === "pending") return <CircleDashed className="size-4 text-muted-foreground" />;
  return <MinusCircle className="size-4 text-unverified" />;
}

/** A live clock on the running step, so a long AI step never looks frozen. */
export function RunningFor({ since, slowAfter = 15, slowNote = "still working; AI steps like this usually finish within a minute" }: { since: number; slowAfter?: number; slowNote?: string }) {
  const s = useElapsed(since);
  return (
    <span className="text-[11px] tabular-nums text-primary" data-testid="step-elapsed">
      {s}s{s >= slowAfter ? ` · ${slowNote}` : ""}
    </span>
  );
}

export interface TraceStep {
  key: string;
  label: string;
  agent?: string;
  status: TraceStatus;
  detail?: string | null;
  /** When the step started running (Date.now()), for its clock. */
  since?: number | null;
}

/** What the agents are doing right now, step by step: the same trace the research jobs show. */
export function Trace({ title, steps, className }: { title?: string; steps: TraceStep[]; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("rounded-xl border bg-card p-4", className)} data-testid="trace">
      {title && <div className="mb-3 text-sm font-medium">{title}</div>}
      <ol className="space-y-2.5">
        {steps.map((s) => (
          <li key={s.key} className="flex gap-3" data-testid={`trace-${s.key}`} data-status={s.status}>
            <div className="mt-0.5">
              <TraceIcon status={s.status} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className={cn(s.status === "pending" && "text-muted-foreground")}>{s.label}</span>
                {s.agent && <span className="text-[11px] text-muted-foreground">{s.agent}</span>}
                {s.status === "running" && s.since && <RunningFor since={s.since} />}
              </div>
              {s.detail && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.detail}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
