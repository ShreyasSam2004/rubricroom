import { describe, expect, it } from "vitest";
import { heuristicStructure } from "@/lib/agents/prism";

describe("offline pitch structuring", () => {
  const pitch =
    "InterviewLoop is an interview practice coach for job seekers. Most people forget which answers they fumbled, so they repeat the same mistakes. After every mock interview it remembers your weak answers and asks them again a week later. It has specialized interviewer agents, video calls, coding tests and a personalized dashboard. I pitch and answer by voice with Wispr Flow.";

  it("splits a spoken feature list and finds the problem, user and workflow", () => {
    const f = heuristicStructure(pitch, "InterviewLoop");
    expect(f.features).toEqual(["specialized interviewer agents", "video calls", "coding tests", "personalized dashboard"]);
    expect(f.userProblem).toMatch(/forget which answers/);
    expect(f.targetAudience).toBe("job seekers");
    expect(f.workflow).toMatch(/^After every mock interview/);
    expect(f.sponsorUsage).toMatch(/Wispr Flow/);
  });

  it("reads 'Features:' lists and still falls back to a 'with' clause", () => {
    expect(heuristicStructure("A notes app. Features: tagging, search and sync.").features).toEqual(["tagging", "search", "sync"]);
    expect(heuristicStructure("A planner for teams with shared calendars and reminders.").features).toEqual(["shared calendars", "reminders"]);
  });

  it("never invents fields that the pitch doesn't state", () => {
    const f = heuristicStructure("A tool that helps.");
    expect(f.features).toEqual([]);
    expect(f.workflow).toBe("");
    expect(f.userProblem).toBe("");
  });
});

describe("offline name and audience", () => {
  it("uses the pitcher's role as the user and never their first sentence as the name", () => {
    const f = heuristicStructure("I am a hiring manager at a 40-person startup. Candidates wait days for feedback after interviews, and I spend hours writing it. I want a tool that turns my dictated interview notes into clear feedback for each candidate.");
    expect(f.targetAudience).toBe("Hiring managers");
    expect(f.name).toBe("Interview Notes Tool");
    expect(f.userProblem).toMatch(/spend hours/);
  });

  it("reads 'As a <role>' pitches", () => {
    const f = heuristicStructure("As a nurse, handovers at shift change take 30 minutes and details get lost. An app that records spoken handover notes and turns them into a checklist for the next shift.");
    expect(f.targetAudience).toBe("Nurses");
    expect(f.name).toBe("Handover Notes App");
  });
});
