import { z } from "zod";
import { apiHandler, zId } from "@/lib/api";
import { addEvidence, deleteEvidence, recheckEvidence, setEvidenceStatus } from "@/lib/services/evidence";

export const maxDuration = 60;

export const POST = apiHandler(
  z.discriminatedUnion("action", [
    z.object({
      action: z.literal("add"),
      hackathonId: zId,
      ideaId: zId.nullable(),
      criterionId: zId.nullable().optional(),
      deliverableKey: z.string().max(40).nullable().optional(),
      artifactType: z.enum(["url", "video", "screenshot", "note", "usage_card", "test_report", "repo"]),
      title: z.string().min(2).max(200),
      url: z.string().max(2048).nullable().optional(),
      notes: z.string().max(4000).nullable().optional(),
      uploadId: zId.nullable().optional(),
      planned: z.boolean().optional(),
    }),
    z.object({ action: z.literal("check"), id: zId }),
    z.object({ action: z.literal("status"), id: zId, status: z.enum(["missing", "planned", "submitted", "needs_human"]) }),
    z.object({ action: z.literal("delete"), id: zId }),
  ]),
  async ({ workspaceId, body }) => {
    switch (body.action) {
      case "add": {
        const { action: _a, ...input } = body;
        void _a;
        return { evidence: await addEvidence(workspaceId, { ...input, url: input.url?.trim() || null }) };
      }
      case "check":
        return { evidence: await recheckEvidence(workspaceId, body.id) };
      case "status":
        return { evidence: await setEvidenceStatus(workspaceId, body.id, body.status) };
      case "delete":
        await deleteEvidence(workspaceId, body.id);
        return { ok: true };
    }
  },
);
