import { z } from "zod";
import { apiHandler, zId } from "@/lib/api";
import { assessCurrentVersion, createIdea, listIdeas } from "@/lib/services/ideas";

export const maxDuration = 300;

export const GET = apiHandler(null, async ({ workspaceId, req }) => {
  const hackathonId = new URL(req.url).searchParams.get("hackathonId");
  return { ideas: await listIdeas(workspaceId, hackathonId) };
});

const fields = z
  .object({
    name: z.string().max(120),
    summary: z.string().max(2000),
    userProblem: z.string().max(2000),
    targetAudience: z.string().max(500),
    workflow: z.string().max(3000),
    features: z.array(z.string().max(300)).max(20),
    differentiators: z.array(z.string().max(400)).max(10),
    sponsorUsage: z.string().max(1500),
    techStack: z.array(z.string().max(60)).max(15),
  })
  .partial();

export const POST = apiHandler(
  z.object({
    hackathonId: zId.nullable(),
    pitch: z.string().max(8000).optional(),
    name: z.string().max(120).optional(),
    fields: fields.optional(),
    personalRelevance: z.object({ experiences: z.boolean().nullable(), example: z.string().max(2000) }).nullable().optional(),
    assess: z.boolean().default(true),
  }),
  async ({ workspaceId, body }) => {
    if (!body.pitch?.trim() && !body.fields) throw new Error("Describe the idea first.");
    const { ideaId } = await createIdea(workspaceId, { ...body, origin: "user" });
    if (body.assess) await assessCurrentVersion(workspaceId, ideaId, { reason: "Initial assessment" });
    return { ideaId };
  },
);
