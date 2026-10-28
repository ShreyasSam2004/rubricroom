import { z } from "zod";
import { apiHandler, zId, zUrl } from "@/lib/api";
import { listHackathons, startHackathonResearch } from "@/lib/services/hackathons";

export const maxDuration = 60;

export const GET = apiHandler(null, async ({ workspaceId }) => ({ hackathons: await listHackathons(workspaceId) }));

export const POST = apiHandler(
  z.object({
    urls: z.array(zUrl).max(5).default([]),
    pastedText: z.string().max(100_000).optional(),
    uploadIds: z.array(zId).max(3).optional(),
  }),
  async ({ workspaceId, body }) => startHackathonResearch(workspaceId, body),
  { limit: "job" },
);
