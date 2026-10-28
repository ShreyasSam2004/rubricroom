import { z } from "zod";
import { apiHandler, HttpError } from "@/lib/api";
import { flagClaim } from "@/lib/services/hackathons";

export const POST = apiHandler(z.object({ note: z.string().min(3).max(600) }), async ({ workspaceId, params, body }) => {
  const claim = await flagClaim(workspaceId, params.id, body.note);
  if (!claim) throw new HttpError(404, "Claim not found");
  return { claim };
});
