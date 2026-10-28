import { z } from "zod";
import { apiHandler, HttpError, zId } from "@/lib/api";
import { addTask, deleteTask, getPlanBundle, planToMarkdown, updateTask } from "@/lib/services/plans";

export const GET = apiHandler(null, async ({ workspaceId, params, req }) => {
  const b = await getPlanBundle(workspaceId, params.id);
  if (!b) throw new HttpError(404, "Plan not found");
  const format = new URL(req.url).searchParams.get("format");
  if (format === "md") return new Response(planToMarkdown(b), { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="build-plan.md"` } });
  if (format === "json") return new Response(JSON.stringify(b, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="build-plan.json"` } });
  return b;
});

export const POST = apiHandler(
  z.discriminatedUnion("action", [
    z.object({ action: z.literal("add_task"), title: z.string().min(2).max(200), day: z.number().int().min(1).max(60), tier: z.enum(["core", "strong", "optional"]).optional(), priority: z.enum(["high", "medium", "low"]).optional() }),
    z.object({
      action: z.literal("update_task"),
      taskId: zId,
      status: z.enum(["todo", "doing", "done", "blocked", "cut"]).optional(),
      notes: z.string().max(4000).optional(),
      proofUrl: z.string().max(2048).optional(),
      priority: z.enum(["high", "medium", "low"]).optional(),
      title: z.string().max(200).optional(),
      day: z.number().int().min(1).max(60).optional(),
      tier: z.enum(["core", "strong", "optional"]).optional(),
    }),
    z.object({ action: z.literal("delete_task"), taskId: zId }),
  ]),
  async ({ workspaceId, params, body }) => {
    if (body.action === "add_task") return { task: await addTask(workspaceId, params.id, body) };
    if (body.action === "delete_task") {
      await deleteTask(workspaceId, body.taskId);
      return { ok: true };
    }
    const { taskId, action: _a, ...patch } = body;
    void _a;
    const task = await updateTask(workspaceId, taskId, patch);
    if (!task) throw new HttpError(404, "Task not found");
    return { task };
  },
);
