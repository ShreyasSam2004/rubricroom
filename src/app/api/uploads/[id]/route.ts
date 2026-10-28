import { apiHandler, HttpError } from "@/lib/api";
import { getUpload } from "@/lib/services/evidence";

export const GET = apiHandler(null, async ({ workspaceId, params }) => {
  const up = await getUpload(workspaceId, params.id);
  if (!up) throw new HttpError(404, "File not found");
  return new Response(new Uint8Array(up.data), {
    headers: {
      "content-type": up.contentType,
      "content-length": String(up.size),
      "content-disposition": `inline; filename="${up.filename.replace(/"/g, "")}"`,
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  });
});
