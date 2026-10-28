import { z } from "zod";
import { apiHandler, zId } from "@/lib/api";
import { createDemo, createPlan } from "@/lib/services/plans";

export const maxDuration = 300;

export const POST = apiHandler(
  z.discriminatedUnion("action", [
    z.object({ action: z.literal("plan"), ideaId: zId, hoursPerDay: z.number().min(1).max(16).optional(), scopeChange: z.string().max(2000).nullable().optional(), maxDays: z.number().int().min(1).max(30).nullable().optional() }),
    z.object({ action: z.literal("demo"), ideaId: zId, timeLimitSec: z.number().int().min(30).max(900).optional(), refinement: z.string().max(1500).nullable().optional() }),
  ]),
  async ({ workspaceId, body }) => {
    if (body.action === "plan") return { planId: await createPlan(workspaceId, body.ideaId, { hoursPerDay: body.hoursPerDay, scopeChange: body.scopeChange ?? null, maxDays: body.maxDays ?? null }) };
    return { demoId: await createDemo(workspaceId, body.ideaId, { timeLimitSec: body.timeLimitSec, refinement: body.refinement ?? null }) };
  },
);
