import { and, asc, desc, eq } from "drizzle-orm";
import { checkUrl, statusAfterCheck, submissionReadiness, suggestionsFor } from "@/lib/agents/proof";
import { getDb } from "@/lib/db/client";
import { hackathons, judgingCriteria, submissionEvidence, uploads } from "@/lib/db/schema";
import { logActivity } from "@/lib/research/jobs";
import { newId, sha256 } from "@/lib/text";
import type { EvidenceStatus } from "@/lib/types";

export type EvidenceRow = typeof submissionEvidence.$inferSelect;

export async function evidenceBoard(workspaceId: string, hackathonId: string, ideaId: string | null) {
  const db = await getDb();
  const [h] = await db.select().from(hackathons).where(and(eq(hackathons.id, hackathonId), eq(hackathons.workspaceId, workspaceId)));
  if (!h) return null;
  const criteria = await db.select().from(judgingCriteria).where(and(eq(judgingCriteria.hackathonId, hackathonId), eq(judgingCriteria.workspaceId, workspaceId))).orderBy(asc(judgingCriteria.position));
  const where = ideaId
    ? and(eq(submissionEvidence.workspaceId, workspaceId), eq(submissionEvidence.hackathonId, hackathonId), eq(submissionEvidence.ideaId, ideaId))
    : and(eq(submissionEvidence.workspaceId, workspaceId), eq(submissionEvidence.hackathonId, hackathonId));
  const items = await db.select().from(submissionEvidence).where(where).orderBy(desc(submissionEvidence.createdAt));
  const readiness = submissionReadiness(h.dossier?.submission ?? [], items);
  return {
    hackathon: h,
    rows: criteria.map((c) => ({ criterion: c, suggestions: suggestionsFor(c.name, c.description ?? ""), items: items.filter((i) => i.criterionId === c.id) })),
    deliverables: items.filter((i) => i.deliverableKey),
    readiness,
  };
}

export interface AddEvidenceInput {
  hackathonId: string;
  ideaId: string | null;
  criterionId?: string | null;
  deliverableKey?: string | null;
  artifactType: string;
  title: string;
  url?: string | null;
  notes?: string | null;
  uploadId?: string | null;
  planned?: boolean;
}

export async function addEvidence(workspaceId: string, input: AddEvidenceInput) {
  const db = await getDb();
  const [h] = await db.select().from(hackathons).where(and(eq(hackathons.id, input.hackathonId), eq(hackathons.workspaceId, workspaceId)));
  if (!h) throw new Error("Hackathon not found");
  const check = input.url ? await checkUrl(input.url) : null;
  let status: EvidenceStatus = input.planned ? "planned" : statusAfterCheck(input.artifactType, check, Boolean(input.uploadId));
  if (!input.url && !input.uploadId && !input.notes && !input.planned) status = "missing";
  const [row] = await db
    .insert(submissionEvidence)
    .values({
      id: newId("ev"),
      workspaceId,
      hackathonId: input.hackathonId,
      ideaId: input.ideaId,
      criterionId: input.criterionId ?? null,
      deliverableKey: input.deliverableKey ?? null,
      artifactType: input.artifactType,
      title: input.title,
      url: input.url ?? null,
      notes: input.notes ?? null,
      uploadId: input.uploadId ?? null,
      status,
      check,
    })
    .returning();
  await logActivity(workspaceId, "evidence", `Evidence added: ${input.title}`, `/evidence`);
  return row;
}

export async function recheckEvidence(workspaceId: string, id: string) {
  const db = await getDb();
  const [row] = await db.select().from(submissionEvidence).where(and(eq(submissionEvidence.id, id), eq(submissionEvidence.workspaceId, workspaceId)));
  if (!row?.url) throw new Error("Nothing to check");
  const check = await checkUrl(row.url);
  const status = statusAfterCheck(row.artifactType, check, Boolean(row.uploadId));
  const [updated] = await db.update(submissionEvidence).set({ check, status, updatedAt: new Date() }).where(eq(submissionEvidence.id, id)).returning();
  return updated;
}

export async function setEvidenceStatus(workspaceId: string, id: string, status: EvidenceStatus) {
  const db = await getDb();
  const [updated] = await db.update(submissionEvidence).set({ status, updatedAt: new Date() }).where(and(eq(submissionEvidence.id, id), eq(submissionEvidence.workspaceId, workspaceId))).returning();
  return updated;
}

export async function deleteEvidence(workspaceId: string, id: string) {
  const db = await getDb();
  await db.delete(submissionEvidence).where(and(eq(submissionEvidence.id, id), eq(submissionEvidence.workspaceId, workspaceId)));
}

const MAGIC: { type: string; test: (b: Buffer) => boolean }[] = [
  { type: "image/png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: "image/webp", test: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
  { type: "image/gif", test: (b) => b.subarray(0, 4).toString() === "GIF8" },
  { type: "application/pdf", test: (b) => b.subarray(0, 5).toString() === "%PDF-" },
];

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Store a small image or PDF. The type is taken from the file's magic bytes, not its name or header. */
export async function storeUpload(workspaceId: string, filename: string, data: Buffer, allowed: string[] = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]) {
  if (data.length > MAX_UPLOAD_BYTES) throw new Error(`File is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  const detected = MAGIC.find((m) => m.test(data))?.type;
  if (!detected || !allowed.includes(detected)) throw new Error("Only PNG, JPEG, WebP, GIF images or PDF documents are accepted.");
  const db = await getDb();
  const [row] = await db
    .insert(uploads)
    .values({ id: newId("up"), workspaceId, filename: filename.replace(/[^\w.\- ]+/g, "_").slice(0, 120), contentType: detected, size: data.length, sha256: sha256(data), data })
    .returning({ id: uploads.id, filename: uploads.filename, contentType: uploads.contentType, size: uploads.size });
  return row;
}

export async function getUpload(workspaceId: string, id: string) {
  const db = await getDb();
  const [row] = await db.select().from(uploads).where(and(eq(uploads.id, id), eq(uploads.workspaceId, workspaceId)));
  return row ?? null;
}
