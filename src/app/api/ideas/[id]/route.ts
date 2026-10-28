import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { proposeIdeaChange } from "@/lib/agents/prism";
import { apiHandler, HttpError, zId } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { ideaVersions, projectIdeas } from "@/lib/db/schema";
import { createJob } from "@/lib/research/jobs";
import { ideaBriefMarkdown } from "@/lib/services/brief";
import { assessCurrentVersion, createIdea, createVersion, currentVersion, getIdea, getIdeaBundle, refreshFeasibility, selectIdea, unselectIdea, versionToFields } from "@/lib/services/ideas";

export const maxDuration = 300;

export const GET = apiHandler(null, async ({ workspaceId, params, req }) => {
  const format = new URL(req.url).searchParams.get("format");
  if (format === "md") {
    const md = await ideaBriefMarkdown(workspaceId, params.id, { includePersonal: new URL(req.url).searchParams.get("personal") === "1" });
    return new Response(md, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="idea-brief.md"` } });
  }
  const b = await getIdeaBundle(workspaceId, params.id);
  if (!b) throw new HttpError(404, "Idea not found");
  if (format === "json") return new Response(JSON.stringify(b, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="idea.json"` } });
  return b;
});

const fieldsSchema = z
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

const proposalSchema = z.object({
  summary: z.string().max(600),
  changes: fieldsSchema,
  removedFeatures: z.array(z.string().max(300)).max(20).optional(),
  addedFeatures: z.array(z.string().max(300)).max(20).optional(),
});

export const POST = apiHandler(
  z.discriminatedUnion("action", [
    z.object({ action: z.literal("edit"), fields: fieldsSchema, note: z.string().max(400).optional() }),
    z.object({ action: z.literal("propose_change"), instruction: z.string().min(2).max(3000) }),
    z.object({ action: z.literal("apply_proposal"), proposal: proposalSchema }),
    z.object({ action: z.literal("restore"), versionId: zId }),
    z.object({ action: z.literal("branch"), versionId: zId }),
    z.object({ action: z.literal("merge"), fromVersionId: zId, fields: z.array(z.enum(["name", "summary", "userProblem", "targetAudience", "workflow", "features", "differentiators", "sponsorUsage", "techStack"])).min(1) }),
    z.object({ action: z.literal("assess") }),
    z.object({ action: z.literal("feasibility") }),
    z.object({ action: z.literal("research") }),
    z.object({ action: z.literal("select") }),
    z.object({ action: z.literal("unselect") }),
    z.object({ action: z.literal("relevance"), experiences: z.boolean().nullable(), example: z.string().max(2000) }),
    z.object({ action: z.literal("archive") }),
  ]),
  async ({ workspaceId, params, body }) => {
    const idea = await getIdea(workspaceId, params.id);
    if (!idea) throw new HttpError(404, "Idea not found");
    const db = await getDb();
    switch (body.action) {
      case "edit": {
        const v = await createVersion(workspaceId, idea.id, { fields: body.fields, note: body.note || "Edited by you.", source: "user" });
        await assessCurrentVersion(workspaceId, idea.id, { reason: `Edited to version ${v.version}.` });
        return v;
      }
      case "propose_change": {
        const version = await currentVersion(workspaceId, idea);
        return proposeIdeaChange(workspaceId, versionToFields(version), body.instruction);
      }
      case "apply_proposal": {
        const v = await createVersion(workspaceId, idea.id, { proposal: { ...body.proposal, changes: body.proposal.changes }, note: body.proposal.summary, source: "user" });
        const r = await assessCurrentVersion(workspaceId, idea.id, { reason: `Updated to version ${v.version}: ${body.proposal.summary}` });
        return { ...v, revision: r.revision };
      }
      case "restore": {
        const [base] = await db.select().from(ideaVersions).where(and(eq(ideaVersions.id, body.versionId), eq(ideaVersions.ideaId, idea.id)));
        if (!base) throw new HttpError(404, "Version not found");
        const v = await createVersion(workspaceId, idea.id, { baseVersionId: base.id, note: `Restored version ${base.version}.`, source: "restore" });
        await assessCurrentVersion(workspaceId, idea.id, { reason: `Restored version ${base.version} as version ${v.version}.` });
        return v;
      }
      case "branch": {
        const [base] = await db.select().from(ideaVersions).where(and(eq(ideaVersions.id, body.versionId), eq(ideaVersions.ideaId, idea.id)));
        if (!base) throw new HttpError(404, "Version not found");
        const fields = versionToFields(base);
        const { ideaId } = await createIdea(workspaceId, { hackathonId: idea.hackathonId, fields: { ...fields, name: `${fields.name} (branch)` }, name: `${fields.name} (branch)`, personalRelevance: idea.personalRelevance });
        await assessCurrentVersion(workspaceId, ideaId, { reason: `Branched from ${idea.name} v${base.version}` });
        return { ideaId };
      }
      case "merge": {
        const [from] = await db.select().from(ideaVersions).where(and(eq(ideaVersions.id, body.fromVersionId), eq(ideaVersions.workspaceId, workspaceId)));
        if (!from) throw new HttpError(404, "Version not found");
        const src = versionToFields(from);
        const cur = versionToFields(await currentVersion(workspaceId, idea));
        const merged: Record<string, unknown> = {};
        for (const f of body.fields) {
          const value = src[f];
          merged[f] = Array.isArray(value) ? [...new Set([...(cur[f] as string[]), ...value])] : value;
        }
        const v = await createVersion(workspaceId, idea.id, { fields: merged, note: `Merged ${body.fields.join(", ")} from version ${from.version}${from.ideaId !== idea.id ? " of another idea" : ""}.`, source: "merge" });
        await assessCurrentVersion(workspaceId, idea.id, { reason: `Merged improvements into version ${v.version}.` });
        return v;
      }
      case "assess":
        return assessCurrentVersion(workspaceId, idea.id, { reason: "Reassessed on request." });
      case "feasibility":
        return { feasibility: await refreshFeasibility(workspaceId, idea.id) };
      case "research": {
        const job = await createJob({ workspaceId, jobType: "idea_research", ideaId: idea.id, hackathonId: idea.hackathonId });
        return { jobId: job.id };
      }
      case "select":
        await selectIdea(workspaceId, idea.id);
        return { ok: true };
      case "unselect":
        await unselectIdea(workspaceId, idea.id);
        return { ok: true };
      case "relevance":
        await db.update(projectIdeas).set({ personalRelevance: { experiences: body.experiences, example: body.example }, updatedAt: new Date() }).where(eq(projectIdeas.id, idea.id));
        return assessCurrentVersion(workspaceId, idea.id, { reason: "Personal relevance updated (user-reported)." });
      case "archive":
        await db.update(projectIdeas).set({ status: "archived", updatedAt: new Date() }).where(eq(projectIdeas.id, idea.id));
        return { ok: true };
    }
  },
);
