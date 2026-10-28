"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Download, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout, Input, Label, Select, Textarea } from "@/components/ui/primitives";
import { VoiceField } from "@/components/voice/voice-field";
import { api, download } from "@/lib/client";
import type { BuilderProfileData } from "@/lib/types";

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function ProfileForm({ initial, isDefault }: { initial: BuilderProfileData; isDefault: boolean }) {
  const router = useRouter();
  const [p, setP] = useState(initial);
  const [langs, setLangs] = useState(initial.languages.join(", "));
  const [fws, setFws] = useState(initial.frameworks.join(", "));
  const [interests, setInterests] = useState(initial.interests.join(", "));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = <K extends keyof BuilderProfileData>(k: K, v: BuilderProfileData[K]) => setP({ ...p, [k]: v });
  return (
    <div className="space-y-4" data-testid="profile-form">
      {isDefault && <Callout tone="info">These are defaults. Save your real constraints so plans and assessments fit you. Every field is optional.</Callout>}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Solo or team</Label>
          <Select value={p.mode} onChange={(e) => set("mode", e.target.value as BuilderProfileData["mode"])}>
            <option value="solo">Solo</option>
            <option value="team">Team</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Team size</Label>
          <Input type="number" min={1} max={10} value={p.teamSize} onChange={(e) => set("teamSize", Number(e.target.value))} />
        </div>
        <div className="space-y-1.5">
          <Label>Experience level</Label>
          <Select value={p.experienceLevel} onChange={(e) => set("experienceLevel", e.target.value as BuilderProfileData["experienceLevel"])}>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Languages (comma-separated)</Label>
          <Input value={langs} onChange={(e) => setLangs(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Frameworks</Label>
          <Input value={fws} onChange={(e) => setFws(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Focused hours per day</Label>
          <Input type="number" min={1} max={16} value={p.hoursPerDay} onChange={(e) => set("hoursPerDay", Number(e.target.value))} />
        </div>
        <div className="space-y-1.5">
          <Label>API budget</Label>
          <Select value={p.apiBudget} onChange={(e) => set("apiBudget", e.target.value as BuilderProfileData["apiBudget"])}>
            <option value="none">None</option>
            <option value="low">Low</option>
            <option value="moderate">Moderate</option>
            <option value="high">High</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Desired technical complexity</Label>
          <Select value={p.desiredComplexity} onChange={(e) => set("desiredComplexity", e.target.value as BuilderProfileData["desiredComplexity"])}>
            <option value="simple">Simple</option>
            <option value="balanced">Balanced</option>
            <option value="ambitious">Ambitious</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Explanation language</Label>
          <Select value={p.explanationLanguage} onChange={(e) => set("explanationLanguage", e.target.value as BuilderProfileData["explanationLanguage"])}>
            <option value="en">English</option>
            <option value="hinglish">Hinglish</option>
            <option value="hi">हिन्दी (Hindi)</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Target track</Label>
          <Input value={p.targetTrack} onChange={(e) => set("targetTrack", e.target.value)} placeholder="e.g. Builders" />
        </div>
        <div className="space-y-1.5">
          <Label>Hardware</Label>
          <Input value={p.hardware} onChange={(e) => set("hardware", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Interests</Label>
          <Input value={interests} onChange={(e) => setInterests(e.target.value)} placeholder="education, developer tools…" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Existing reusable projects</Label>
        <Textarea rows={2} value={p.reusableProjects} onChange={(e) => set("reusableProjects", e.target.value)} />
      </div>
      <VoiceField label="Problems you experience personally (dictate freely)" value={p.personalProblems} onChange={(v) => set("personalProblems", v)} rows={3} compact />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={p.hasRealTester} onChange={(e) => set("hasRealTester", e.target.checked)} /> A real user can test my project before the deadline
      </label>
      <div className="flex items-center gap-3">
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              await api("/api/profile", { ...p, languages: list(langs), frameworks: list(fws), interests: list(interests) }, "PUT");
              setMsg("Saved.");
              router.refresh();
            } catch (e) {
              setMsg((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          data-testid="profile-save"
        >
          <Save /> Save profile
        </Button>
        {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
      </div>
    </div>
  );
}

export function DataControls() {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4">
      <Button variant="outline" onClick={() => download("/api/workspace")}>
        <Download /> Export my workspace (JSON)
      </Button>
      <div className="space-y-2 rounded-lg border border-coral/30 p-3">
        <div className="text-sm font-medium">Delete everything in this workspace</div>
        <p className="text-xs text-muted-foreground">Removes your hackathons, ideas, debates, plans and evidence. This can&apos;t be undone. Type DELETE to confirm.</p>
        <div className="flex gap-2">
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-9 max-w-40" placeholder="DELETE" />
          <Button
            variant="destructive"
            size="sm"
            disabled={confirm !== "DELETE"}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await api("/api/workspace", { confirm: "DELETE" }, "DELETE");
              router.push("/");
              router.refresh();
            }}
          >
            <Trash2 /> Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
