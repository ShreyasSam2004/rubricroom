import { CircleCheck, CircleMinus, Mic } from "lucide-react";
import { DataControls, ProfileForm } from "@/components/settings/profile-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Kbd, PageHeader } from "@/components/ui/primitives";
import { pageContext } from "@/lib/page-context";
import { getProfile } from "@/lib/services/profile";

export const metadata = { title: "Settings" };

function Row({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-3 py-2">
      {ok ? <CircleCheck className="mt-0.5 size-4 text-teal" /> : <CircleMinus className="mt-0.5 size-4 text-unverified" />}
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </div>
    </li>
  );
}

export default async function SettingsPage() {
  const { workspaceId, providers } = await pageContext();
  const profile = await getProfile(workspaceId);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Settings" title="Builder profile & workspace" description="Your constraints shape every plan and feasibility check. Your workspace is anonymous: it's tied to this browser by a cookie, with no account." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Builder profile</CardTitle>
          </CardHeader>
          <CardContent>
            <ProfileForm initial={profile.data} isDefault={profile.isDefault} />
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Providers</CardTitle>
              <CardDescription>What this deployment can actually do. Missing providers are reported, never faked.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y" data-testid="providers">
                <Row ok={providers.ai !== "none"} label={`AI: ${providers.ai === "none" ? "not configured" : `${providers.ai} (${providers.model})`}`} detail={providers.ai === "none" ? "Agents run in offline rule-based mode. Set ANTHROPIC_API_KEY for full AI analysis." : "Atlas, Scout, Nova, Verdict, Forge, Prism and Sprint use this model."} />
                <Row ok={providers.search !== "none"} label={`Web search: ${providers.search === "none" ? "not configured" : providers.search}`} detail={providers.search === "none" ? "Devpost, Product Hunt and the open web aren't searched. Set TAVILY_API_KEY or EXA_API_KEY." : "Used for Devpost, Product Hunt and web research."} />
                <Row ok label={`GitHub: ${providers.github}`} detail={providers.github === "token" ? "Authenticated REST API (higher rate limit)." : "Unauthenticated REST API, which has a low search rate limit (results may be partial)."} />
                <Row ok label="Hacker News" detail="Public Algolia search API, no key required." />
                <Row ok label={`Database: ${providers.database}`} detail={providers.database === "pglite" ? "Embedded PGlite (local development)." : "Hosted Postgres."} />
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mic className="size-4 text-primary" /> Using Wispr Flow here
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>Wispr Flow types polished text wherever your cursor is, so every large text field in RubricRoom is built for dictation: the pitch, the debate response, corrections, Ask RubricRoom and the demo refinements.</p>
              <p>
                Click into a field, hold your Wispr Flow shortcut and speak naturally. By default that&apos;s <Kbd>Fn</Kbd> on Mac and <Kbd>Ctrl + Win</Kbd> on Windows; if you&apos;ve set your own in Flow&apos;s settings (for example, double-tap <Kbd>Caps Lock</Kbd>), use that.
              </p>
              <p>RubricRoom doesn&apos;t control Wispr or record audio, and it can&apos;t tell whether a text was dictated. To show your real usage, attach your Wispr usage card on the Evidence Board.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Your data</CardTitle>
            </CardHeader>
            <CardContent>
              <DataControls />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
