import { describe, expect, it } from "vitest";
import { applyGuardrails, heuristicAssessment, heuristicDebate, type DebateInput, type VerdictContext } from "@/lib/agents/verdict";
import { categorizeCriterion } from "@/lib/agents/roles";
import type { CriterionResult, DebateClaim } from "@/lib/types";

const criteria = [
  { id: "crit_problem", name: "Does it solve a real problem in your work?", description: "A specific problem, a clear user, and a tool that person would keep using.", weight: 30 },
  { id: "crit_wispr", name: "Was Wispr used meaningfully?", description: "Flow is part of the build and the workflow, and your demo and usage card show it.", weight: 30 },
  { id: "crit_work", name: "Does it work?", description: "A live link the judges can open and use.", weight: 25 },
  { id: "crit_demo", name: "Is the demo clear?", description: "A two-minute video anyone can follow.", weight: 15 },
];

const ctx: VerdictContext = {
  workspaceId: "ws_test",
  hackathon: { name: "No Hands", summary: "", sponsors: ["WeMakeDevs", "Wispr Flow"], deadline: null, track: null },
  criteria,
  idea: {
    name: "AI Interview Academy",
    summary: "An AI interview preparation platform with specialized agents, video calls, coding tests, and a personalized dashboard.",
    userProblem: "Candidates practise interviews without structured feedback.",
    targetAudience: "Job seekers",
    workflow: "Pick a role, run a mock interview, get feedback on a dashboard.",
    features: ["Specialized interviewer agents", "Video calls", "Coding tests", "Personalized dashboard"],
    differentiators: [],
    sponsorUsage: "",
    techStack: [],
  },
  personalRelevance: null,
  competitors: [],
  profile: null,
  language: "en",
};

const current = (): CriterionResult[] => heuristicAssessment(ctx).results;

function input(userText: string, over: Partial<DebateInput> = {}): DebateInput {
  return { ctx, mode: "critical", intensity: 2, focusCriterionId: null, current: current(), history: [], acceptedClaims: [], rejectedClaims: [], outstandingConcerns: [], userText, evidenceChecks: [], ...over };
}

describe("criterion categories", () => {
  it("classifies the Wispr rubric by name first", () => {
    expect(criteria.map((c) => categorizeCriterion(c.name, c.description))).toEqual(["problem", "sponsor", "working", "demo"]);
  });
});

describe("initial assessment", () => {
  it("never rates above 3 from a pitch alone and penalizes risky scope", () => {
    const r = heuristicAssessment(ctx);
    expect(Math.max(...r.results.map((x) => x.rating))).toBeLessThanOrEqual(3);
    expect(r.results.find((x) => x.criterionId === "crit_work")!.rating).toBeLessThan(3); // video calls
    expect(r.results.find((x) => x.criterionId === "crit_wispr")!.rating).toBe(1); // no sponsor usage stated
  });
});

describe("guardrails (enforced in code)", () => {
  const claim = (over: Partial<DebateClaim>): DebateClaim => ({ id: "c1", text: "t", kind: "user_reported", status: "accepted", reason: "", criterionIds: [], ...over });

  it("blocks increases with no accepted claim", () => {
    const { changes, dropped } = applyGuardrails([{ criterionId: "crit_problem", newRating: 5, reason: "you insisted", claimIndexes: [] }], [], current());
    expect(changes).toHaveLength(0);
    expect(dropped[0].reason).toMatch(/No accepted/);
  });

  it("blocks increases supported only by speculation", () => {
    const { changes } = applyGuardrails([{ criterionId: "crit_problem", newRating: 4, reason: "", claimIndexes: [0] }], [claim({ kind: "speculative" })], current());
    expect(changes).toHaveLength(0);
  });

  it("caps user-reported support at +1 and below 5", () => {
    const base = current();
    const from = base.find((r) => r.criterionId === "crit_problem")!.rating;
    const { changes } = applyGuardrails([{ criterionId: "crit_problem", newRating: 5, reason: "personal experience", claimIndexes: [0] }], [claim({})], base);
    expect(changes[0].to).toBe(Math.min(4, from + 1));
  });

  it("allows +2 with a reachable link, but not the hackathon's own site", () => {
    const base = current();
    const from = base.find((r) => r.criterionId === "crit_work")!.rating;
    const ok = applyGuardrails([{ criterionId: "crit_work", newRating: 5, reason: "deployed", claimIndexes: [0] }], [claim({ kind: "verifiable", evidenceCheck: { reachable: true, checkedAt: "" } })], base);
    expect(ok.changes[0].to).toBe(from + 2);
    const own = applyGuardrails([{ criterionId: "crit_work", newRating: 5, reason: "deployed", claimIndexes: [0] }], [claim({ kind: "verifiable", evidenceCheck: { reachable: true, checkedAt: "", ownSite: true } })], base);
    expect(own.changes[0].to).toBe(from + 1);
  });

  it("ignores criteria that are not in the rubric", () => {
    const { changes, dropped } = applyGuardrails([{ criterionId: "made_up", newRating: 5, reason: "x", claimIndexes: [0] }], [claim({})], current());
    expect(changes).toHaveLength(0);
    expect(dropped[0].reason).toMatch(/Not a criterion/);
  });
});

