import { apiHandler } from "@/lib/api";
import { ensureDemoWorkspace } from "@/lib/services/demo-seed";
import { setActiveHackathon } from "@/lib/services/hackathons";

export const POST = apiHandler(null, async ({ workspaceId }) => {
  const { hackathonId, created } = await ensureDemoWorkspace(workspaceId);
  // Opening the demo again also makes it the active hackathon, as the visitor's own choice.
  if (!created) await setActiveHackathon(workspaceId, hackathonId, { pinned: true });
  return { hackathonId, created };
});
