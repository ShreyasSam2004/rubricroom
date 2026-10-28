"use client";

import { useRef, useState } from "react";
import { PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";

/** The 2-minute product tour (rendered with /brag from real captures of the app). */
const TOUR = { src: "/demo/rubricroom-tour.mp4", poster: "/demo/rubricroom-tour.jpg" };

/** Chapter starts in seconds, matching the scene cuts in the video. */
export const TOUR_CHAPTERS = [
  { t: 0, title: "The problem", detail: "Days to the deadline and one idea." },
  { t: 11, title: "The 8 AI agents", detail: "Who does what inside RubricRoom." },
  { t: 17, title: "Atlas · paste a hackathon link", detail: "Live research; every fact cited; the next hackathon when one has passed." },
  { t: 39, title: "Prism · pitch by voice", detail: "Hold your Wispr Flow shortcut; the room opens in seconds." },
  { t: 53, title: "Verdict · the Judge's Room", detail: "Replies stream in; only evidence moves the score." },
  { t: 79, title: "Scout & Forge", detail: "Who already built it, and can you build it in time." },
  { t: 91, title: "Nova & Compare", detail: "Less crowded directions; ideas side by side." },
  { t: 103, title: "Sprint · build plan", detail: "A plan that fits the deadline, plus a demo script." },
  { t: 113, title: "Proof & Ask RubricRoom", detail: "Evidence for every criterion, voice commands and example runs." },
];

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/** Video player with clickable chapters, so a newcomer can jump straight to one feature. */
export function TourPlayer({ autoPlay = false, className }: { autoPlay?: boolean; className?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [current, setCurrent] = useState(0);
  const chapterAt = (t: number) => TOUR_CHAPTERS.reduce((i, c, j) => (t >= c.t ? j : i), 0);
  const jump = (i: number) => {
    const v = video.current;
    setCurrent(i);
    if (!v) return;
    v.currentTime = TOUR_CHAPTERS[i].t;
    void v.play().catch(() => undefined);
  };
  return (
    <div className={cn("grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]", className)} data-testid="tour-player">
      <video
        ref={video}
        className="aspect-video w-full rounded-xl border bg-navy shadow-sm"
        src={TOUR.src}
        poster={TOUR.poster}
        controls
        playsInline
        preload="metadata"
        autoPlay={autoPlay}
        onPlay={(e) => {
          // One tour at a time: the dialog and the inline player never play over each other.
          const self = e.currentTarget;
          document.querySelectorAll("video").forEach((v) => v !== self && v.pause());
        }}
        onTimeUpdate={(e) => {
          const i = chapterAt(e.currentTarget.currentTime);
          if (i !== current) setCurrent(i);
        }}
        aria-label="RubricRoom product tour, 2 minutes. On-screen captions explain each step; the chapter list describes every scene."
        data-testid="tour-video"
      />
      <ol className="space-y-1 text-sm lg:max-h-[min(60vh,420px)] lg:overflow-y-auto" aria-label="Tour chapters">
        {TOUR_CHAPTERS.map((c, i) => (
          <li key={c.t}>
            <button
              type="button"
              onClick={() => jump(i)}
              aria-current={i === current ? "step" : undefined}
              className={cn("flex w-full gap-3 rounded-lg px-2.5 py-2 text-left transition-colors", i === current ? "bg-primary-soft text-primary-soft-foreground" : "hover:bg-muted")}
              data-testid="tour-chapter"
            >
              <span className="w-9 shrink-0 font-mono text-xs leading-5 text-muted-foreground">{fmt(c.t)}</span>
              <span className="min-w-0">
                <span className="block font-medium leading-5">{c.title}</span>
                <span className="block text-xs text-muted-foreground">{c.detail}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Opens the tour in a dialog from anywhere. */
export function TourButton({ label = "Watch the 2-minute tour", variant = "outline", size = "default" }: { label?: string; variant?: "outline" | "ghost" | "secondary"; size?: "default" | "sm" }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} data-testid="tour-open">
          <PlayCircle /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl" title="RubricRoom in 2 minutes" description="Every feature, shown in the real app. Click a chapter to jump to it.">
        <TourPlayer autoPlay />
      </DialogContent>
    </Dialog>
  );
}
