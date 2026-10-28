"use client";

import { useRouter } from "next/navigation";
import { Label, Select } from "@/components/ui/primitives";

/** Which idea's evidence the board shows. The choice lives in the URL, so a reload keeps it. */
export function EvidenceIdeaPicker({ ideas, value }: { ideas: { id: string; name: string; selected: boolean }[]; value: string | null }) {
  const router = useRouter();
  return (
    <div className="space-y-1.5" data-testid="evidence-idea-picker">
      <Label htmlFor="evidence-idea">Project</Label>
      <Select id="evidence-idea" value={value ?? "none"} onChange={(e) => router.push(`/evidence?idea=${e.target.value}`)} className="min-w-64">
        {ideas.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
            {i.selected ? " (selected project)" : ""}
          </option>
        ))}
        <option value="none">The hackathon as a whole (no project)</option>
      </Select>
    </div>
  );
}
