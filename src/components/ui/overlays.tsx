"use client";

import * as React from "react";
import { Dialog as D, Tabs as T, Tooltip as TT, Popover as P } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ className, children, title, description, wide }: { className?: string; children: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; wide?: boolean }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-navy/40 backdrop-blur-[2px] data-[state=open]:animate-in" />
      <D.Content
        className={cn(
          "fixed left-1/2 top-[8vh] z-50 max-h-[86vh] w-[calc(100vw-2rem)] -translate-x-1/2 overflow-y-auto rounded-xl border bg-card p-5 shadow-2xl focus:outline-none",
          wide ? "max-w-3xl" : "max-w-lg",
          className,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <D.Title className="text-base font-semibold">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-sm text-muted-foreground">{description}</D.Description> : <D.Description className="sr-only">Dialog</D.Description>}
          </div>
          <D.Close className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close">
            <X className="size-4" />
          </D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
}

export function Tabs({ className, ...props }: React.ComponentProps<typeof T.Root>) {
  return <T.Root className={cn("w-full", className)} {...props} />;
}

export function TabsList({ className, ...props }: React.ComponentProps<typeof T.List>) {
  return <T.List className={cn("scrollbar-thin -mx-1 flex gap-1 overflow-x-auto border-b px-1", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        "relative -mb-px shrink-0 border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground cursor-pointer",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof T.Content>) {
  return <T.Content className={cn("pt-5 focus-visible:outline-none", className)} {...props} />;
}

export function Tooltip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <TT.Provider delayDuration={200}>
      <TT.Root>
        <TT.Trigger asChild>{children}</TT.Trigger>
        <TT.Portal>
          <TT.Content side={side} sideOffset={6} className="z-50 max-w-xs rounded-md bg-navy px-2.5 py-1.5 text-xs text-white shadow-lg dark:bg-white dark:text-navy">
            {content}
          </TT.Content>
        </TT.Portal>
      </TT.Root>
    </TT.Provider>
  );
}

export function Popover({ trigger, children, className, align = "start" }: { trigger: React.ReactNode; children: React.ReactNode; className?: string; align?: "start" | "center" | "end" }) {
  return (
    <P.Root>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content align={align} sideOffset={6} className={cn("z-50 w-[min(26rem,calc(100vw-2rem))] rounded-xl border bg-card p-4 text-sm shadow-xl focus:outline-none", className)}>
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
