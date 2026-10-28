"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Dialog as D } from "radix-ui";
import { Menu, Mic, Moon, Sun, X } from "lucide-react";
import { Kbd } from "@/components/ui/primitives";
import { api } from "@/lib/client";
import { useDarkMode, useNow } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { AskRubricRoom } from "./ask-rubricroom";
import { Countdown } from "./countdown";
import { isActive, NAV_GROUPS } from "./nav";
import { VoiceControl } from "./voice-control";

export interface ShellProps {
  children: React.ReactNode;
  active: { id: string; name: string; deadlineAt: string | null; deadlineLabel: string | null; origin: string } | null;
  /** The hackathon whose passed deadline moved the workspace to `active`, until the notice is dismissed. */
  switchedFrom?: { id: string; name: string } | null;
  providers: { ai: string; search: string };
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-2">
      <span className="flex size-8 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
        <svg viewBox="0 0 32 32" className="size-5" aria-hidden>
          <path d="M9 22V10h6.2c2.6 0 4.3 1.5 4.3 3.8 0 1.7-.9 2.9-2.4 3.4L20 22h-3.1l-2.6-4.5H11.8V22H9Zm2.8-6.9h3.2c1.1 0 1.8-.6 1.8-1.4s-.7-1.4-1.8-1.4h-3.2v2.8Z" fill="#F8F9F6" />
          <circle cx="23.5" cy="21.5" r="2.5" fill="#8b81ff" />
        </svg>
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold text-white">RubricRoom</span>
        <span className="block text-[11px] text-sidebar-foreground/70">Challenge your idea first</span>
      </span>
    </Link>
  );
}

function SidebarNav({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="scrollbar-none sidebar-scroll-hint flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3 [@media(max-height:640px)]:gap-2 [@media(max-height:640px)]:py-2" aria-label="Main">
      {NAV_GROUPS.map((group, gi) => (
        <div key={gi} className={cn(!group.label && "mt-auto")}>
          {group.label && <div className="mb-1.5 px-2 text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/50">{group.label}</div>}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(item, pathname);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors [@media(max-height:640px)]:py-1",
                      active ? "bg-sidebar-active text-white" : "text-sidebar-foreground hover:bg-sidebar-active/60 hover:text-white",
                    )}
                  >
                    <item.icon className={cn("size-4", active ? "text-[#8b81ff]" : "")} aria-hidden />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useDarkMode();
  return (
    <button
      type="button"
      onClick={() => setDark(!dark)}
      className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

/** Past the deadline, point to the hackathons list (upcoming ones are listed first). */
function PassedHint({ deadline }: { deadline: string }) {
  const now = useNow(60_000);
  if (!now || new Date(deadline).getTime() > now.getTime()) return null;
  return (
    <Link href="/hackathons" className="hidden shrink-0 text-xs text-primary hover:underline md:inline" data-testid="find-upcoming">
      Switch to an upcoming hackathon
    </Link>
  );
}

/** Says when RubricRoom moved off a hackathon whose deadline passed, with a way back. */
function SwitchNotice({ from, to, onClose }: { from: { id: string; name: string }; to: NonNullable<ShellProps["active"]>; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-primary-soft/50 px-4 py-2 text-sm md:px-6" role="status" data-testid="switch-notice">
      <span className="min-w-0 flex-1">
        The deadline for <span className="font-medium">{from.name}</span> has passed, so RubricRoom switched to <span className="font-medium">{to.name}</span>
        {to.deadlineLabel ? `, which closes ${to.deadlineLabel}` : ""}.
      </span>
      <button
        type="button"
        className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await api(`/api/hackathons/${from.id}`, { action: "activate" }).catch(() => undefined);
          onClose();
          router.refresh();
        }}
      >
        Keep {from.name} instead
      </button>
      <button
        type="button"
        onClick={() => {
          onClose();
          api("/api/workspace", { action: "dismiss_switch" }).catch(() => undefined);
        }}
        className="rounded p-1 text-muted-foreground hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function AppShell({ children, active, switchedFrom = null, providers }: ShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAskOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-sidebar lg:flex">
        <div className="px-3 pt-5">
          <Brand />
        </div>
        <SidebarNav pathname={pathname} />
        <div className="border-t border-white/10 px-5 py-3 text-[11px] leading-relaxed text-sidebar-foreground/60">
          AI: {providers.ai === "none" ? "offline rules" : providers.ai} · Search: {providers.search === "none" ? "GitHub + HN only" : providers.search}
        </div>
      </aside>

      <D.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-40 bg-navy/50 lg:hidden" />
          <D.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-sidebar lg:hidden" aria-describedby={undefined}>
            <D.Title className="sr-only">Navigation</D.Title>
            <div className="flex items-center justify-between px-3 pt-5">
              <Brand />
              <D.Close className="rounded-md p-2 text-sidebar-foreground hover:bg-sidebar-active" aria-label="Close menu">
                <X className="size-4" />
              </D.Close>
            </div>
            <SidebarNav pathname={pathname} onNavigate={() => setMobileOpen(false)} />
          </D.Content>
        </D.Portal>
      </D.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur md:px-6">
          <button type="button" className="rounded-lg p-2 hover:bg-muted lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          {active ? (
            <>
              <Link
                href={`/hackathons/${active.id}`}
                className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted"
                title={active.deadlineLabel ? `Deadline: ${active.deadlineLabel}` : "Deadline not verified"}
                data-testid="active-hackathon"
              >
                <span className="size-2 shrink-0 rounded-full bg-teal" aria-hidden />
                <span className="truncate text-sm font-medium">{active.name}</span>
                {active.deadlineAt && <Countdown deadline={active.deadlineAt} compact className="hidden sm:inline-flex" />}
              </Link>
              {active.deadlineAt && <PassedHint deadline={active.deadlineAt} />}
            </>
          ) : (
            <Link href="/hackathons" className="text-sm text-muted-foreground hover:text-foreground">
              No active hackathon
            </Link>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setAskOpen(true)}
              className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-sm text-muted-foreground shadow-sm hover:text-foreground"
              data-testid="ask-open"
            >
              <Mic className="size-4 text-primary" />
              <span className="hidden sm:inline">Ask RubricRoom</span>
              <Kbd className="hidden md:inline">Ctrl K</Kbd>
            </button>
            <VoiceControl />
            <ThemeToggle />
          </div>
        </header>
        {switchedFrom && active && switchedFrom.id !== active.id && switchedFrom.id !== dismissed && <SwitchNotice from={switchedFrom} to={active} onClose={() => setDismissed(switchedFrom.id)} />}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
      <AskRubricRoom open={askOpen} onOpenChange={setAskOpen} activeHackathonId={active?.id ?? null} />
    </div>
  );
}
