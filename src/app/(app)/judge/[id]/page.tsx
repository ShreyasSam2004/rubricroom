import { notFound } from "next/navigation";
import { SampleBanner } from "@/components/examples/example-banner";
import { DebateRoom } from "@/components/judge/debate-room";
import { isAIConfigured } from "@/lib/ai";
import { pageContext } from "@/lib/page-context";
import { getDebateBundle } from "@/lib/services/debates";
import { rubricContext, versionToFields } from "@/lib/services/ideas";
import { isShowcaseHackathon } from "@/lib/services/showcase";

export const metadata = { title: "Judge's Room" };

export default async function DebatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspaceId } = await pageContext();
  const b = await getDebateBundle(workspaceId, id);
  if (!b) notFound();
  const { criteria, hackathon } = await rubricContext(workspaceId, b.idea.hackathonId, b.session.track);
  const revById = new Map(b.revisions.map((r) => [r.id, r]));
  const room = (
    <DebateRoom
      sessionId={b.session.id}
      ideaId={b.idea.id}
      ideaName={b.idea.name}
      version={b.version.version}
      fields={versionToFields(b.version)}
      mode={b.session.mode}
      intensity={b.session.intensity}
      focus={b.session.focus}
      turns={b.turns.map((t) => ({
        id: t.id,
        speaker: t.speaker as "user" | "judge" | "system",
        judgeRole: t.judgeRole,
        text: t.text,
        claims: t.claims,
        revisionChanges: t.revisionId ? revById.get(t.revisionId)?.changes ?? null : null,
        ideaUpdate: t.ideaUpdate ?? null,
        method: t.method,
        createdAt: t.createdAt.toISOString(),
      }))}
      current={b.current ? { results: b.current.criterionResults, total: b.current.weightedTotal, basis: b.current.weightBasis, method: b.current.method, heuristics: b.current.heuristics } : null}
      initial={b.initial ? { results: b.initial.criterionResults, total: b.initial.weightedTotal } : null}
      criteria={criteria.map((c) => ({ id: c.id, name: c.name }))}
      accepted={b.session.acceptedClaims}
      rejected={b.session.rejectedClaims}
      concerns={b.session.outstandingConcerns}
      nextActions={b.session.nextActions}
      aiConfigured={isAIConfigured()}
      hackathonName={hackathon?.name ?? null}
      opening={!b.current || !b.turns.some((t) => t.speaker === "judge")}
    />
  );
  return hackathon && isShowcaseHackathon(hackathon) ? (
    <div className="space-y-4">
      <SampleBanner compact />
      {room}
    </div>
  ) : (
    room
  );
}
