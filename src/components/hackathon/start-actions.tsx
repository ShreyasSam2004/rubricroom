"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ArrowRight, FileUp, Link2, Play, ScrollText, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout, Label, Textarea } from "@/components/ui/primitives";
import { api, uploadFile } from "@/lib/client";

export function DemoButton({ label = "Try a Live Demo", variant = "outline", size = "lg" }: { label?: string; variant?: "outline" | "default" | "secondary" | "dark"; size?: "lg" | "default" | "sm" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant={variant}
        size={size}
        loading={busy}
        data-testid="demo-button"
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const { hackathonId } = await api<{ hackathonId: string }>("/api/demo", {});
            router.push(`/hackathons/${hackathonId}`);
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <Play /> {label}
      </Button>
      {error && <span className="text-xs text-coral">{error}</span>}
    </div>
  );
}

export function AnalyzeForm({ defaultUrl = "", compact = false }: { defaultUrl?: string; compact?: boolean }) {
  const router = useRouter();
  const [urls, setUrls] = useState(defaultUrl);
  const [paste, setPaste] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [pdf, setPdf] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const list = urls
        .split(/[\s,]+/)
        .map((u) => u.trim())
        .filter(Boolean)
        .map((u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`));
      const uploadIds: string[] = [];
      if (pdf) uploadIds.push((await uploadFile(pdf, "pdf")).id);
      const { hackathonId, jobId } = await api<{ hackathonId: string; jobId: string }>("/api/hackathons", { urls: list, pastedText: paste || undefined, uploadIds });
      router.push(`/hackathons/${hackathonId}?job=${jobId}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="analyze-form">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            placeholder="Paste a hackathon URL — Devpost, organizer site, rules page…"
            className="h-12 w-full rounded-xl border border-input bg-card pl-9 pr-3 text-[15px] shadow-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
            aria-label="Hackathon URL"
            data-testid="analyze-url"
          />
        </div>
        <Button type="submit" size="lg" loading={busy} disabled={!urls.trim() && !paste.trim() && !pdf} data-testid="analyze-submit">
          <Sparkles /> Analyze a Hackathon
        </Button>
      </div>
      {!compact && (
        <button type="button" onClick={() => setShowMore((v) => !v)} className="text-xs text-muted-foreground hover:text-foreground">
          {showMore ? "Hide" : "Add"} more official URLs, pasted rules or a rules PDF
        </button>
      )}
      {showMore && (
        <div className="grid gap-3 rounded-xl border bg-muted/30 p-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>
              <ScrollText className="mr-1 inline size-3.5" />
              Paste rules text (labelled as provided by you)
            </Label>
            <Textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={5} placeholder="Paste official rules, FAQ or judging criteria…" maxLength={100000} />
          </div>
          <div className="space-y-1.5">
            <Label>
              <FileUp className="mr-1 inline size-3.5" />
              Rules PDF (max 4 MB)
            </Label>
            <input ref={fileRef} type="file" accept="application/pdf" className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:py-1.5 file:text-primary-soft-foreground" onChange={(e) => setPdf(e.target.files?.[0] ?? null)} />
            <p className="text-xs text-muted-foreground">Separate several URLs with spaces or new lines. Only public pages are fetched; private networks are blocked.</p>
          </div>
        </div>
      )}
      {error && (
        <Callout tone="danger" title="Couldn't start research">
          {error}
        </Callout>
      )}
    </form>
  );
}

export function InlineLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
      {children} <ArrowRight className="size-3.5" />
    </a>
  );
}
