import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { providerStatus } from "@/lib/env";
import { resolveActiveHackathon } from "@/lib/services/hackathons";
import { offerShowcase } from "@/lib/services/showcase";
import { clientIp, requireWorkspace } from "@/lib/workspace";

/** Per-request: the layout and the page both call this, but the lookups run once. */
export const pageContext = cache(async () => {
  let row = await requireWorkspace();
  // A first-time visitor lands in the sample workspace instead of empty pages.
  if (!row.showcaseAt && (await offerShowcase(row, { userAgent: (await headers()).get("user-agent"), ip: await clientIp() }))) row = await requireWorkspace();
  const { active, switchedFrom } = await resolveActiveHackathon(row);
  const ws = { ...row, activeHackathonId: active?.id ?? null };
  return { ws, workspaceId: ws.id, active, switchedFrom, providers: providerStatus() };
});
