import { apiHandler, HttpError } from "@/lib/api";
import { MAX_UPLOAD_BYTES, storeUpload } from "@/lib/services/evidence";

export const POST = apiHandler(null, async ({ workspaceId, req }) => {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD_BYTES + 64_000) throw new HttpError(413, "File is too large (max 4 MB).");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") throw new HttpError(400, "Attach a file in the 'file' field.");
  const data = Buffer.from(await file.arrayBuffer());
  const kind = form?.get("kind");
  const allowed = kind === "pdf" ? ["application/pdf"] : kind === "image" ? ["image/png", "image/jpeg", "image/webp", "image/gif"] : undefined;
  try {
    return { upload: await storeUpload(workspaceId, file.name || "upload", data, allowed) };
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});
