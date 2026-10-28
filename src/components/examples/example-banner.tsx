import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { ClipboardList, Gavel, Route, ScrollText, Search } from "lucide-react";
import { Callout } from "@/components/ui/primitives";
import { getDb } from "@/lib/db/client";
import { debateSessions, projectIdeas } from "@/lib/db/schema";
import { EXAMPLE_DISCLOSURE, listExamples } from "@/lib/services/examples";
import { latestPlanFor } from "@/lib/services/plans";
import { formatDate } from "@/lib/utils";

/**
 * Shown on an example run's hackathon and idea pages: what was captured, what was written for the
 * example, and links to every part of the run.
 */
export async function ExampleBanner({ workspaceId, seedKey, hackathonId, ideaId }: { workspaceId: string; seedKey: string | null; hackathonId: string; ideaId?: string | null }) {
  if (!seedKey?.startsWith("example:")) return null;
  const meta = listExamples().find((e) => `example:${e.key}` === seedKey);
  if (!meta) return null;
  const db = await getDb();
  const id =
    ideaId ??
    (await db.select({ id: projectIdeas.id }).from(projectIdeas).where(and(eq(projectIdeas.workspaceId, workspaceId), eq(projectIdeas.hackathonId, hackathonId))).limit(1))[0]?.id ??
    null;
  const [session] = id ? await db.select({ id: debateSessions.id }).from(debateSessions).where(and(eq(debateSessions.workspaceId, workspaceId), eq(debateSessions.ideaId, id))).orderBy(desc(debateSessions.createdAt)).limit(1) : [];
  const plan = id ? await latestPlanFor(workspaceId, id) : null;
  const links = [
    { href: `/hackathons/${hackathonId}`, label: "Event dossier", icon: ScrollText },
    id && { href: `/ideas/${id}`, label: "Idea + assessment", icon: ClipboardList },
    id && { href: `/ideas/${id}?tab=originality`, label: "Competitor research", icon: Search },
    session && { href: `/judge/${session.id}`, label: "Judge's Room session", icon: Gavel },
    plan && { href: `/plan/${plan.id}`, label: "Build plan + demo script", icon: Route },
  ].filter(Boolean) as { href: string; label: string; icon: typeof ScrollText }[];
  return (
    <div data-testid="example-banner">
      <Callout tone="neutral" title={`Example run · ${meta.hackathonName} × ${meta.ideaName} · captured ${formatDate(meta.capturedAt, "Asia/Kolkata")} with ${meta.model}`}>
        <p>{EXAMPLE_DISCLOSURE}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="inline-flex items-center gap-1.5 !no-underline hover:!underline">
              <l.icon className="size-3.5" /> {l.label}
            </Link>
          ))}
        </div>
      </Callout>
    </div>
  );
}
