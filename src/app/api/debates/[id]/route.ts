import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { apiHandler, HttpError, ndjsonStream, zId } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { debateSessions } from "@/lib/db/schema";
import { addDebateTurn, exportDebateMarkdown, getDebateBundle, openDebate, resolveIdeaUpdate } from "@/lib/services/debates";

export const maxDuration = 300;

export const GET = apiHandler(null, async ({ workspaceId, params, req }) => {
  if (new URL(req.url).searchParams.get("format") === "md") {
    const md = await exportDebateMarkdown(workspaceId, params.id);
    return new Response(md, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="judges-room-${params.id}.md"` } });
  }
  const b = await getDebateBundle(workspaceId, params.id);
  if (!b) throw new HttpError(404, "Debate not found");
  return b;
});

const wantsStream = (req: Request) => (req.headers.get("accept") ?? "").includes("application/x-ndjson");

export const POST = apiHandler(
  z.discriminatedUnion("action", [
    z.object({ action: z.literal("open") }),
    z.object({ action: z.literal("turn"), text: z.string().max(6000), request: z.enum(["harder", "perspectives"]).nullable().optional(), focusCriterionId: zId.nullable().optional() }),
    z.object({ action: z.literal("idea_update"), turnId: zId, decision: z.enum(["apply", "dismiss"]) }),
    z.object({ action: z.literal("settings"), mode: z.enum(["friendly", "critical", "stress", "technical", "originality", "rehearsal"]).optional(), intensity: z.number().int().min(1).max(3).optional(), focus: zId.nullable().optional() }),
  ]),
  async ({ workspaceId, params, body, req }) => {
    // Opening the room streams the opening question and the scoring progress.
    if (body.action === "open") return ndjsonStream((emit) => openDebate(workspaceId, params.id, emit));
    if (body.action === "turn") {
      const opts = { text: body.text, request: body.request ?? null, focusCriterionId: body.focusCriterionId ?? null };
      if (!wantsStream(req)) return addDebateTurn(workspaceId, params.id, opts);
      return ndjsonStream(async (emit) => {
        const r = await addDebateTurn(workspaceId, params.id, opts, emit);
        return { judgeTurnId: r.judgeTurn.id, method: r.method };
      });
    }
    if (body.action === "idea_update") return resolveIdeaUpdate(workspaceId, body.turnId, body.decision);
    const db = await getDb();
    await db
      .update(debateSessions)
      .set({ ...(body.mode ? { mode: body.mode } : {}), ...(body.intensity ? { intensity: body.intensity } : {}), ...(body.focus !== undefined ? { focus: body.focus } : {}), updatedAt: new Date() })
      .where(and(eq(debateSessions.id, params.id), eq(debateSessions.workspaceId, workspaceId)));
    return { ok: true };
  },
);
