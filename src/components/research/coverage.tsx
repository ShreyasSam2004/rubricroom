import type { CoverageItem } from "@/lib/types";
import { COVERAGE_META } from "./badges";
import { cn } from "@/lib/utils";

/** Exactly what the system knows and does not know — no "100% researched" badge. */
export function CoverageList({ items, className }: { items: CoverageItem[]; className?: string }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">Research has not run yet.</p>;
  return (
    <ul className={cn("divide-y", className)}>
      {items.map((c) => {
        const m = COVERAGE_META[c.status];
        return (
          <li key={c.key} className="flex items-start gap-3 py-2.5">
            <m.icon className={cn("mt-0.5 size-4 shrink-0", m.tone === "teal" ? "text-teal" : m.tone === "amber" ? "text-amber" : m.tone === "coral" ? "text-coral" : "text-unverified")} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-x-3 text-sm">
                <span className="font-medium">{c.label}</span>
                <span className="text-xs text-muted-foreground">{m.label}</span>
              </div>
              {c.detail && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{c.detail}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