describe("offline Judge's Room turn", () => {
  it("accepts first-hand experience as user-reported and moves only the problem criterion", () => {
    const out = heuristicDebate(input("I personally prepare for interviews every day. My version remembers each weakness and retests me after tutoring."));
    expect(out.claims.map((c) => [c.kind, c.status])).toEqual([
      ["user_reported", "accepted"],
      ["differentiator", "accepted"],
    ]);
    expect(out.changes.map((c) => c.criterionId)).toEqual(["crit_problem"]);
    expect(out.changes[0].to - out.changes[0].from).toBe(1);
    expect(out.reply).toMatch(/differentiator/);
  });

  it("rejects speculation and challenges unsupported numbers", () => {
    const out = heuristicDebate(input("Judges will love it. I tested it with 14 users."));
    expect(out.claims.find((c) => c.kind === "speculative")?.status).toBe("rejected");
    expect(out.claims.find((c) => c.kind === "verifiable")?.status).toBe("needs_evidence");
    expect(out.changes).toHaveLength(0);
  });

  it("does not reward repeating an already-accepted claim", () => {
    const text = "I personally prepare for interviews every day.";
    const first = heuristicDebate(input(text));
    const again = heuristicDebate(input(text, { acceptedClaims: first.claims }));
    expect(again.changes).toHaveLength(0);
    expect(again.reply).toMatch(/doesn't add new evidence|nothing changes/);
  });

  it("turns a dictated correction into a proposal (not an applied change), removing only what was asked", () => {
    const out = heuristicDebate(input("You misunderstood my idea. Remove the video calls from the MVP and focus on the web dashboard."));
    expect(out.ideaUpdate?.removedFeatures).toEqual(["Video calls"]);
    expect(out.changes).toHaveLength(0);
  });

  it("keeps working with mixed-language (Hinglish) answers", () => {
    const out = heuristicDebate(input("Main personally har din interviews ki practice karta hoon aur mujhe structured feedback nahi milta."));
    expect(out.reply.length).toBeGreaterThan(20);
  });
});

describe("Judge's Room loop (review fixes)", () => {
  const question = (reply: string) => reply.trim().split("\n").pop()!.split(": ").pop()!;

  it("accepts a specific first-hand answer as user-reported evidence (+1, capped at 4)", () => {
    const out = heuristicDebate(input("Last month I ran 11 interviews for one role. Writing feedback took me about 4 hours."));
    const firstHand = out.claims.filter((c) => c.kind === "user_reported" && c.status === "accepted");
    expect(firstHand.length).toBeGreaterThan(0);
    const change = out.changes.find((c) => c.criterionId === "crit_problem");
    expect(change && change.to - change.from).toBe(1);
    expect(change!.to).toBeLessThanOrEqual(4);
  });

  it("does not ask the same question twice in a row", () => {
    const first = heuristicDebate(input("Last month I ran 11 interviews for one role."));
    const second = heuristicDebate(input("I personally wrote all 9 rejection emails myself.", { history: [{ speaker: "judge", role: first.role, text: first.reply }] }));
    expect(question(second.reply)).not.toBe(question(first.reply));
  });

  it("bases starting scores on what the pitch shows, not a flat default", () => {
    const concrete = heuristicAssessment({
      ...ctx,
      idea: { ...ctx.idea, name: "Interview Notes Tool", summary: "Turns dictated interview notes into feedback.", userProblem: "I spend 4 hours a week writing interview feedback and candidates wait days.", targetAudience: "Hiring managers", sponsorUsage: "Notes are dictated with Wispr Flow right after each interview." },
    }).results;
    const vague = current();
    const rating = (r: CriterionResult[], id: string) => r.find((x) => x.criterionId === id)!.rating;
    expect(rating(concrete, "crit_problem")).toBeGreaterThan(rating(vague, "crit_problem"));
    expect(rating(concrete, "crit_wispr")).toBeGreaterThan(rating(vague, "crit_wispr"));
  });
});
