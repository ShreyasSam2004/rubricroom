"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent } from "@/components/ui/primitives";
import { api } from "@/lib/client";

export interface ExampleCard {
  key: string;
  hackathonName: string;
  platform: string;
  url: string;
  ideaName: string;
  pitchLanguage: string;
  blurb: string;
  /** Formatted on the server so the markup matches after hydration. */
  captured: string;
}

/** Complete runs on real hackathons. Opening one copies it into this visitor's own workspace. */
export function ExampleRuns({ examples, disclosure }: { examples: ExampleCard[]; disclosure: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!examples.length) return null;
  return (
    <section className="space-y-3" data-testid="example-runs">
      <div>
        <h2 className="text-lg font-semibold">Example runs on other hackathons</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{disclosure}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {examples.map((e) => (
          <Card key={e.key} className="flex flex-col" data-testid="example-card">
            <CardContent className="flex flex-1 flex-col gap-3 pt-5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="outline">{e.platform}</Badge>
                <Badge tone="gray">
                  <Languages /> {e.pitchLanguage} pitch
                </Badge>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{e.hackathonName}</div>
                <div className="font-medium">{e.ideaName}</div>
              </div>
              <p className="flex-1 text-sm text-muted-foreground">{e.blurb}</p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">Captured {e.captured}</span>
                <Button
                  size="sm"
                  variant="outline"
                  loading={busy === e.key}
                  disabled={busy !== null}
                  data-testid="open-example"
                  onClick={async () => {
                    setBusy(e.key);
                    setError(null);
                    try {
                      const { ideaId } = await api<{ ideaId: string }>("/api/examples", { key: e.key });
                      router.push(`/ideas/${ideaId}`);
                    } catch (err) {
                      setError((err as Error).message);
                      setBusy(null);
                    }
                  }}
                >
                  Open example <ArrowRight />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {error && <p className="text-sm text-coral">{error}</p>}
    </section>
  );
}
