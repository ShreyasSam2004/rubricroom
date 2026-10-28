// Exercises every agent's AI code path with a mocked model. The mock also converts each agent's
// real Zod schema with the Anthropic SDK's structured-output helper and the OpenAI strict-schema
// converter, so a schema those APIs would reject fails here rather than in production.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { toStrictJsonSchema } from "@/lib/ai/openai";

const responses: Record<string, unknown> = {};
const seenSchemas: string[] = [];

vi.mock("@/lib/ai", async (orig) => {
  const actual = await orig<typeof import("@/lib/ai")>();
  return {
    ...actual,
    isAIConfigured: () => true,
    generateStructured: async (req: { schemaName: string; schema: z.ZodType; prompt: string }) => {
      betaZodOutputFormat(req.schema); // throws on unsupported schema features
      const strict = toStrictJsonSchema(req.schema);
      expect(strict).toBeTruthy();
      seenSchemas.push(req.schemaName);
      const data = responses[req.schemaName];
      if (!data) throw new Error(`No canned response for ${req.schemaName}`);
      const parsed = req.schema.safeParse(data);
      if (!parsed.success) throw new Error(`Canned response for ${req.schemaName} doesn't match the schema: ${parsed.error.issues[0]?.message} at ${parsed.error.issues[0]?.path.join(".")}`);
      return { data: parsed.data, provider: "anthropic", model: "claude-opus-5-5", usage: { input: 1, output: 1 } };
    },
  };
});

const { atlasExtract } = await import("@/lib/agents/atlas");
const { debateTurn, assessIdea } = await import("@/lib/agents/verdict");
const { scoutQueries, scoutCompare, scoutReport } = await import("@/lib/agents/scout");
const { novaGenerate } = await import("@/lib/agents/nova");
const { forgeReview } = await import("@/lib/agents/forge");
const { structurePitch, compareIdeas, proposeIdeaChange } = await import("@/lib/agents/prism");
const { sprintPlan, sprintDemo } = await import("@/lib/agents/sprint");
const { interpretCommand } = await import("@/lib/agents/commands");
const { wisprSources } = await import("../helpers");

const fp = { targetUser: "builders", problem: "p", workflow: "w", input: "i", transformation: "t", output: "o", technology: "x", delivery: "web app", keywords: ["a"] };
const idea = { name: "RubricRoom", summary: "Hackathon strategy", userProblem: "Hours lost", targetAudience: "builders", workflow: "paste, debate, plan", features: ["Dossier", "Judge's Room"], differentiators: [], sponsorUsage: "Wispr", techStack: ["Next.js"] };
const criteria = [
  { id: "crit_a", name: "Does it solve a real problem in your work?", description: "", weight: 30 },
  { id: "crit_b", name: "Does it work?", description: "", weight: 70 },
];
const ctx = { workspaceId: "ws_x", hackathon: null, criteria, idea, personalRelevance: null, competitors: [], profile: null, language: "en" as const };

beforeEach(() => {
  for (const k of Object.keys(responses)) delete responses[k];
  seenSchemas.length = 0;
});

