import "server-only";
import { cache } from "react";
import { providerStatus } from "@/lib/env";
import { resolveActiveHackathon } from "@/lib/services/hackathons";
import { requireWorkspace } from "@/lib/workspace";

/** Per-request: the layout and the page both call this, but the lookups run once. */
export const pageContext = cache(async () => {
  const row = await requireWorkspace();
  const { active, switchedFrom } = await resolveActiveHackathon(row);
  const ws = { ...row, activeHackathonId: active?.id ?? null };
  return { ws, workspaceId: ws.id, active, switchedFrom, providers: providerStatus() };
});
