import { apiHandler, HttpError } from "@/lib/api";
import { advanceJob, getJob } from "@/lib/research/jobs";

// One bounded research step per request; the client keeps calling until the job is terminal.
export const maxDuration = 300;

export const GET = apiHandler(null, async ({ workspaceId, params }) => {
  const job = await getJob(workspaceId, params.id);
  if (!job) throw new HttpError(404, "Job not found");
  return { job };
});

export const POST = apiHandler(
  null,
  async ({ workspaceId, params }) => {
    const job = await advanceJob(workspaceId, params.id);
    if (!job) throw new HttpError(404, "Job not found");
    return { job };
  },
  { limit: "read" },
);
