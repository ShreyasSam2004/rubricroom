"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Callout } from "@/components/ui/primitives";
import { RunningFor, TraceIcon } from "@/components/ui/trace";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";
import type { JobStep } from "@/lib/types";
import { STEP_META } from "./badges";

interface Job {
  id: string;
  status: string;
  steps: JobStep[];
  error: string | null;
}

const AGENT_LABEL: Record<string, string> = { atlas: "Atlas", scout: "Scout", nova: "Nova", verdict: "Verdict", forge: "Forge", prism: "Prism", sprint: "Sprint", proof: "Proof" };
const TERMINAL = ["complete", "partial", "failed"];

/**
 * Drives a durable research job: each POST runs exactly one real step on the server. Progress
 * shown here is the actual step list and its outcomes — there are no invented percentages.
 */
export function JobProgress({ jobId, initial, onDone, title }: { jobId: string; initial?: Job | null; onDone?: (job: Job) => void; title?: string }) {
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  // Each POST runs one whole step and only returns when it is done, so the step being worked on
  // is still "pending" in the last response; mark it running from when the request was sent.
  const [requestSince, setRequestSince] = useState<number | null>(null);
  const stopped = useRef(false);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    stopped.current = false;
    let failures = 0;
    let posts = 0;
    async function loop() {
      while (!stopped.current) {
        try {
          setRequestSince(Date.now());
          // While a long step runs, read the job every 2 s too: steps report what they have found
          // so far (Atlas: facts, criteria and rules extracted), so the trace shows real progress.
          const seq = ++posts;
          const peek = setInterval(() => {
            api<{ job: Job }>(`/api/jobs/${jobId}`)
              .then(({ job: j }) => {
                if (seq === posts && !stopped.current) setJob(j);
              })
              .catch(() => undefined);
          }, 2000);
          const { job: j } = await api<{ job: Job }>(`/api/jobs/${jobId}`, {}).finally(() => clearInterval(peek));
          posts++;
          setJob(j);
          failures = 0;
          if (TERMINAL.includes(j.status)) {
            onDoneRef.current?.(j);
            router.refresh();
            return;
          }
          // Another request may hold the step lease; back off briefly.
          if (!j.steps.some((s) => s.status === "running")) await new Promise((r) => setTimeout(r, 300));
          else await new Promise((r) => setTimeout(r, 1200));
        } catch (e) {
          failures++;
          setError((e as Error).message);
          if (failures > 4) return;
          await new Promise((r) => setTimeout(r, 2000 * failures));
        }
      }
    }
    loop();
    return () => {
      stopped.current = true;
    };
  }, [jobId, router]);

  const done = job?.steps.filter((s) => !["pending", "running"].includes(s.status)).length ?? 0;
  const total = job?.steps.length ?? 0;
  const terminal = job && TERMINAL.includes(job.status);
  const serverRunning = job?.steps.find((s) => s.status === "running");
  const working = serverRunning ?? (!terminal && requestSince ? job?.steps.find((s) => s.status === "pending") : undefined);
  const workingSince = serverRunning?.startedAt ? Date.parse(serverRunning.startedAt) : requestSince;

  return (
    <div className="rounded-xl border bg-card p-4" data-testid="job-progress" data-status={job?.status ?? "loading"}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-sm font-medium">{title ?? "Research in progress"}</div>
        <Badge tone={job?.status === "complete" ? "teal" : job?.status === "partial" ? "amber" : job?.status === "failed" ? "coral" : "primary"}>
          {job ? (terminal ? (job.status === "complete" ? "Complete" : job.status === "partial" ? "Partially complete" : "Failed") : `Step ${Math.min(done + 1, total)} of ${total}`) : "Starting…"}
        </Badge>
      </div>
      <ol className="space-y-2.5">
        {(job?.steps ?? []).map((s) => (
          <li key={s.key} className="flex gap-3">
            <div className="mt-0.5">
              <TraceIcon status={s === working ? "running" : s.status} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className={cn(s.status === "pending" && s !== working && "text-muted-foreground")}>{s.label}</span>
                <span className="text-[11px] text-muted-foreground">{AGENT_LABEL[s.agent] ?? s.agent}</span>
                {s === working && workingSince && <RunningFor since={workingSince} />}
                {s.status !== "pending" && s.status !== "running" && s.status !== "done" && <Badge tone={STEP_META[s.status].tone}>{STEP_META[s.status].label}</Badge>}
              </div>
              {s.detail && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.detail}</p>}
            </div>
          </li>
        ))}
        {!job && <li className="text-sm text-muted-foreground">Connecting…</li>}
      </ol>
      {job?.error && (
        <Callout tone="danger" className="mt-3" title="Research failed">
          {job.error}
        </Callout>
      )}
      {error && !terminal && <p className="mt-2 text-xs text-coral">Connection issue: {error} — retrying.</p>}
    </div>
  );
}
