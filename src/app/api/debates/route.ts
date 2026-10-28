import { z } from "zod";
import { apiHandler, zId } from "@/lib/api";
import { startDebate } from "@/lib/services/debates";
import { createIdea } from "@/lib/services/ideas";

export const maxDuration = 300;

export const POST = apiHandler(
  z.object({
    ideaId: zId.optional(),
    newIdea: z.object({ hackathonId: zId.nullable(), pitch: z.string().min(10).max(8000), name: z.string().max(120).optional() }).optional(),
    mode: z.enum(["friendly", "critical", "stress", "technical", "originality", "rehearsal"]).default("critical"),
    focusCriterionId: zId.nullable().optional(),
    intensity: z.number().int().min(1).max(3).default(2),
    track: z.string().max(80).nullable().optional(),
    language: z.enum(["en", "hi", "hinglish"]).default("en"),
  }),
  async ({ workspaceId, body }) => {
    let ideaId = body.ideaId;
    if (!ideaId) {
      if (!body.newIdea) throw new Error("Pick an idea or pitch a new one.");
      // The room scores the new idea itself (streamed, beside the opening question), so it opens at once.
      ({ ideaId } = await createIdea(workspaceId, { hackathonId: body.newIdea.hackathonId, pitch: body.newIdea.pitch, name: body.newIdea.name, origin: "user" }));
    }
    const session = await startDebate(workspaceId, { ideaId, mode: body.mode, focusCriterionId: body.focusCriterionId ?? null, intensity: body.intensity, track: body.track ?? null, language: body.language });
    return { sessionId: session.id, ideaId };
  },
);
