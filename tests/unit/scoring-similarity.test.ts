import { describe, expect, it } from "vitest";
import { diversify, groundCards, type RawCard, type Signal } from "@/lib/agents/nova";
import { heuristicQueries, ideaDocText, ideaFingerprint, shortQuery } from "@/lib/agents/scout";
import { compareIdeaToDocument, isDuplicateConcept } from "@/lib/research/similarity";
import { criteriaForTrack, normalizeWeights, weightedTotal } from "@/lib/scoring";
import type { IdeaFields, ProjectFingerprint } from "@/lib/types";

describe("scoring", () => {
  const crit = [
    { id: "a", name: "Problem", weight: 30 },
    { id: "b", name: "Wispr", weight: 30 },
    { id: "c", name: "Works", weight: 25 },
    { id: "d", name: "Demo", weight: 15 },
  ];

  it("uses official weights that sum to 100", () => {
    const n = normalizeWeights(crit);
    expect(n.basis).toBe("official");
    expect([...n.weights.values()]).toEqual([30, 30, 25, 15]);
  });

  it("normalizes weights that don't sum to 100", () => {
    const n = normalizeWeights([
      { id: "a", name: "A", weight: 2 },
      { id: "b", name: "B", weight: 2 },
    ]);
    expect(n.basis).toBe("normalized");
    expect([...n.weights.values()]).toEqual([50, 50]);
  });

  it("labels equal weights as illustrative when any weight is missing", () => {
    const n = normalizeWeights([
      { id: "a", name: "A", weight: null },
      { id: "b", name: "B", weight: 40 },
    ]);
    expect(n.basis).toBe("illustrative");
    expect(n.note).toMatch(/illustrative/);
  });

  it("computes Σ(rating/5 × weight)", () => {
    const n = normalizeWeights(crit);
    expect(weightedTotal([{ criterionId: "a", rating: 5 }, { criterionId: "b", rating: 0 }, { criterionId: "c", rating: 4 }, { criterionId: "d", rating: 3 }], n.weights)).toBe(59);
    expect(weightedTotal([{ criterionId: "a", rating: 9 }], n.weights)).toBe(30); // clamped
  });

  it("filters track-specific criteria", () => {
    const list = [
      { id: "1", track: null },
      { id: "2", track: "Builders" },
      { id: "3", track: "No-Code" },
    ];
    expect(criteriaForTrack(list, "Builders").map((c) => c.id)).toEqual(["1", "2"]);
    expect(criteriaForTrack(list, null).map((c) => c.id)).toEqual(["1"]);
  });
});

const idea = (over: Partial<IdeaFields>): IdeaFields => ({
  name: "X",
  summary: "",
  userProblem: "",
  targetAudience: "",
  workflow: "",
  features: [],
  differentiators: [],
  sponsorUsage: "",
  techStack: [],
  ...over,
});

describe("similarity", () => {
  const interview = idea({
    name: "InterviewAce",
    summary: "AI mock interview coach that asks role-specific questions and scores answers.",
    userProblem: "Job seekers practise technical interviews without structured feedback on their answers.",
    targetAudience: "job seekers preparing for technical interviews",
    workflow: "Candidate picks a role, answers mock interview questions by voice, and receives feedback on each answer.",
    features: ["Role-specific mock interview questions", "Answer scoring with feedback"],
  });

  it("finds overlap between the same concept under a different name", () => {
    const doc = "PrepPal is a mock interview practice tool for job seekers preparing for technical interviews. Candidates pick a role and answer interview questions; the coach scores each answer and gives structured feedback so they can practise again.";
    const r = compareIdeaToDocument(ideaFingerprint(interview), ideaDocText(interview), doc);
    expect(["strong", "moderate"]).toContain(r.level);
    expect(r.overlaps.length).toBeGreaterThan(0);
  });

  it("does not equate projects just because their names are similar", () => {
    const doc = "InterviewAce Logistics is a fleet-tracking dashboard for truck dispatchers. Dispatchers upload delivery manifests and the system optimizes routes and fuel stops across warehouses.";
    const r = compareIdeaToDocument(ideaFingerprint(interview), ideaDocText(interview), doc);
    expect(r.level).toBe("different");
  });

  it("detects duplicate concepts and the diversity filter removes them", () => {
    const fp = (problem: string, user: string, workflow: string): ProjectFingerprint => ({ targetUser: user, problem, workflow, input: "", transformation: "", output: "", technology: "", delivery: "", keywords: [] });
    const a = fp("freelancers rewrite proposals for every client lead", "independent freelancers", "paste client brief then draft tailored proposal");
    const renamed = fp("freelancers rewrite proposals for every client lead again", "independent freelancers bidding", "paste the client brief then draft a tailored proposal");
    const other = fp("clinic receptionists lose track of patient follow-up calls", "small clinic receptionists", "dictate call notes then schedule reminders");
    expect(isDuplicateConcept(a, renamed)).toBe(true);
    expect(isDuplicateConcept(a, other)).toBe(false);
    const card = (name: string, f: ProjectFingerprint) => ({ name, fingerprint: f }) as never;
    const res = diversify([card("BidWriter", a), card("ProposalPro", renamed), card("FollowUp", other)], []);
    expect(res.cards.map((c: { name: string }) => c.name)).toEqual(["BidWriter", "FollowUp"]);
    expect(res.removed).toEqual([{ name: "ProposalPro", duplicateOf: "BidWriter" }]);
  });
});

