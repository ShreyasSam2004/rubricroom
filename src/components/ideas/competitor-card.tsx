import { Code2, ExternalLink, Globe, Newspaper, Trophy } from "lucide-react";
import { CachedBadge, OverlapBadge } from "@/components/research/badges";
import { Badge } from "@/components/ui/primitives";
import { DIMENSIONS } from "@/lib/research/similarity";
import { formatDate } from "@/lib/utils";
import type { existingProjects } from "@/lib/db/schema";

type Project = typeof existingProjects.$inferSelect;

const PLATFORM: Record<string, { label: string; icon: typeof Globe }> = {
  github: { label: "GitHub", icon: Code2 },
  devpost: { label: "Devpost", icon: Trophy },
  hackernews: { label: "Hacker News", icon: Newspaper },
  producthunt: { label: "Product Hunt", icon: Globe },
  web: { label: "Web", icon: Globe },
};

export function CompetitorCard({ p }: { p: Project }) {
  const plat = PLATFORM[p.sourcePlatform] ?? PLATFORM.web;
  const stars = typeof p.meta?.stars === "number" ? (p.meta.stars as number) : null;
  return (
    <article className="flex flex-col rounded-xl border bg-card p-4" data-testid="competitor-card">
      <div className="flex items-start gap-3">
        {p.imageUrl ? (
          <img src={p.imageUrl} alt="" className="size-11 shrink-0 rounded-lg border object-cover" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <plat.icon className="size-5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate font-medium">{p.name}</h4>
            {p.similarity && <OverlapBadge level={p.similarity.level} />}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <plat.icon className="size-3" /> {plat.label}
            </span>
            {stars !== null && <span>★ {stars.toLocaleString()}</span>}
            {p.publishedAt && <span>since {formatDate(p.publishedAt)}</span>}
            {p.cached ? <CachedBadge at={p.lastVerifiedAt} /> : <span>checked {formatDate(p.lastVerifiedAt)}</span>}
          </div>
        </div>
      </div>
      {p.description && <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{p.description}</p>}
      {p.similarity && (
        <div className="mt-3 space-y-2 text-xs">
          {p.similarity.overlaps.length > 0 && (
            <div>
              <div className="mb-1 font-medium text-foreground">Overlapping</div>
              <ul className="space-y-1 text-muted-foreground">
                {p.similarity.overlaps.slice(0, 3).map((o, i) => (
                  <li key={i}>• {o}</li>
                ))}
              </ul>
            </div>
          )}
          {p.similarity.differences.length > 0 && (
            <div>
              <div className="mb-1 font-medium text-foreground">Distinguishing</div>
              <ul className="space-y-1 text-muted-foreground">
                {p.similarity.differences.slice(0, 3).map((o, i) => (
                  <li key={i}>• {o}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-1 pt-1">
            {DIMENSIONS.filter((d) => (p.similarity!.dimensions[d.key] ?? -1) >= 0).map((d) => (
              <span key={d.key} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" title="Heuristic structural similarity for this dimension">
                {d.label}: {Math.round((p.similarity!.dimensions[d.key] ?? 0) * 100)}%
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="mt-auto flex items-center justify-between pt-3">
        <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" data-testid="competitor-link">
          Open source <ExternalLink className="size-3" />
        </a>
        <Badge tone="gray" className="text-[10px]">
          {p.similarity?.method === "ai" ? "Scout AI comparison" : "Heuristic comparison"}
        </Badge>
      </div>
    </article>
  );
}
