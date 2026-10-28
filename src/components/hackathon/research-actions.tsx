"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CircleCheck, ExternalLink, FileUp, History, RefreshCw, RotateCcw, TriangleAlert } from "lucide-react";
import { JobProgress } from "@/components/research/job-progress";
import { Button } from "@/components/ui/button";
import { Callout, Input, Label, Textarea } from "@/components/ui/primitives";
import { api, uploadFile } from "@/lib/client";

export function RerunResearch({ hackathonId, label = "Re-run live research" }: { hackathonId: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        loading={busy}
        data-testid="rerun-research"
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const { jobId } = await api<{ jobId: string }>(`/api/hackathons/${hackathonId}`, { action: "research" });
            router.push(`/hackathons/${hackathonId}?job=${jobId}`);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <RefreshCw /> {label}
      </Button>
      {error && <span className="max-w-xs text-right text-xs text-coral">{error}</span>}
    </div>
  );
}

export function LiveJob({ jobId, hackathonId }: { jobId: string; hackathonId: string }) {
  const router = useRouter();
  return <JobProgress jobId={jobId} title="Atlas is researching this hackathon" onDone={() => router.replace(`/hackathons/${hackathonId}`)} />;
}

export function SetActive({ hackathonId }: { hackathonId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        await api(`/api/hackathons/${hackathonId}`, { action: "activate" });
        router.refresh();
        setBusy(false);
      }}
    >
      <CircleCheck /> Make active
    </Button>
  );
}

export function SourceActions({ sourceId, url, status }: { sourceId: string; url: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const web = /^https?:/.test(url);
  async function run(action: "refresh" | "outdated" | "current") {
    setBusy(action);
    setMsg(null);
    try {
      const r = await api<{ ok?: boolean; changed?: boolean; error?: string | null }>(`/api/sources/${sourceId}`, { action });
      if (action === "refresh") setMsg(r.ok ? (r.changed ? "Content changed since the last retrieval — re-run research to update claims." : "Re-fetched; content unchanged.") : `Refresh failed: ${r.error}`);
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <div className="flex flex-wrap gap-1">
        {web && (
          <Button asChild variant="ghost" size="xs">
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink /> Open
            </a>
          </Button>
        )}
        {web && (
          <Button variant="ghost" size="xs" loading={busy === "refresh"} onClick={() => run("refresh")}>
            <History /> Refresh
          </Button>
        )}
        {status === "outdated" || status === "changed" ? (
          <Button variant="ghost" size="xs" loading={busy === "current"} onClick={() => run("current")}>
            <RotateCcw /> Mark current
          </Button>
        ) : (
          <Button variant="ghost" size="xs" loading={busy === "outdated"} onClick={() => run("outdated")}>
            <TriangleAlert /> Mark outdated
          </Button>
        )}
      </div>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  );
}

export function AttachDocument({ hackathonId }: { hackathonId: string }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [paste, setPaste] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const uploadIds = pdf ? [(await uploadFile(pdf, "pdf")).id] : [];
          const { jobId } = await api<{ jobId: string }>(`/api/hackathons/${hackathonId}`, { action: "research", urls: url.trim() ? [url.trim()] : [], pastedText: paste || undefined, uploadIds });
          router.push(`/hackathons/${hackathonId}?job=${jobId}`);
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="attach-url">Official page URL</Label>
        <Input id="attach-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/rules" />
      </div>
      <div className="space-y-1.5">
        <Label>Or paste the text</Label>
        <Textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={4} placeholder="Paste rules, FAQ or judging text (stored as provided by you)" />
      </div>
      <div className="space-y-1.5">
        <Label>
          <FileUp className="mr-1 inline size-3.5" />
          Or upload a rules PDF
        </Label>
        <input type="file" accept="application/pdf" onChange={(e) => setPdf(e.target.files?.[0] ?? null)} className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:py-1.5 file:text-primary-soft-foreground" />
      </div>
      {error && <Callout tone="danger">{error}</Callout>}
      <Button type="submit" size="sm" loading={busy} disabled={!url.trim() && !paste.trim() && !pdf}>
        Add and re-run research
      </Button>
    </form>
  );
}
