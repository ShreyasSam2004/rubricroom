import { describe, expect, it } from "vitest";
import { fallbackName } from "@/lib/agents/atlas";
import { heuristicAssessment, heuristicOpening, openingQuestion, type VerdictContext } from "@/lib/agents/verdict";
import { countKey, partialString } from "@/lib/ai/partial";
import { endOfDay, formatDeadline, resolveDeadline, statesTime } from "@/lib/deadline";
import { emptyExtraction, type SourceForExtraction } from "@/lib/extract/contract";
import { upcomingFirst } from "@/lib/services/hackathons";
import { isPlaceholder } from "@/lib/text";

describe("reading a reply while the model is still writing it", () => {
  it("decodes a string field so far and says whether it is finished", () => {
    expect(partialString('{"judgeRole":"user_adv', "judgeRole")).toEqual({ value: "user_adv", complete: false });
    expect(partialString('{"judgeRole":"user_advocate","reply":"You said \\"4 hours\\", but who', "reply")).toEqual({ value: 'You said "4 hours", but who', complete: false });
    expect(partialString('{"reply":"caf\\u00e9 and\\nmore"}', "reply")).toEqual({ value: "café and\nmore", complete: true });
    expect(partialString('{"reply": "spaced', "reply")).toEqual({ value: "spaced", complete: false });
  });

  it("waits for an escape split across chunks instead of printing half of it", () => {
    expect(partialString('{"reply":"line one\\', "reply")?.value).toBe("line one");
    expect(partialString('{"reply":"x\\u00', "reply")?.value).toBe("x");
    expect(partialString('{"judgeRole":"demo_judge"', "reply")).toBeNull();
  });

  it("counts list entries the model has started", () => {
    expect(countKey('{"criteria":[{"criterionId":"a","rating":3},{"criterionId":"b', "criterionId")).toBe(2);
    expect(countKey('{"criteria":[', "criterionId")).toBe(0);
  });
});

describe("deadlines given as a date only", () => {
  it("tells a stated time of day from a bare date", () => {
    expect(statesTime("Apr 26, 2026")).toBe(false);
    expect(statesTime("Track 3 Submission Closes — 28 June 2026")).toBe(false);
    expect(statesTime("November 7, 2026, 11:59 PM IST")).toBe(true);
    expect(statesTime("31 Oct 2026, 23:59 IST")).toBe(true);
    expect(statesTime("noon on 3 May")).toBe(true);
  });

  it("counts a date-only deadline to the end of that day, in the event's zone when known", () => {
    const utc = resolveDeadline({ value: "Apr 26, 2026", quote: "Apr 17 - Apr 26, 2026", dateIso: "2026-04-26" }, null);
    expect(utc).toEqual({ at: new Date("2026-04-26T23:59:00Z"), hasTime: false });
    const ist = resolveDeadline({ value: "Apr 26, 2026", dateIso: "2026-04-26T00:00:00Z" }, "Asia/Kolkata");
    expect(ist?.at.toISOString()).toBe("2026-04-26T18:29:00.000Z");
    // The day as written wins over an instant already shifted into another zone.
    const shifted = resolveDeadline({ value: "26 April 2026", dateIso: "2026-04-25T18:30:00Z", written: [{ year: 2026, month: 4, day: 26 }] }, null);
    expect(shifted?.at.toISOString()).toBe("2026-04-26T23:59:00.000Z");
    // Other dates in the text (the start of the event) never replace the deadline itself.
    const range = resolveDeadline({ value: "Apr 26, 2026 (hackathon runs Apr 17–26, 2026)", dateIso: "2026-04-26", written: [{ year: 2026, month: 4, day: 26 }, { year: null, month: 4, day: 17 }] }, null);
    expect(range?.at.toISOString()).toBe("2026-04-26T23:59:00.000Z");
  });

  it("keeps a stated time as extracted", () => {
    const r = resolveDeadline({ value: "November 7, 2026, 11:59 PM IST", dateIso: "2026-11-07T23:59:00+05:30" }, "Asia/Kolkata");
    expect(r).toEqual({ at: new Date("2026-11-07T18:29:00Z"), hasTime: true });
    // A stated time with a date-only instant uses the time as written.
    const r2 = resolveDeadline({ value: "7 Nov 2026, 5:00 pm", dateIso: "2026-11-07", written: [{ year: 2026, month: 11, day: 7, hour: 17, minute: 0 }] }, "Asia/Kolkata");
    expect(r2?.at.toISOString()).toBe("2026-11-07T11:30:00.000Z");
  });

  it("handles daylight-saving changes when finding the end of a day", () => {
    // 8 March 2026: New York moves to EDT (UTC−4), so 23:59 local is 03:59 UTC the next day.
    expect(endOfDay(2026, 3, 8, "America/New_York").toISOString()).toBe("2026-03-09T03:59:00.000Z");
  });

  it("shows only the date when the page gave only a date (no more 5:30 am)", () => {
    // The row the review found: stored as midnight UTC, shown as 5:30 am in IST.
    expect(formatDeadline({ deadlineAt: "2026-04-26T00:00:00Z", deadlineText: "Apr 26, 2026", timezone: null })).toBe("26 Apr 2026");
    expect(formatDeadline({ deadlineAt: "2026-04-26T23:59:00Z", deadlineText: "Apr 26, 2026", deadlineHasTime: false, timezone: null })).toBe("26 Apr 2026");
    expect(formatDeadline({ deadlineAt: "2026-04-26T18:29:00Z", deadlineText: "Apr 26, 2026", deadlineHasTime: false, timezone: "Asia/Kolkata" })).toBe("26 Apr 2026");
    expect(formatDeadline({ deadlineAt: "2026-10-31T18:29:00Z", deadlineText: "31 Oct 2026, 23:59 IST", timezone: "Asia/Kolkata" })).toMatch(/31 Oct 2026.*11:59\s*pm/i);
  });
});

