import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { apiHandler, HttpError, zId } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { opportunitySets } from "@/lib/db/schema";
import { createJob } from "@/lib/research/jobs";
import { heuristicFingerprint } from "@/lib/research/similarity";
import { assessCurrentVersion, createIdea } from "@/lib/services/ideas";

export const maxDuration = 300;

export const POST = apiHandler(
  z.discriminatedUnion("action", [
    z.object({
      action: z.literal("generate"),
      hackathonId: zId.nullable(),
      mode: z.enum(["unsolved", "overcrowded", "underserved", "sponsor", "combinations", "alternative"]),
      modifiers: z.array(z.enum(["more", "ambitious", "impact", "less_crowded", "easier", "sponsor", "visual", "commercial"])).max(8).default([]),
      request: z.string().max(2000).nullable().optional(),
      baseIdeaId: zId.nullable().optional(),
      count: z.number().int().min(3).max(8).default(5),
    }),
    z.object({ action: z.literal("save"), setId: zId, index: z.number().int().min(0).max(20) }),
  ]),
  async ({ workspaceId, body }) => {
    if (body.action === "generate") {
      const job = await createJob({
        workspaceId,
        jobType: "opportunities",
        hackathonId: body.hackathonId,
        input: { mode: body.mode, modifiers: body.modifiers, request: body.request ?? null, baseIdeaId: body.baseIdeaId ?? null, count: body.count },
      });
      return { jobId: job.id };
    }
    const db = await getDb();
    const [set] = await db.select().from(opportunitySets).where(and(eq(opportunitySets.id, body.setId), eq(opportunitySets.workspaceId, workspaceId)));
    const card = set?.cards[body.index];
    if (!card) throw new HttpError(404, "Opportunity not found");
    const { ideaId } = await createIdea(workspaceId, {
      hackathonId: set.hackathonId,
      name: card.name,
      origin: "nova",
      opportunity: { ...card, fingerprint: card.fingerprint ?? heuristicFingerprint(card.howItWorks, card.name) },
      fields: {
        name: card.name,
        summary: card.pitch,
        userProblem: card.problem,
        targetAudience: card.targetUser,
        workflow: card.howItWorks,
        features: card.mvpScope,
        differentiators: [card.differentiation],
        sponsorUsage: card.sponsorIntegration,
        techStack: card.components,
      },
    });
    await assessCurrentVersion(workspaceId, ideaId, { reason: "Initial assessment" });
    return { ideaId };
  },
  { limit: "job" },
);
