"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Route } from "lucide-react";
import { AiProgress } from "@/components/ui/ai-progress";
import { Button } from "@/components/ui/button";
import { Callout, Input, Label, Select } from "@/components/ui/primitives";
import { VoiceField } from "@/components/voice/voice-field";
import { api } from "@/lib/client";

export function CreatePlanForm({ ideas, defaultIdeaId, defaultHours, defaultDays }: { ideas: { id: string; name: string; selected: boolean }[]; defaultIdeaId: string | null; defaultHours: number; defaultDays: number | null }) {
  const router = useRouter();
  const [ideaId, setIdeaId] = useState(defaultIdeaId ?? ideas[0]?.id ?? "");
  const [hours, setHours] = useState(defaultHours);
  const [days, setDays] = useState<string>(defaultDays ? String(defaultDays) : "");
  const [scope, setScope] = useState("");
  const [since, setSince] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-4" data-testid="create-plan">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1.5 md:col-span-1">
          <Label>Idea</Label>
          <Select value={ideaId} onChange={(e) => setIdeaId(e.target.value)}>
            {ideas.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
                {i.selected ? " (selected project)" : ""}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Focused hours per day</Label>
          <Input type="number" min={1} max={16} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
        </div>
        <div className="space-y-1.5">
          <Label>Plan length (optional)</Label>
          <Input type="number" min={1} max={30} value={days} onChange={(e) => setDays(e.target.value)} placeholder="Fit to the deadline" />
        </div>
      </div>
      <VoiceField value={scope} onChange={setScope} rows={2} compact placeholder="Optional, by voice: “Skip the mobile app; the web dashboard is enough.”" />
      {error && <Callout tone="danger">{error}</Callout>}
      <Button
        loading={since !== null}
        disabled={!ideaId}
        data-testid="create-plan-submit"
        onClick={async () => {
          setSince(Date.now());
          setError(null);
          try {
            const { planId } = await api<{ planId: string }>("/api/plans", { action: "plan", ideaId, hoursPerDay: hours, scopeChange: scope || null, maxDays: days ? Number(days) : null });
            router.push(`/plan/${planId}`);
          } catch (e) {
            setError((e as Error).message);
            setSince(null);
          }
        }}
      >
        <Route /> Generate build plan
      </Button>
      {since !== null && <AiProgress since={since} label="Sprint is drafting your day-by-day plan" detail="If the idea changed since its last feasibility check, Forge re-checks it first." expected="10–25 seconds" />}
    </div>
  );
}
