"use client";

import { Clock } from "lucide-react";
import { useNow } from "@/lib/hooks";
import { cn, timeRemaining } from "@/lib/utils";

export function Countdown({ deadline, compact = false, className }: { deadline: string; compact?: boolean; className?: string }) {
  const now = useNow(30_000);
  if (!now) return <span className={cn("inline-flex h-5 w-20 animate-pulse-soft rounded bg-muted", className)} aria-hidden />;
  const r = timeRemaining(deadline, now)!;
  const urgent = !r.passed && r.days < 2;
  const label = r.passed ? "Deadline passed" : r.days > 0 ? `${r.days}d ${r.hours}h left` : `${r.hours}h ${r.minutes}m left`;
  if (compact) {
    return (
      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", r.passed ? "bg-muted text-muted-foreground" : urgent ? "bg-coral-soft text-coral" : "bg-amber-soft text-amber-foreground", className)}>
        <Clock className="size-3" aria-hidden />
        {label}
      </span>
    );
  }
  return (
    <div className={cn("flex items-baseline gap-3", className)} aria-live="polite">
      {r.passed ? (
        <span className="text-lg font-semibold text-muted-foreground">Deadline passed</span>
      ) : (
        [
          [r.days, "days"],
          [r.hours, "hours"],
          [r.minutes, "min"],
        ].map(([n, l]) => (
          <span key={l as string} className="flex items-baseline gap-1">
            <span className={cn("text-3xl font-semibold tabular-nums", urgent && "text-coral")}>{n}</span>
            <span className="text-xs text-muted-foreground">{l}</span>
          </span>
        ))
      )}
    </div>
  );
}
