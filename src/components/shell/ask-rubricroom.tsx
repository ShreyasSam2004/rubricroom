"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Check, CircleHelp, Mic, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { Badge, Callout } from "@/components/ui/primitives";
import { VoiceField } from "@/components/voice/voice-field";
import { api } from "@/lib/client";

interface ParsedCommand {
  intent: string;
  page: string | null;
  params: Record<string, unknown>;
  confirm: boolean;
  summary: string;
  method: "rules" | "ai";
}

const HREF: Record<string, string> = {
  dashboard: "/",
  hackathons: "/hackathons",
  intelligence: "/hackathons/active",
  radar: "/radar",
  ideas: "/ideas",
  judge: "/judge",
  compare: "/compare",
  plan: "/plan",
  evidence: "/evidence",
  sources: "/sources",
  settings: "/settings",
  demo: "/plan#demo",
};

const EXAMPLES = ["Open Opportunity Radar", "Show my top three ideas", "Compare these ideas", "What evidence am I missing?", "Give me something less crowded and easier to build", "Create a three-day implementation plan"];

export function AskRubricRoom({ open, onOpenChange, activeHackathonId }: { open: boolean; onOpenChange: (o: boolean) => void; activeHackathonId: string | null }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [cmd, setCmd] = useState<ParsedCommand | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function interpret() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    setCmd(null);
    try {
      const { command } = await api<{ command: ParsedCommand }>("/api/command", { text });
      setCmd(command);
      if (!command.confirm && command.intent !== "unknown") execute(command);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function go(href: string) {
    onOpenChange(false);
    setText("");
    setCmd(null);
    router.push(href);
  }

  async function execute(c: ParsedCommand) {
    setError(null);
    try {
      switch (c.intent) {
        case "navigate":
          return go(HREF[c.page ?? "dashboard"] ?? "/");
        case "query_rubric":
          return go(activeHackathonId ? `/hackathons/${activeHackathonId}?tab=judging` : "/hackathons");
        case "query_evidence":
          return go("/evidence");
        case "compare_ideas":
          return go("/compare");
        case "show_top_ideas":
          return go(`/ideas?top=${Number(c.params.count ?? 3)}`);
        case "explain_assessment":
          return go("/ideas?explain=1");
        case "start_debate":
          return go("/judge");
        case "generate_ideas": {
          setBusy(true);
          const { jobId } = await api<{ jobId: string }>("/api/opportunities", {
            action: "generate",
            hackathonId: activeHackathonId,
            mode: (c.params.mode as string) ?? "unsolved",
            modifiers: (c.params.modifiers as string[]) ?? [],
            request: (c.params.request as string) ?? text,
          });
          return go(`/radar?job=${jobId}`);
        }
        case "create_plan":
          return go(`/plan?create=1${c.params.days ? `&days=${c.params.days}` : ""}`);
        case "update_idea":
          return go(`/ideas?change=${encodeURIComponent(String(c.params.change ?? text))}`);
        case "update_milestone":
          return go(`/plan?task=${encodeURIComponent(String(c.params.taskQuery ?? ""))}&status=${c.params.taskStatus ?? "done"}`);
        default:
          return;
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Ask RubricRoom" description="Say what you want to do. RubricRoom maps it to an action and asks before changing anything." wide>
        <VoiceField
          value={text}
          onChange={setText}
          onSubmit={interpret}
          autoFocus
          rows={3}
          placeholder="e.g. “Give me something less crowded and easier to build, but with more human impact.”"
          data-testid="ask-input"
        />
        <div className="mt-3 flex flex-wrap gap-1.5">
          {EXAMPLES.map((e) => (
            <button key={e} type="button" onClick={() => setText(e)} className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground">
              {e}
            </button>
          ))}
        </div>
        {error && (
          <Callout tone="danger" className="mt-3" title="Couldn't run that">
            {error}
          </Callout>
        )}
        {cmd && (
          <div className="mt-4 rounded-lg border bg-muted/40 p-3" data-testid="ask-result">
            <div className="flex items-center gap-2 text-sm">
              {cmd.intent === "unknown" ? <CircleHelp className="size-4 text-muted-foreground" /> : <ShieldCheck className="size-4 text-teal" />}
              <span className="font-medium">{cmd.summary}</span>
              <Badge tone={cmd.method === "ai" ? "primary" : "gray"} className="ml-auto">
                {cmd.method === "ai" ? "Interpreted by AI" : "Matched by rules"}
              </Badge>
            </div>
            {cmd.confirm && (
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => execute(cmd)} loading={busy} data-testid="ask-confirm">
                  <Check /> Confirm
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCmd(null)}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )}
        <div className="mt-4 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Mic className="size-3.5" /> Only allow-listed actions run; nothing you say is executed as code.
          </span>
          <Button onClick={interpret} loading={busy} disabled={!text.trim()} data-testid="ask-submit">
            Interpret <ArrowRight />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
