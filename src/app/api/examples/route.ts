import { z } from "zod";
import { apiHandler } from "@/lib/api";
import { ensureExample } from "@/lib/services/examples";

export const POST = apiHandler(z.object({ key: z.string().min(1).max(80) }), async ({ workspaceId, body }) => {
  const { hackathonId, ideaId } = await ensureExample(workspaceId, body.key);
  return { hackathonId, ideaId };
});
