import { z } from "zod";
import { interpretCommand } from "@/lib/agents/commands";
import { apiHandler } from "@/lib/api";

export const maxDuration = 30;

/** Interpret only — never executes. The client confirms mutating intents before calling real endpoints. */
export const POST = apiHandler(z.object({ text: z.string().min(1).max(1200) }), async ({ workspaceId, body }) => ({ command: await interpretCommand(workspaceId, body.text) }));
