import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { apiHandler, HttpError } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { researchSources } from "@/lib/db/schema";
import { retrieveSource } from "@/lib/research/sources";
import { markSource } from "@/lib/services/hackathons";

export const maxDuration = 60;

export const POST = apiHandler(
  z.discriminatedUnion("action", [
    z.object({ action: z.literal("refresh") }),
    z.object({ action: z.literal("outdated"), issue: z.string().max(600).optional() }),
    z.object({ action: z.literal("current") }),
  ]),
  async ({ workspaceId, params, body }) => {
    const db = await getDb();
    const [src] = await db.select().from(researchSources).where(and(eq(researchSources.id, params.id), eq(researchSources.workspaceId, workspaceId)));
    if (!src) throw new HttpError(404, "Source not found");
    if (body.action === "outdated") return { source: await markSource(workspaceId, src.id, "outdated", body.issue) };
    if (body.action === "current") return { source: await markSource(workspaceId, src.id, "retrieved") };
    if (!/^https?:/.test(src.url)) throw new HttpError(400, "Only web sources can be refreshed.");
    // Re-fetch live and compare content hashes; the old row is kept for provenance.
    const r = await retrieveSource({ workspaceId, url: src.url, hackathonId: src.hackathonId, ideaId: src.ideaId, sourceType: src.sourceType, authority: src.authority });
    const changed = r.ok && r.row.contentHash !== src.contentHash;
    if (r.ok) await db.update(researchSources).set({ status: changed ? "changed" : "outdated", userReportedIssue: changed ? "Superseded by a newer retrieval with different content." : "Superseded by a newer retrieval (content unchanged)." }).where(eq(researchSources.id, src.id));
    return { ok: r.ok, changed, newSourceId: r.row.id, error: r.ok ? null : r.row.error };
  },
);
