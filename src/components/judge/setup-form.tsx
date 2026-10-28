"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Gavel } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout, Input, Label, Select } from "@/components/ui/primitives";
import { Trace } from "@/components/ui/trace";
import { VoiceField } from "@/components/voice/voice-field";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";

const MODES = [
  ["friendly", "Friendly brainstorming", "Supportive, but still evidence-based."],
  ["critical", "Critical judge", "Skeptical questions on every criterion."],
  ["stress", "Aggressive stress test", "Hard questions, no benefit of the doubt."],
  ["technical", "Technical feasibility review", "Architecture, scope and demo reliability."],
  ["originality", "Originality challenge", "Overlap with existing projects."],
  ["rehearsal", "Final pitch rehearsal", "Two-minute clarity and proof."],
] as const;

export function JudgeSetup({
  ideas,
  hackathons,
  criteria,
  defaultIdeaId,
  defaultHackathonId,
}: {
  ideas: { id: string; name: string; hackathonId: string | null }[];
  hackathons: { id: string; name: string; tracks: string[] }[];
  criteria: { id: string; name: string; hackathonId: string }[];
  defaultIdeaId: string | null;
  defaultHackathonId: string | null;
}) {
  const router = useRouter();
  const [source, setSource] = useState<"existing" | "new">(ideas.length ? "existing" : "new");
  const [ideaId, setIdeaId] = useState(defaultIdeaId ?? ideas[0]?.id ?? "");
  const [hackathonId, setHackathonId] = useState(defaultHackathonId ?? hackathons[0]?.id ?? "");
  const [pitch, setPitch] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<string>("critical");
  const [intensity, setIntensity] = useState(2);
  const [focus, setFocus] = useState("");
  const [track, setTrack] = useState("");
  const [language, setLanguage] = useState("en");
  const [since, setSince] = useState<number | null>(null);
  const busy = since !== null;
  const [error, setError] = useState<string | null>(null);
  const hk = source === "existing" ? ideas.find((i) => i.id === ideaId)?.hackathonId ?? null : hackathonId || null;
  const hkCriteria = criteria.filter((c) => c.hackathonId === hk);
  const tracks = hackathons.find((h) => h.id === hk)?.tracks ?? [];

  async function start() {
    setSince(Date.now());
    setError(null);
    try {
      const { sessionId } = await api<{ sessionId: string }>("/api/debates", {
        ...(source === "existing" ? { ideaId } : { newIdea: { hackathonId: hackathonId || null, pitch, name: name || undefined } }),
        mode,
        intensity,
        focusCriterionId: focus || null,
        track: track || null,
        language,
      });
      router.push(`/judge/${sessionId}`);
    } catch (e) {
      setError((e as Error).message);
      setSince(null);
    }
  }

  return (
    <div className="space-y-6" data-testid="judge-setup">
      <div className="flex gap-2">
        <button type="button" onClick={() => setSource("existing")} disabled={!ideas.length} className={cn("rounded-lg border px-3 py-1.5 text-sm", source === "existing" ? "border-primary bg-primary-soft text-primary-soft-foreground" : "hover:bg-muted disabled:opacity-50")}>
          Use a saved idea
        </button>
        <button type="button" onClick={() => setSource("new")} className={cn("rounded-lg border px-3 py-1.5 text-sm", source === "new" ? "border-primary bg-primary-soft text-primary-soft-foreground" : "hover:bg-muted")} data-testid="pitch-new">
          Pitch a new idea by voice
        </button>
      </div>

      {source === "existing" ? (
        <div className="space-y-1.5">
          <Label htmlFor="idea">Idea</Label>
          <Select id="idea" value={ideaId} onChange={(e) => setIdeaId(e.target.value)} data-testid="idea-select">
            {ideas.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <div className="space-y-3">
          <VoiceField
            id="judge-pitch"
            label="Your pitch"
            value={pitch}
            onChange={setPitch}
            rows={6}
            autoFocus
            placeholder="“I want to build an AI interview preparation platform with specialized agents, video calls, coding tests and a personalized dashboard.”"
            data-testid="judge-pitch"
          />
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Hackathon</Label>
              <Select value={hackathonId} onChange={(e) => setHackathonId(e.target.value)}>
                <option value="">No hackathon (generic criteria unavailable)</option>
                {hackathons.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Name (optional)</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
        </div>
      )}

      <div>
        <Label>Debate mode</Label>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {MODES.map(([key, label, desc]) => (
            <button key={key} type="button" onClick={() => setMode(key)} className={cn("rounded-xl border p-3 text-left transition-colors", mode === key ? "border-primary bg-primary-soft/60" : "hover:bg-muted")} data-testid={`mode-${key}`}>
              <div className="text-sm font-medium">{label}</div>
              <div className="text-xs text-muted-foreground">{desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="intensity">Intensity: {["", "gentle", "firm", "relentless"][intensity]}</Label>
          <input id="intensity" type="range" min={1} max={3} value={intensity} onChange={(e) => setIntensity(Number(e.target.value))} className="w-full accent-[var(--primary)]" />
        </div>
        <div className="space-y-1.5">
          <Label>Focus criterion</Label>
          <Select value={focus} onChange={(e) => setFocus(e.target.value)}>
            <option value="">Weakest criterion first</option>
            {hkCriteria.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Track</Label>
          <Select value={track} onChange={(e) => setTrack(e.target.value)}>
            <option value="">{tracks.length ? "Any track" : "No tracks"}</option>
            {tracks.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Judges reply in</Label>
          <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="en">English</option>
            <option value="hinglish">Hinglish</option>
            <option value="hi">हिन्दी (Hindi)</option>
          </Select>
        </div>
      </div>

      {error && <Callout tone="danger">{error}</Callout>}
      <Button size="lg" onClick={start} loading={busy} disabled={source === "new" ? pitch.trim().length < 10 : !ideaId} data-testid="start-judges">
        <Gavel /> Enter the Judge&apos;s Room
      </Button>
      {since !== null && (
        <Trace
          title="Opening the Judge's Room"
          steps={[
            source === "new"
              ? { key: "structure", label: "Structuring your pitch (name, user, problem, workflow)", agent: "Prism", status: "running", since }
              : { key: "session", label: "Preparing the room", agent: "Verdict", status: "running", since },
            { key: "opening", label: "Writing the opening question", agent: "Verdict · quick model", status: "pending", detail: "Appears word by word as soon as the room opens." },
            { key: "assessment", label: "Scoring the idea against the rubric", agent: "Verdict", status: "pending", detail: "Runs alongside the question; you can answer while it finishes." },
          ]}
        />
      )}
    </div>
  );
}
