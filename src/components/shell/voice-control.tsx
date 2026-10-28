"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Square, Volume2, VolumeX } from "lucide-react";
import { speech, useSpeech } from "@/lib/speech";
import { cn } from "@/lib/utils";

/**
 * Global voice controls in the top bar: a "Stop speaking" button whenever anything is talking,
 * and a mute toggle that silences every voice in the app (and stays muted across visits).
 * Esc also stops speech, and leaving a page stops whatever it was saying.
 */
export function VoiceControl() {
  const { supported, muted, speaking } = useSpeech();
  const pathname = usePathname();

  useEffect(() => {
    speech.stop();
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && speech.getSnapshot().speaking) speech.stop();
    };
    const onHide = () => speech.stop();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);

  if (!supported) return null;

  return (
    <div className="flex items-center gap-1">
      {speaking && (
        <button
          type="button"
          onClick={() => speech.stop()}
          className="flex items-center gap-1.5 rounded-lg bg-coral-soft px-2.5 py-1.5 text-sm font-medium text-coral hover:bg-coral/15"
          data-testid="voice-stop"
          aria-label="Stop speaking (Esc)"
          title="Stop speaking (Esc)"
        >
          <Square className="size-3.5 fill-current" />
          <span className="hidden sm:inline">Stop speaking</span>
        </button>
      )}
      <button
        type="button"
        onClick={() => speech.setMuted(!muted)}
        aria-pressed={muted}
        aria-label={muted ? "Unmute voices" : "Mute all voices"}
        title={muted ? "Voices are muted: click to unmute" : "Mute all voices"}
        className={cn("rounded-lg p-2 hover:bg-muted", muted ? "text-coral" : "text-muted-foreground hover:text-foreground")}
        data-testid="voice-mute"
      >
        {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
      </button>
    </div>
  );
}