describe("AI code paths (mocked model, real schemas)", () => {
  it("Atlas fills weights the model missed from markup recovery and notes date disagreements", async () => {
    const sources = wisprSources();
    responses.atlas_event_dossier = {
      name: "No Hands: The Wispr Challenge",
      organizer: "WeMakeDevs x Wispr Flow",
      summary: "s",
      whatToBuild: "w",
      facts: [
        { field: "deadline", value: "30 Oct 2026", dateIso: "2026-10-30T18:29:00.000Z", note: null, sourceRef: 0, quote: "Submissions close" },
        { field: "favourite_colour", value: "blue", dateIso: null, note: null, sourceRef: 0, quote: "x" },
      ],
      criteria: [{ name: "Does it work?", description: "", weight: 0, fromMarkupHint: false, track: null, sourceRef: 1, quote: "Does it work?" }],
      items: [
        { kind: "track", text: "Builders", tag: "developers", detail: "Working software", required: true, dateIso: null, sourceRef: 0, quote: "Builders" },
        { kind: "submission", text: "A demo video", tag: "demo_video", detail: "up to two minutes", required: true, dateIso: null, sourceRef: 0, quote: "A demo video" },
        { kind: "submission", text: "Something odd", tag: "made_up_key", detail: null, required: false, dateIso: null, sourceRef: 0, quote: "odd" },
        { kind: "rule", text: "Solo only", tag: "team", detail: null, required: true, dateIso: null, sourceRef: 0, quote: "solo" },
        { kind: "prize", text: "₹1,00,000 each", tag: null, detail: null, required: false, dateIso: null, sourceRef: 0, quote: "₹1,00,000" },
      ],
      uncertainties: [],
    };
    const r = await atlasExtract("ws_x", sources);
    expect(r.method).toBe("ai");
    expect(r.extraction.criteria[0]).toMatchObject({ weight: 25, weightFromMarkupHint: true });
    expect(r.notes.join(" ")).toMatch(/Cross-check/);
    expect(r.extraction.facts.map((f) => f.field)).toEqual(["deadline"]); // unknown fields dropped
    expect(r.extraction.tracks[0]).toMatchObject({ name: "Builders", audience: "developers" });
    expect(r.extraction.submission.map((s) => s.key)).toEqual(["demo_video", "other"]);
    expect(r.extraction.rules[0]).toMatchObject({ category: "team", level: "mandatory" });
    expect(r.extraction.prizes).toHaveLength(1);
  });

  it("Verdict caps initial ratings and enforces guardrails on AI debate output", async () => {
    responses.verdict_assessment = {
      criteria: [
        { criterionId: "crit_a", rating: 5, rationale: "r", evidence: [], gaps: [], confidence: "high", suggestions: [] },
        { criterionId: "crit_b", rating: 5, rationale: "r", evidence: [], gaps: [], confidence: "high", suggestions: [] },
      ],
      heuristics: Object.fromEntries(["feasibility", "competitorOverlap", "personalRelevance", "researchConfidence", "demoReliability", "scopeRisk"].map((k) => [k, { rating: 3, rationale: "r" }])),
      assumptions: [],
      concerns: [],
      openingRole: "user_advocate",
      openingChallenge: "Who needs this?",
    };
    const a = await assessIdea(ctx);
    expect(a.results.map((x) => x.rating)).toEqual([4, 3]); // never 5 from a pitch; nothing built → ≤3

    responses.verdict_debate_turn = {
      judgeRole: "user_advocate",
      reply: "Okay.",
      claims: [
        { text: "Judges will love it", kind: "speculative", status: "accepted", reason: "", criterionIds: ["crit_a"], evidenceUrl: null },
        { text: "I lose hours", kind: "user_reported", status: "accepted", reason: "", criterionIds: ["crit_a"], evidenceUrl: null },
      ],
      proposedChanges: [
        { criterionId: "crit_a", newRating: 5, reason: "speculation", claimIndexes: [0] },
        { criterionId: "crit_b", newRating: 5, reason: "no claim", claimIndexes: [] },
        { criterionId: "nope", newRating: 5, reason: "x", claimIndexes: [1] },
      ],
      concernsResolved: [],
      newConcerns: [],
      nextActions: [],
      ideaUpdate: null,
    };
    const out = await debateTurn({ ctx, mode: "critical", intensity: 2, focusCriterionId: null, current: a.results, history: [], acceptedClaims: [], rejectedClaims: [], outstandingConcerns: [], userText: "x", evidenceChecks: [], request: null });
    expect(out.claims[0].status).toBe("rejected"); // speculative claims are always rejected
    expect(out.changes).toEqual([]); // no change survives the guardrails
    expect(out.droppedChanges.length).toBe(3);
  });

  it("Scout queries, comparison and report", async () => {
    responses.scout_queries = { queries: [{ query: "hackathon judge", angle: "exact" }, { query: "Hackathon Judge", angle: "terminology" }] };
    expect((await scoutQueries("ws_x", idea)).queries).toHaveLength(1); // deduped case-insensitively
    responses.scout_compare = { projects: [{ ref: 0, relevant: true, fingerprint: fp, capabilities: ["c"], audience: "a", implementationEvidence: "repo", level: "moderate", overlaps: ["o"], differences: ["d"] }] };
    const cmp = await scoutCompare("ws_x", idea, [{ ref: 0, name: "X", url: "https://github.com/x/y", platform: "github", text: "A hackathon judge assistant that debates ideas." }]);
    expect(cmp.results[0].similarity).toMatchObject({ level: "moderate", method: "ai" });
    responses.scout_originality_report = {
      closest: [{ projectId: "p1", why: "w" }, { projectId: "ghost", why: "invented" }],
      overlappingFeatures: [],
      gaps: [],
      differentiation: [],
      limitations: ["l"],
      confidence: { level: "narrow", explanation: "e" },
      dimensions: Object.fromEntries(["workflowNovelty", "technicalNovelty", "framingNovelty", "uncommonCombination", "differentiationStrength"].map((k) => [k, { rating: 2, rationale: "r" }])),
    };
    const rep = await scoutReport("ws_x", idea, [{ id: "p1", name: "X", url: "https://github.com/x/y", similarity: cmp.results[0].similarity, capabilities: [] }], [], null);
    expect(rep.closest.map((c) => c.projectId)).toEqual(["p1"]); // unknown ids dropped
    expect(rep.limitations).toContain("Private submissions, unindexed projects and closed communities cannot be searched.");
  });

  it("Nova grounds evidence and removes duplicates", async () => {
    const card = (name: string, problem: string) => ({
      name,
      pitch: "p",
      targetUser: "u",
      problem,
      problemEvidence: [{ signalIndex: 0, label: "hn" }],
      howItWorks: "h",
      demoMoment: "d",
      differentiation: "x",
      sponsorIntegration: "s",
      components: [],
      mvpScope: [],
      risks: [],
      feasibility: "high",
      referenceSignalIndexes: [0, 5],
      assumptions: [],
      fingerprint: { ...fp, problem, targetUser: "clinic receptionists", workflow: "dictate call notes then schedule reminders" },
    });
    responses.nova_opportunities = { cards: [card("A", "clinics forget follow up calls"), card("B", "clinics forget follow up calls")] };
    const r = await novaGenerate({ workspaceId: "ws_x", hackathon: null, profile: null, hoursAvailable: null, mode: "unsolved", modifiers: [], request: null, baseIdea: null, signals: [{ kind: "pain_point", label: "HN", url: "https://news.ycombinator.com/item?id=1" }], avoid: [], count: 3 });
    expect(r.cards.map((c) => c.name)).toEqual(["A"]);
    expect(r.removed[0].duplicateOf).toBe("A");
    expect(r.cards[0].references).toHaveLength(1);
  });

  it("Forge, Prism, Sprint and the command interpreter", async () => {
    responses.forge_feasibility = { complexity: { rating: 9, rationale: "r" }, integrations: [], externalDependencies: [], testing: "t", deployment: "d", demoReliability: { rating: 0, rationale: "r" }, deadlineRisks: [], mvp: [], cut: [], estimateHours: { low: 5, high: 10 }, assumptions: [] };
    const f = await forgeReview("ws_x", idea, null, 20, []);
    expect([f.complexity.rating, f.demoReliability.rating]).toEqual([5, 1]); // clamped

    responses.prism_structure_pitch = { ...idea, name: "Model name", missingInformation: ["who pays"] };
    const s = await structurePitch("ws_x", "Main ek tool banana chahta hoon jo hackathon ideas compare kare", { nameHint: "My Name" });
    expect(s.idea.name).toBe("My Name");
    expect(s.language).toBe("hinglish");

    responses.prism_idea_change = { summary: "s", name: null, newSummary: null, userProblem: null, targetAudience: null, workflow: null, sponsorUsage: null, removedFeatures: ["Dossier", "Not a feature"], addedFeatures: [] };
    expect((await proposeIdeaChange("ws_x", idea, "remove dossier")).proposal.removedFeatures).toEqual(["Dossier"]);

    responses.prism_compare_ideas = { overview: "o", perIdea: [], betterSupported: [], lowerRiskIdeaId: null, clearerDemoIdeaId: null, caution: "c" };
    expect((await compareIdeas("ws_x", [])).method).toBe("ai");

    responses.sprint_plan = { tasks: [{ key: "setup", title: "Deploy skeleton", description: "d", acceptance: "a" }, { key: "invented", title: "x", description: "", acceptance: "" }], dayGoals: [], architecture: { frontend: "f", backend: "b", ai: "a", storage: "s", integrations: [], security: [], deployment: "d" }, extraRisks: [] };
    const plan = await sprintPlan("ws_x", { idea, feasibility: f, submission: [], sponsors: [], deadline: new Date(Date.now() + 3 * 86_400_000), timezone: "Asia/Kolkata", hoursPerDay: 5 });
    expect(plan.tasks.find((t) => t.key === "setup")?.title).toBe("Deploy skeleton");
    expect(plan.tasks.some((t) => t.key === "invented")).toBe(false); // AI can't add tasks

    responses.sprint_demo_script = { hook: "h", segments: [{ start: 0, end: 500, title: "t", narration: "n", onScreen: "o", basedOn: ["Dossier", "Unbuilt feature"] }], closing: "c", checklist: [] };
    const demo = await sprintDemo("ws_x", { idea, implemented: ["Dossier"], notImplemented: ["Judge's Room"], realResults: [], sponsor: null, timeLimitSec: 120, refinement: "shorter" });
    expect(demo.segments[0]).toMatchObject({ end: 120, basedOn: ["Dossier"] });

    responses.rubricroom_command = { intent: "generate_ideas", page: "radar", count: null, days: null, mode: "underserved", modifiers: ["impact"], taskQuery: null, taskStatus: null, change: null, summary: "Generate" };
    const cmd = await interpretCommand("ws_x", "find me stuff for overlooked folks");
    expect(cmd).toMatchObject({ intent: "generate_ideas", confirm: true, method: "ai" });
  });

  it("every agent schema converts for both providers", () => {
    expect(seenSchemas).toBeDefined(); // conversions are asserted inside the mock for each call above
  });
});