describe("event names", () => {
  it("recognises a model's placeholder for a missing value", () => {
    for (const v of ["[Name not explicitly stated on page]", "(not stated)", "Not specified", "Unknown", "N/A", "", "  "]) expect(isPlaceholder(v)).toBe(true);
    for (const v of ["OpenMetadata Hackathon", "Not a Hackathon? Build Anyway", "No Hands: The Wispr Challenge"]) expect(isPlaceholder(v)).toBe(false);
  });

  it("falls back to the page's own name, then its title, then the domain", () => {
    const src = (title: string | null): SourceForExtraction => ({ ref: 0, sourceId: "src_1", url: "https://www.wemakedevs.org/hackathons/switch", title, sourceType: "official_page", authority: 1, publishedAt: null, retrievedAt: null, text: "", markupHints: [] });
    const named = { ...emptyExtraction(), name: "Flip the Switch Hackathon" };
    expect(fallbackName(named, [src(null)])).toBe("Flip the Switch Hackathon");
    const unnamed = { ...emptyExtraction(), name: "" };
    expect(fallbackName(unnamed, [src("Flip the Switch | WeMakeDevs")])).toBe("Flip the Switch");
    expect(fallbackName(unnamed, [src(null)])).toBe("wemakedevs.org");
  });
});

describe("the opening question", () => {
  const ctx: VerdictContext = {
    workspaceId: "ws_test",
    hackathon: { name: "No Hands", summary: "", sponsors: ["Wispr Flow"], deadline: null, track: null },
    criteria: [
      { id: "crit_problem", name: "Does it solve a real problem in your work?", description: "", weight: 30 },
      { id: "crit_work", name: "Does it work?", description: "A live link the judges can open and use.", weight: 25 },
    ],
    idea: { name: "Notes", summary: "A tool.", userProblem: "", targetAudience: "", workflow: "", features: [], differentiators: [], sponsorUsage: "", techStack: [] },
    personalRelevance: null,
    competitors: [],
    profile: null,
    language: "en",
  };

  it("offline, asks about the weakest criterion the mode's judges cover", async () => {
    const results = heuristicAssessment(ctx).results;
    const technical = heuristicOpening(ctx, results, { mode: "technical", intensity: 2, focusCriterionId: null });
    expect(technical.role).toBe("engineering_judge");
    expect(technical.text).toMatch(/flow must work live|riskiest part/i);
    const focused = heuristicOpening(ctx, results, { mode: "critical", intensity: 2, focusCriterionId: "crit_problem" });
    expect(focused.role).toBe("user_advocate");
    const o = await openingQuestion(ctx, { mode: "critical", intensity: 2, focusCriterionId: null });
    expect(o.method).toBe("heuristic");
  });
});

describe("hackathon order", () => {
  it("lists upcoming hackathons first (closing soonest first), then unknown, then past", () => {
    const now = new Date("2026-10-28T00:00:00Z");
    const list = [
      { name: "past-old", deadlineAt: new Date("2026-04-26T23:59:00Z") },
      { name: "later", deadlineAt: new Date("2026-11-30T00:00:00Z") },
      { name: "unknown", deadlineAt: null },
      { name: "soon", deadlineAt: new Date("2026-11-07T18:29:00Z") },
      { name: "past-recent", deadlineAt: new Date("2026-06-28T23:59:00Z") },
    ];
    expect(upcomingFirst(list, now).map((h) => h.name)).toEqual(["soon", "later", "unknown", "past-recent", "past-old"]);
  });
});