describe("code-search query shortening", () => {
  it("keeps the distinctive words of a natural-language query", () => {
    expect(shortQuery("AI hackathon idea evaluator against judging rubric")).toBe("hackathon idea evaluator");
    expect(shortQuery("how to choose winning hackathon idea tool")).toBe("hackathon idea");
    expect(shortQuery("voice AI debate coach", 2)).toBe("voice debate");
  });
});

describe("Scout query generation", () => {
  it("searches several angles, never just the product title", () => {
    const q = heuristicQueries(
      idea({
        name: "AI Interview Academy",
        summary: "An AI interview preparation platform with specialized agents, video calls, coding tests, and a personalized dashboard.",
        userProblem: "Candidates practise interviews without structured feedback.",
        features: ["Specialized interviewer agents", "Video calls", "Coding tests"],
      }),
    );
    expect(q.length).toBeGreaterThanOrEqual(4);
    expect(new Set(q.map((x) => x.angle)).size).toBeGreaterThanOrEqual(3);
    expect(q.every((x) => x.query.split(" ").length <= 4)).toBe(true);
    expect(q.some((x) => x.query.toLowerCase() === "ai interview academy")).toBe(false);
  });
});

describe("Nova evidence discipline", () => {
  const signals: Signal[] = [
    { kind: "pain_point", label: "HN comment: I waste hours on follow-ups", url: "https://news.ycombinator.com/item?id=1" },
    { kind: "competitor", label: "Existing project", url: "https://github.com/a/b" },
  ];
  const raw = (over: Partial<RawCard>): RawCard => ({
    name: "N",
    pitch: "",
    targetUser: "",
    problem: "",
    problemEvidence: [],
    howItWorks: "",
    demoMoment: "",
    differentiation: "",
    sponsorIntegration: "",
    components: [],
    mvpScope: [],
    risks: [],
    feasibility: "medium",
    referenceSignalIndexes: [],
    assumptions: [],
    fingerprint: { targetUser: "", problem: "", workflow: "", input: "", transformation: "", output: "", technology: "", delivery: "", keywords: [] },
    ...over,
  });

  it("only marks problems observed when a real pain-point signal backs them", () => {
    const [card] = groundCards([raw({ problemEvidence: [{ signalIndex: 0, label: "follow-ups" }, { signalIndex: null, label: "everyone hates email" }, { signalIndex: 1, label: "competitor" }, { signalIndex: 99, label: "made up" }] })], signals, "unsolved");
    expect(card.problemEvidence.map((e) => e.observed)).toEqual([true, false, false, false]);
    expect(card.problemEvidence[0].url).toBe("https://news.ycombinator.com/item?id=1");
    expect(card.problemEvidence[3].url).toBeUndefined();
  });

  it("drops references that point at nothing research retrieved", () => {
    const [card] = groundCards([raw({ referenceSignalIndexes: [1, 7] })], signals, "unsolved");
    expect(card.references).toEqual([{ label: "Existing project", url: "https://github.com/a/b" }]);
  });
});
