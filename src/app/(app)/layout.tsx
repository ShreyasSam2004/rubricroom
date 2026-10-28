import { AppShell } from "@/components/shell/app-shell";
import { formatDeadline } from "@/lib/deadline";
import { pageContext } from "@/lib/page-context";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { active, switchedFrom, providers } = await pageContext();
  return (
    <AppShell
      active={active ? { id: active.id, name: active.name, deadlineAt: active.deadlineAt?.toISOString() ?? null, deadlineLabel: active.deadlineAt ? formatDeadline(active) : null, origin: active.origin } : null}
      switchedFrom={switchedFrom}
      providers={{ ai: providers.ai, search: providers.search }}
    >
      {children}
    </AppShell>
  );
}
