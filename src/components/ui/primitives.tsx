import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border bg-card text-card-foreground shadow-[0_1px_2px_rgba(16,24,39,0.04)]", className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-5 pb-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-base font-semibold leading-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}

const badgeTones = {
  default: "bg-muted text-muted-foreground",
  primary: "bg-primary-soft text-primary-soft-foreground",
  teal: "bg-teal-soft text-teal",
  amber: "bg-amber-soft text-amber-foreground",
  coral: "bg-coral-soft text-coral",
  gray: "bg-unverified-soft text-unverified",
  outline: "border border-border text-muted-foreground",
  dark: "bg-navy text-white dark:bg-white dark:text-navy",
} as const;

export function Badge({ className, tone = "default", ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof badgeTones }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3", badgeTones[tone], className)} {...props} />;
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-24 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm leading-relaxed placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[13px] font-medium text-foreground", className)} {...props} />;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn("flex h-10 w-full rounded-lg border border-input bg-card px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50", className)}
      {...props}
    />
  );
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse-soft rounded-md bg-muted", className)} {...props} />;
}

export function Separator({ className }: { className?: string }) {
  return <div role="separator" className={cn("h-px w-full bg-border", className)} />;
}

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <kbd className={cn("rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground", className)} {...props} />;
}

export function Progress({ value, className, tone = "primary" }: { value: number; className?: string; tone?: "primary" | "teal" | "amber" }) {
  const color = tone === "teal" ? "bg-teal" : tone === "amber" ? "bg-amber" : "bg-primary";
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Callout({ tone = "info", title, children, className, icon }: { tone?: "info" | "warning" | "danger" | "success" | "neutral"; title?: React.ReactNode; children?: React.ReactNode; className?: string; icon?: React.ReactNode }) {
  const tones = {
    info: "border-primary/20 bg-primary-soft/60 text-foreground",
    warning: "border-amber/40 bg-amber-soft text-foreground",
    danger: "border-coral/30 bg-coral-soft text-foreground",
    success: "border-teal/30 bg-teal-soft text-foreground",
    neutral: "border-border bg-muted/60 text-foreground",
  };
  return (
    <div className={cn("flex gap-3 rounded-lg border p-3.5 text-sm", tones[tone], className)}>
      {icon && <div className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</div>}
      <div className="min-w-0 space-y-1">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className="text-muted-foreground [&_a]:text-primary [&_a]:underline">{children}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: React.ReactNode; title: string; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center", className)}>
      {icon && <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary [&_svg]:size-5">{icon}</div>}
      <div className="font-medium">{title}</div>
      {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function SectionHeading({ title, description, action, className }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-primary">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight md:text-[28px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground md:text-[15px]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
