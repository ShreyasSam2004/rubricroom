"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { AiProgress } from "@/components/ui/ai-progress";
import { Button } from "@/components/ui/button";
import { Callout, Input, Label, Select } from "@/components/ui/primitives";
import { VoiceField } from "@/components/voice/voice-field";
import { api } from "@/lib/client";

export function NewIdeaForm({ hackathons, defaultHackathonId }: { hackathons: { id: string; name: string }[]; defaultHackathonId: string | null }) {
  const router = useRouter();
  const [pitch, setPitch] = useState("");
  const [name, setName] = useState("");
  const [hackathonId, setHackathonId] = useState(defaultHackathonId ?? hackathons[0]?.id ?? "");
  const [exp, setExp] = useState<boolean | null>(null);
  const [example, setExample] = useState("");
  const [since, setSince] = useState<number | null>(null);
  const busy = since !== null;
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSince(Date.now());
    setError(null);
    try {
      const { ideaId } = await api<{ ideaId: string }>("/api/ideas", {
        hackathonId: hackathonId || null,
        pitch,
        name: name || undefined,
        personalRelevance: exp === null && !example ? null : { experiences: exp, example },
      });
      router.push(`/ideas/${ideaId}`);
    } catch (e) {
      setError((e as Error).message);
      setSince(null);
    }
  }

  return (
    <div className="space-y-4" data-testid="new-idea">
      <VoiceField
        id="pitch"
        label="Pitch your idea"
        value={pitch}
        onChange={setPitch}
        onSubmit={submit}
        rows={6}
        placeholder="Explain it the way you'd tell a friend: who it's for, what problem it fixes, how it works, and why it's different. Hindi, Hinglish and English all work."
        data-testid="pitch-input"
      />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="hk">Hackathon</Label>
          <Select id="hk" value={hackathonId} onChange={(e) => setHackathonId(e.target.value)}>
            <option value="">No hackathon</option>
            {hackathons.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nm">Name (optional)</Label>
          <Input id="nm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Leave blank to derive from the pitch" />
        </div>
      </div>
      <div className="rounded-lg border p-3">
        <div className="mb-2 text-sm font-medium">Is this a problem you, or someone you work with directly, actually have?</div>
        <div className="flex flex-wrap gap-2">
          {[
            [true, "Yes"],
            [false, "No"],
            [null, "Not sure"],
          ].map(([v, l]) => (
            <button key={String(v)} type="button" onClick={() => setExp(v as boolean | null)} className={`rounded-lg border px-3 py-1.5 text-sm ${exp === v ? "border-primary bg-primary-soft text-primary-soft-foreground" : "hover:bg-muted"}`}>
              {l as string}
            </button>
          ))}
        </div>
        {exp && <Input className="mt-2" value={example} onChange={(e) => setExample(e.target.value)} placeholder="One real example (saved as user-reported)" />}
      </div>
      {error && <Callout tone="danger">{error}</Callout>}
      <Button onClick={submit} loading={busy} disabled={pitch.trim().length < 10} data-testid="pitch-submit">
        <Sparkles /> Save and assess
      </Button>
      {since !== null && <AiProgress since={since} label="Structuring your pitch and assessing it against the rubric" expected="15–30 seconds" />}
    </div>
  );
}
