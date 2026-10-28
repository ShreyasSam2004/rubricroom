import { z } from "zod";
import { apiHandler, HttpError, zId, zUrl } from "@/lib/api";
import { deleteHackathon, getHackathon, getHackathonBundle, setActiveHackathon, startHackathonResearch } from "@/lib/services/hackathons";

export const maxDuration = 60;

export const GET = apiHandler(null, async ({ workspaceId, params }) => {
  const b = await getHackathonBundle(workspaceId, params.id);
  if (!b) throw new HttpError(404, "Hackathon not found");
  return b;
});

/** Re-run research (optionally with extra official URLs, pasted rules or an uploaded PDF), or set as active. */
export const POST = apiHandler(
  z.object({
    action: z.enum(["research", "activate"]),
    urls: z.array(zUrl).max(5).optional(),
    pastedText: z.string().max(100_000).optional(),
    uploadIds: z.array(zId).max(3).optional(),
  }),
  async ({ workspaceId, params, body }) => {
    const h = await getHackathon(workspaceId, params.id);
    if (!h) throw new HttpError(404, "Hackathon not found");
    if (body.action === "activate") {
      await setActiveHackathon(workspaceId, h.id, { pinned: true });
      return { ok: true };
    }
    const urls = [...new Set([...(h.officialUrl ? [h.officialUrl] : []), ...(body.urls ?? [])])];
    return startHackathonResearch(workspaceId, { urls, pastedText: body.pastedText, uploadIds: body.uploadIds, hackathonId: h.id });
  },
  { limit: "job" },
);

export const DELETE = apiHandler(null, async ({ workspaceId, params }) => {
  await deleteHackathon(workspaceId, params.id);
  return { ok: true };
});
