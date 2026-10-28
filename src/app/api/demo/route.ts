import { apiHandler } from "@/lib/api";
import { setActiveHackathon } from "@/lib/services/hackathons";
import { ensureShowcase } from "@/lib/services/showcase";

export const POST = apiHandler(null, async ({ workspaceId }) => {
  const { hackathonId, created } = await ensureShowcase(workspaceId);
  // Opening the demo again also makes it the active hackathon, as the visitor's own choice.
  if (!created) await setActiveHackathon(workspaceId, hackathonId, { pinned: true });
  return { hackathonId, created };
});
