"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ExternalLink, FileImage, Plus, RefreshCw, Trash2, UserCheck } from "lucide-react";
import { EvidenceBadge } from "@/components/research/badges";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { Callout, Input, Label, Select, Textarea } from "@/components/ui/primitives";
import { api, uploadFile } from "@/lib/client";
import type { EvidenceStatus, UrlCheck } from "@/lib/types";

const TYPES = [
  ["url", "Link (deployed app, page)"],
  ["video", "Demo video URL"],
  ["screenshot", "Screenshot"],
  ["usage_card", "Wispr usage card"],
  ["repo", "Repository"],
  ["test_report", "Test results"],
  ["note", "Written note / real result"],
] as const;

export function AddEvidence({
  hackathonId,
  ideaId,
  criterionId,
  deliverableKey,
  preset,
  trigger,
}: {
  hackathonId: string;
  ideaId: string | null;
  criterionId?: string | null;
  deliverableKey?: string | null;
  preset?: { title: string; artifactType: string };
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState(preset?.artifactType ?? "url");
  const [title, setTitle] = useState(preset?.title ?? "");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [planned, setPlanned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsFile = type === "screenshot" || type === "usage_card";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="xs" variant="secondary">
            <Plus /> Add evidence
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title="Attach evidence" description="RubricRoom checks what it can (link reachability) and labels everything else honestly.">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                {TYPES.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Public deployed URL" />
            </div>
          </div>
          {!needsFile && type !== "note" && (
            <div className="space-y-1.5">
              <Label>URL</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            </div>
          )}
          {(needsFile || type === "test_report") && (
            <div className="space-y-1.5">
              <Label>
                <FileImage className="mr-1 inline size-3.5" />
                Upload (PNG/JPEG/WebP/PDF, max 4 MB)
              </Label>
              <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:py-1.5 file:text-primary-soft-foreground" />
              {type === "usage_card" && <p className="text-xs text-muted-foreground">Use a genuine screenshot from Wispr Flow → Insights. RubricRoom can&apos;t verify it, so it&apos;s marked as needing human verification.</p>}
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What this shows. For a real result: what happened, when, and with whom." />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={planned} onChange={(e) => setPlanned(e.target.checked)} /> Not ready yet. Mark it as planned.
          </label>
          {error && <Callout tone="danger">{error}</Callout>}
          <div className="flex justify-end">
            <Button
              loading={busy}
              disabled={title.trim().length < 2}
              data-testid="evidence-save"
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const uploadId = file ? (await uploadFile(file)).id : null;
                  await api("/api/evidence", { action: "add", hackathonId, ideaId, criterionId: criterionId ?? null, deliverableKey: deliverableKey ?? null, artifactType: type, title, url: url || null, notes: notes || null, uploadId, planned });
                  setOpen(false);
                  setUrl("");
                  setNotes("");
                  setFile(null);
                  router.refresh();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save evidence
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EvidenceItem({ item }: { item: { id: string; title: string; artifactType: string; url: string | null; notes: string | null; uploadId: string | null; status: EvidenceStatus; check: UrlCheck | null } }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  async function act(action: "check" | "delete" | "status", extra: Record<string, unknown> = {}) {
    setBusy(action);
    try {
      await api("/api/evidence", { action, id: item.id, ...extra });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }
  return (
    <li className="rounded-lg border p-2.5 text-sm" data-testid="evidence-item">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{item.title}</div>
          {item.url && (
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 truncate text-xs text-primary hover:underline">
              {item.url} <ExternalLink className="size-3 shrink-0" />
            </a>
          )}
        </div>
        <EvidenceBadge status={item.status} />
      </div>
      {item.notes && <p className="mt-1 text-xs text-muted-foreground">{item.notes}</p>}
      {item.uploadId && (
        <a href={`/api/uploads/${item.uploadId}`} target="_blank" rel="noopener noreferrer" className="mt-2 block">
          <img src={`/api/uploads/${item.uploadId}`} alt={item.title} className="max-h-40 rounded-md border object-contain" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
        </a>
      )}
      {item.check && <p className={`mt-1 text-xs ${item.check.reachable ? "text-muted-foreground" : "text-coral"}`}>{item.check.detail}{item.check.title ? ` Page title: “${item.check.title}”.` : ""}</p>}
      <div className="mt-2 flex flex-wrap gap-1">
        {item.url && (
          <Button size="xs" variant="ghost" loading={busy === "check"} onClick={() => act("check")}>
            <RefreshCw /> Re-check
          </Button>
        )}
        {item.status !== "needs_human" && (
          <Button size="xs" variant="ghost" loading={busy === "status"} onClick={() => act("status", { status: "needs_human" })}>
            <UserCheck /> Needs human check
          </Button>
        )}
        <Button size="xs" variant="ghost" loading={busy === "delete"} onClick={() => act("delete")} aria-label="Delete evidence">
          <Trash2 />
        </Button>
      </div>
    </li>
  );
}
