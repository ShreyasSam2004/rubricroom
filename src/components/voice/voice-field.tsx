"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { Kbd } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

function detectScript(text: string): "English" | "Hindi" | "Hinglish" | null {
  if (!text.trim()) return null;
  const dev = (text.match(/[ऀ-ॿ]/g) ?? []).length;
  const lat = (text.match(/[A-Za-z]/g) ?? []).length;
  if (dev && lat) return "Hinglish";
  if (dev) return "Hindi";
  const markers = (text.match(/\b(hai|hain|nahi|nahin|kya|karna|karta|karte|mujhe|mera|meri|bahut|kaise|chahiye|chahta|chahti|matlab|yaar|accha|kuch|aur|lekin|hoon|hun|raha|rahi|jaate|kyunki|toh|bhi|wala|wali)\b/gi) ?? []).length;
  return markers >= 2 ? "Hinglish" : "English";
}

/** Everyone's shortcut can differ, so the hint names none and the tooltip gives Wispr Flow's defaults. */
const WISPR_DEFAULTS = "Wispr Flow's default shortcut: hold Fn on Mac, or Ctrl + Win on Windows. Custom shortcuts (e.g. double-tap Caps Lock) work too.";

export interface VoiceFieldHandle {
  focus: () => void;
  clear: () => void;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  label?: string;
  hint?: string;
  rows?: number;
  maxLength?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
  compact?: boolean;
  "data-testid"?: string;
}

/**
 * A text field designed for Wispr Flow dictation. Wispr inserts polished text wherever the cursor
 * is, so RubricRoom doesn't need (or pretend to have) a transcription API: the field just has to be
 * focused, roomy, and tolerant of long, mixed-language input. Ctrl/⌘+Enter submits.
 */
export const VoiceField = forwardRef<VoiceFieldHandle, Props>(function VoiceField(
  { value, onChange, onSubmit, placeholder, label, hint, rows = 6, maxLength = 8000, autoFocus, disabled, className, id, compact, ...rest },
  ref,
) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  useImperativeHandle(ref, () => ({ focus: () => area.current?.focus(), clear: () => onChange("") }), [onChange]);
  useEffect(() => {
    if (autoFocus) area.current?.focus();
  }, [autoFocus]);
  const script = useMemo(() => detectScript(value), [value]);
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;

  return (
    <div className={cn("group rounded-xl border bg-card transition-shadow", focused && "border-primary/50 shadow-[0_0_0_4px_color-mix(in_srgb,var(--primary)_12%,transparent)]", className)}>
      {label && (
        <label htmlFor={id} className="flex items-center justify-between px-4 pt-3 text-[13px] font-medium">
          {label}
        </label>
      )}
      <textarea
        ref={area}
        id={id}
        value={value}
        rows={rows}
        maxLength={maxLength}
        disabled={disabled}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && onSubmit) {
            e.preventDefault();
            onSubmit();
          }
        }}
        className={cn("block w-full resize-y bg-transparent px-4 py-3 text-[15px] leading-relaxed placeholder:text-muted-foreground/80 focus:outline-none disabled:opacity-60", compact && "text-sm")}
        data-testid={rest["data-testid"]}
        aria-describedby={id ? `${id}-hint` : undefined}
      />
      <div id={id ? `${id}-hint` : undefined} className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5" title={hint ? undefined : WISPR_DEFAULTS}>
          <Mic className={cn("size-3.5", focused ? "text-primary" : "")} aria-hidden />
          {hint ?? <>{focused ? "Ready — hold" : "Focus here, then hold"} your Wispr Flow shortcut and speak</>}
        </span>
        <span className="flex items-center gap-2">
          {script && <span>{script}</span>}
          {words > 0 && <span>{words} words</span>}
          {onSubmit && (
            <span className="hidden sm:inline">
              <Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd> to send
            </span>
          )}
        </span>
      </div>
    </div>
  );
});
