// Sprint — Build Planner. Converts a selected idea into a calendar-true plan. The calendar,
// capacity and dependency rules are computed in code; AI (when available) only enriches wording
// and acceptance criteria, and its output is validated against the same constraints.

import { z } from "zod";
import { generateStructured, isAIConfigured } from "@/lib/ai";
import { isValidTimeZone } from "@/lib/extract/dates";
import { truncate } from "@/lib/text";
import type { DemoSegment, FeasibilityReview, IdeaFields, PlanArchitecture, PlanDay, PlanRisk, PlanTier, SubmissionRequirement } from "@/lib/types";

export interface CalendarDay {
  day: number;
  date: string; // YYYY-MM-DD in the plan timezone
  hours: number;
}

export interface PlanCalendar {
  days: CalendarDay[];
  totalHours: number;
  postDeadline: boolean;
  assumptions: string[];
}

function localDate(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function localHour(d: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + m / 60;
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Working days between now and the deadline, in the deadline's timezone. Day 1 is today and gets
 * only the hours left in the day; the last day ends at the deadline. Past deadline → a clearly
 * labelled post-deadline roadmap.
 */
export function computeCalendar(now: Date, deadline: Date | null, hoursPerDay: number, tz = "Asia/Kolkata"): PlanCalendar {
  const assumptions: string[] = [];
  const hpd = Math.max(1, Math.min(16, hoursPerDay));
  if (!deadline) {
    assumptions.push("The deadline is not verified, so a 5-day plan is shown. Verify the deadline to fit the plan to the real calendar.");
    const start = localDate(now, tz);
    const days = Array.from({ length: 5 }, (_, i) => ({ day: i + 1, date: addDays(start, i), hours: hpd }));
    return { days, totalHours: days.reduce((s, d) => s + d.hours, 0), postDeadline: false, assumptions };
  }
  if (deadline.getTime() <= now.getTime()) {
    assumptions.push("The submission deadline has passed. This is a post-deadline roadmap, not a hackathon plan.");
    const start = localDate(now, tz);
    const days = Array.from({ length: 5 }, (_, i) => ({ day: i + 1, date: addDays(start, i), hours: hpd }));
    return { days, totalHours: days.reduce((s, d) => s + d.hours, 0), postDeadline: true, assumptions };
  }
  const startDate = localDate(now, tz);
  const endDate = localDate(deadline, tz);
  const days: CalendarDay[] = [];
  for (let i = 0, date = startDate; date <= endDate && i < 60; i++, date = addDays(startDate, i)) {
    let hours = hpd;
    if (date === startDate) {
      const left = Math.max(0, 23.5 - localHour(now, tz));
      hours = Math.min(hpd, Math.round(left * 0.6 * 2) / 2); // realistic share of what's left today
    }
    if (date === endDate) {
      const untilDeadline = localHour(deadline, tz);
      hours = Math.min(hours, Math.round(Math.max(0, untilDeadline - 8) * 0.6 * 2) / 2);
    }
    days.push({ day: i + 1, date, hours });
  }
  const usable = days.filter((d) => d.hours > 0).map((d, i) => ({ ...d, day: i + 1 }));
  if (usable.length === 0) usable.push({ day: 1, date: startDate, hours: Math.max(1, Math.round(((deadline.getTime() - now.getTime()) / 3_600_000) * 0.6)) });
  assumptions.push(`Assumes about ${hpd}h of focused work per day (from your builder profile), less on the first and last day.`);
  return { days: usable, totalHours: usable.reduce((s, d) => s + d.hours, 0), postDeadline: false, assumptions };
}

export interface DraftTask {
  key: string;
  title: string;
  description: string;
  tier: "core" | "strong" | "optional";
  priority: "high" | "medium" | "low";
  estimateHours: number;
  dependsOn: string[];
  acceptance: string;
  day: number;
}

export interface PlanDraft {
  tiers: PlanTier[];
  architecture: PlanArchitecture;
  tasks: DraftTask[];
  days: PlanDay[];
  risks: PlanRisk[];
  assumptions: string[];
  postDeadline: boolean;
  totalHours: number;
  hoursPerDay: number;
  method: "ai" | "heuristic";
}

export interface PlanInput {
  idea: IdeaFields;
  feasibility: FeasibilityReview;
  submission: SubmissionRequirement[];
  sponsors: string[];
  deadline: Date | null;
  timezone: string | null;
  hoursPerDay: number;
  now?: Date;
  scopeChanges?: string | null;
  /** The builder asked for an N-day plan; it can be shorter than the time left, never longer. */
  maxDays?: number | null;
}

const SUBMISSION_HOURS: Record<string, number> = {
  demo_video: 2,
  project_url: 0.5,
  usage_evidence: 0.25,
  description: 0.75,
  repository: 0.5,
  screenshots: 0.5,
  presentation: 1.5,
  form: 0.25,
  sponsor_integration: 0.5,
  other: 0.5,
};

/** Pack tasks into days in dependency order without exceeding each day's capacity (except the last day for core work). */
function schedule(tasks: DraftTask[], calendar: CalendarDay[]) {
  const remaining = calendar.map((d) => d.hours);
  const lastDay = calendar.length;
  const placed = new Map<string, number>();
  const submissionKeys = new Set(tasks.filter((t) => t.key.startsWith("submit_")).map((t) => t.key));
  for (const t of tasks) {
    const earliest = Math.max(1, ...t.dependsOn.map((d) => placed.get(d) ?? 1));
    let day = earliest;
    if (submissionKeys.has(t.key)) day = lastDay; // submission artifacts are prepared at the end
    else {
      while (day < lastDay && remaining[day - 1] < t.estimateHours * 0.75) day++;
    }
    remaining[day - 1] -= t.estimateHours;
    t.day = day;
    placed.set(t.key, day);
  }
  return remaining;
}

export function deterministicPlan(input: PlanInput): PlanDraft {
  const now = input.now ?? new Date();
  const tz = input.timezone && isValidTimeZone(input.timezone) ? input.timezone : "Asia/Kolkata";
  const cal = computeCalendar(now, input.deadline, input.hoursPerDay, tz);
  if (input.maxDays && input.maxDays > 0) {
    if (input.maxDays < cal.days.length) {
      cal.days = cal.days.slice(0, input.maxDays);
      cal.totalHours = cal.days.reduce((s2, d) => s2 + d.hours, 0);
      cal.assumptions.push(`Compressed to the ${input.maxDays}-day plan you asked for; more calendar time remains before the deadline.`);
    } else if (input.maxDays > cal.days.length && !cal.postDeadline) {
      cal.assumptions.push(`You asked for ${input.maxDays} days, but only ${cal.days.length} remain before the deadline, so the plan uses ${cal.days.length}.`);
    }
  }
  const feats = input.idea.features.length ? input.idea.features : [input.idea.summary];
  const cutSet = new Set(input.feasibility.cut.map((c) => c.toLowerCase()));
  const mvpSet = new Set(input.feasibility.mvp.map((c) => c.toLowerCase()));
  const sponsor = input.sponsors.find((s) => !/wemakedevs|devpost|mlh/i.test(s));

  const tasks: DraftTask[] = [];
  tasks.push({
    key: "setup",
    title: "Set up the repo and deploy a skeleton to a public URL",
    description: "Create the project, pick the stack below, and deploy an empty page so the public link exists from day one.",
    tier: "core",
    priority: "high",
    estimateHours: 1.5,
    dependsOn: [],
    acceptance: "A public URL loads without login.",
    day: 1,
  });
  if (sponsor) {
    tasks.push({
      key: "sponsor",
      title: `Make ${sponsor} load-bearing in the core input flow`,
      description: input.idea.sponsorUsage || `Design the main interaction so ${sponsor} is how the user provides input, not a decoration.`,
      tier: "core",
      priority: "high",
      estimateHours: 1.5,
      dependsOn: ["setup"],
      acceptance: `The main flow works end-to-end using ${sponsor}.`,
      day: 1,
    });
  }
  const coreFeatures = feats.filter((f) => mvpSet.has(f.toLowerCase()) || (!mvpSet.size && feats.indexOf(f) < 3));
  const optional = feats.filter((f) => cutSet.has(f.toLowerCase()) && !coreFeatures.includes(f));
  const strong = feats.filter((f) => !coreFeatures.includes(f) && !optional.includes(f));
  coreFeatures.forEach((f, i) =>
    tasks.push({
      key: `core_${i}`,
      title: `Build: ${truncate(f, 80)}`,
      description: `Implement "${f}" end-to-end with real input.`,
      tier: "core",
      priority: "high",
      estimateHours: 3,
      dependsOn: [sponsor ? "sponsor" : "setup", ...(i > 0 ? [`core_${i - 1}`] : [])],
      acceptance: "Works with real data in the deployed app.",
      day: 1,
    }),
  );
  strong.forEach((f, i) =>
    tasks.push({
      key: `strong_${i}`,
      title: `Add: ${truncate(f, 80)}`,
      description: `Strengthens the demo once the core flow works.`,
      tier: "strong",
      priority: "medium",
      estimateHours: 2,
      dependsOn: [`core_${Math.max(0, coreFeatures.length - 1)}`],
      acceptance: "Visible in the demo and does not break the core flow.",
      day: 1,
    }),
  );
  tasks.push({
    key: "test",
    title: "Test the main flow with real use and fix what breaks",
    description: "Run the product on your own real problem (and one other person if you can). Write down what happened — it's evidence for the judges.",
    tier: "core",
    priority: "high",
    estimateHours: 1.5,
    dependsOn: [`core_${Math.max(0, coreFeatures.length - 1)}`],
    acceptance: "One real result produced by the product is saved.",
    day: 1,
  });
  optional.forEach((f, i) =>
    tasks.push({
      key: `optional_${i}`,
      title: `Optional: ${truncate(f, 80)}`,
      description: "Only if the core and strong-demo work is finished.",
      tier: "optional",
      priority: "low",
      estimateHours: 3,
      dependsOn: ["test"],
      acceptance: "Doesn't destabilise the demo.",
      day: 1,
    }),
  );
  const subs = input.submission.length
    ? input.submission
    : [{ key: "project_url", label: "Working project link", required: true, claimIds: [] }, { key: "demo_video", label: "Demo video", required: true, claimIds: [] }];
  for (const s of subs) {
    tasks.push({
      key: `submit_${s.key}_${tasks.length}`,
      title: `Prepare submission: ${truncate(s.label, 90)}`,
      description: s.detail ?? "Required by the hackathon's submission rules.",
      tier: "core",
      priority: "high",
      estimateHours: SUBMISSION_HOURS[s.key] ?? 0.5,
      dependsOn: ["test"],
      acceptance: s.detail ? `Meets: ${s.detail}` : "Ready to paste into the submission form.",
      day: 1,
    });
  }

  // Capacity check: if core work doesn't fit, push strong → optional and record it.
  const risks: PlanRisk[] = [];
  const coreHours = tasks.filter((t) => t.tier === "core").reduce((s, t) => s + t.estimateHours, 0);
  if (coreHours > cal.totalHours) {
    risks.push({
      id: "time_core",
      category: "time",
      description: `Core work needs ~${coreHours}h but only ~${cal.totalHours}h are available.`,
      likelihood: "high",
      mitigation: "Cut to one core flow and pre-record a backup demo.",
      scopeReduction: coreFeatures.slice(1).map((f) => `Defer "${truncate(f, 50)}"`).join("; ") || undefined,
    });
  }
  const allHours = tasks.filter((t) => t.tier !== "optional").reduce((s, t) => s + t.estimateHours, 0);
  if (allHours > cal.totalHours) {
    for (const t of tasks) if (t.tier === "strong") t.tier = "optional";
    risks.push({ id: "time_strong", category: "time", description: "Strong-demo features don't fit the remaining time.", likelihood: "medium", mitigation: "They were moved to Optional.", scopeReduction: "Strong-demo features moved to Optional." });
  }
  for (const i of input.feasibility.integrations) {
    if (i.difficulty === "low") continue;
    risks.push({
      id: `int_${i.name}`,
      category: /auth/i.test(i.name) ? "auth" : /llm|api/i.test(i.name) ? "api" : "dependency",
      description: `${i.name}: ${i.notes}`,
      likelihood: i.difficulty === "high" ? "high" : "medium",
      mitigation: i.difficulty === "high" ? "Replace with a simpler alternative or move to Optional." : "Build it early and keep a fallback path.",
      scopeReduction: i.difficulty === "high" ? `Remove ${i.name} from the MVP.` : undefined,
    });
  }
  if (input.feasibility.integrations.some((i) => /llm/i.test(i.name))) {
    risks.push({ id: "cost", category: "cost", description: "Model calls cost money and can be slow under public traffic.", likelihood: "medium", mitigation: "Cache demo results and add per-user usage limits." });
  }
  risks.push({ id: "deploy", category: "deployment", description: "Deploying late leaves no time to fix environment issues.", likelihood: "medium", mitigation: "Deploy on day 1 and redeploy after every working change." });
  risks.push({ id: "demo", category: "demo", description: "Live demos fail on stage (network, rate limits, cold starts).", likelihood: "medium", mitigation: "Record the demo video from the deployed app, with a cached example ready." });

  const sortedTasks = tasks.filter((t) => t.tier !== "optional").concat(tasks.filter((t) => t.tier === "optional"));
  schedule(sortedTasks, cal.days);
  const lastDay = cal.days.length;
  const days: PlanDay[] = cal.days.map((d) => {
    const dayTasks = sortedTasks.filter((t) => t.day === d.day);
    const coreTask = dayTasks.find((t) => t.tier === "core" && !t.key.startsWith("submit_"));
    return {
      day: d.day,
      date: d.date,
      hours: d.hours,
      goal:
        d.day === lastDay
          ? "Finish, record the demo from the live app, and submit before the deadline."
          : coreTask
            ? truncate(coreTask.title.replace(/^(Build|Add): /, ""), 90)
            : "Polish and buffer",
      artifact: d.day === 1 ? "Public URL with the skeleton deployed" : d.day === lastDay ? "Submitted project + demo video" : `Working: ${truncate(dayTasks.map((t) => t.title.replace(/^(Build|Add|Optional): /, "")).join(", "), 100) || "buffer"}`,
      risks: risks.filter((r) => r.likelihood === "high").slice(0, 2).map((r) => r.description),
    };
  });

  return {
    tiers: [
      { tier: "core", label: "Core MVP", features: coreFeatures },
      { tier: "strong", label: "Strong demo", features: sortedTasks.filter((t) => t.tier === "strong").map((t) => t.title.replace(/^Add: /, "")) },
      { tier: "optional", label: "Optional", features: sortedTasks.filter((t) => t.tier === "optional").map((t) => t.title.replace(/^(Optional|Add): /, "")) },
    ],
    architecture: defaultArchitecture(input),
    tasks: sortedTasks,
    days,
    risks,
    assumptions: [...cal.assumptions, ...input.feasibility.assumptions],
    postDeadline: cal.postDeadline,
    totalHours: cal.totalHours,
    hoursPerDay: input.hoursPerDay,
    method: "heuristic",
  };
}

function defaultArchitecture(input: PlanInput): PlanArchitecture {
  const ai = input.feasibility.integrations.some((i) => /llm/i.test(i.name));
  return {
    frontend: "Next.js (App Router) + Tailwind — one deployable web app, responsive on mobile.",
    backend: "Next.js route handlers (server-side), so keys never reach the browser.",
    ai: ai ? "Hosted LLM API with structured outputs; cache demo results; per-user limits." : "None required for the core flow.",
    storage: "Hosted Postgres (Neon/Supabase) — or SQLite/PGlite locally.",
    integrations: input.feasibility.integrations.map((i) => i.name),
    security: ["Keep API keys server-side", "Validate and size-limit all inputs", "No login required for judges (demo path)"],
    deployment: "Vercel (or similar) from day 1; redeploy after each working change.",
  };
}

export const AiPlanSchema = z.object({
  tasks: z.array(z.object({ key: z.string(), title: z.string(), description: z.string(), acceptance: z.string() })),
  dayGoals: z.array(z.object({ day: z.number().int(), goal: z.string(), artifact: z.string() })),
  architecture: z.object({ frontend: z.string(), backend: z.string(), ai: z.string(), storage: z.string(), integrations: z.array(z.string()), security: z.array(z.string()), deployment: z.string() }),
  extraRisks: z.array(z.object({ category: z.enum(["api", "cost", "auth", "deployment", "time", "dependency", "demo"]), description: z.string(), likelihood: z.enum(["low", "medium", "high"]), mitigation: z.string(), scopeReduction: z.string().nullable() })),
});

/** AI enrichment of the deterministic plan. Keys, days, tiers and dependencies are kept from code. */
export async function sprintPlan(workspaceId: string, input: PlanInput): Promise<PlanDraft> {
  const draft = deterministicPlan(input);
  if (!isAIConfigured()) return draft;
  let data: z.infer<typeof AiPlanSchema>;
  try {
    ({ data } = await generateStructured({
    agent: "sprint",
    workspaceId,
    schemaName: "sprint_plan",
    schema: AiPlanSchema,
    effort: "low",
    maxTokens: 8000,
    system: `You are Sprint, the build-planning agent in RubricRoom. You are given a calendar-true plan skeleton computed in code. Improve task titles, descriptions and acceptance criteria so each is concrete and testable, write a goal and expected demo artifact for each day, propose a sensible architecture for this idea, and add any missing risks. Do NOT add tasks, change task keys, or move work between days — the schedule is fixed by the real deadline.${input.scopeChanges ? " Respect the participant's scope change." : ""}`,
    prompt: JSON.stringify({ idea: input.idea, scopeChange: input.scopeChanges ?? null, skeleton: { tasks: draft.tasks.map(({ key, title, description, tier, day, estimateHours }) => ({ key, title, description, tier, day, estimateHours })), days: draft.days.map(({ day, date, hours }) => ({ day, date, hours })) }, feasibility: input.feasibility }),
  }));
  } catch {
    draft.assumptions.push("Sprint (AI) was unavailable, so task wording comes from the rule-based planner. The schedule is the same either way.");
    return draft;
  }
  const byKey = new Map(data.tasks.map((t) => [t.key, t]));
  for (const t of draft.tasks) {
    const e = byKey.get(t.key);
    if (e) Object.assign(t, { title: truncate(e.title, 140), description: e.description, acceptance: e.acceptance });
  }
  for (const d of draft.days) {
    const g = data.dayGoals.find((x) => x.day === d.day);
    if (g) Object.assign(d, { goal: g.goal, artifact: g.artifact });
  }
  draft.architecture = data.architecture;
  draft.risks.push(...data.extraRisks.map((r, i) => ({ id: `ai_${i}`, ...r, scopeReduction: r.scopeReduction ?? undefined })));
  draft.method = "ai";
  return draft;
}

// ---------------------------------------------------------------- demo strategy

export interface DemoInput {
  idea: IdeaFields;
  implemented: string[]; // features with completed tasks or attached evidence
  notImplemented: string[];
  realResults: string[]; // user-entered measurable outcomes / evidence notes
  sponsor: string | null;
  timeLimitSec: number;
  refinement: string | null;
  previous?: { hook: string; segments: DemoSegment[]; closing: string } | null;
}

export interface DemoDraft {
  hook: string;
  segments: DemoSegment[];
  closing: string;
  checklist: string[];
  excludedFeatures: string[];
  method: "ai" | "heuristic";
}

export function deterministicDemo(input: DemoInput): DemoDraft {
  const t = input.timeLimitSec;
  const at = (f: number) => Math.round(t * f);
  const core = input.implemented[0] ?? input.idea.workflow ?? input.idea.summary;
  const result = input.realResults[0] ?? "Show one real result the product produced (no simulated data).";
  const segments: DemoSegment[] = [
    { start: 0, end: at(0.13), title: "The real problem", narration: input.idea.userProblem || `The problem: ${input.idea.summary}`, onScreen: "You, or the painful 'before' workflow.", basedOn: [] },
    { start: at(0.13), end: at(0.3), title: "Open the product", narration: `This is ${input.idea.name}. It opens without login.`, onScreen: "The public URL and the first screen.", basedOn: input.implemented.slice(0, 1) },
    {
      start: at(0.3),
      end: at(0.65),
      title: "The strongest interaction",
      narration: input.sponsor ? `I ${/wispr/i.test(input.sponsor) ? "hold my Wispr Flow shortcut and speak" : `use ${input.sponsor}`} — ${truncate(core, 140)}.` : truncate(core, 180),
      onScreen: "The core flow, end to end, in one take.",
      basedOn: input.implemented.slice(0, 2),
    },
    { start: at(0.65), end: at(0.85), title: "The result", narration: result, onScreen: "The output, with the before/after visible.", basedOn: input.implemented.slice(0, 3) },
    { start: at(0.85), end: t, title: "Close", narration: `${input.idea.name}: ${truncate(input.idea.summary, 110)}`, onScreen: "Product URL + usage evidence.", basedOn: [] },
  ];
  return {
    hook: input.idea.userProblem ? truncate(input.idea.userProblem, 160) : `What if ${truncate(input.idea.summary.toLowerCase(), 120)}?`,
    segments,
    closing: `Try it at the public link — no login needed.`,
    checklist: [
      `Keep the video under ${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}.`,
      "Record from the deployed app, not localhost.",
      "Show one real result, not mock data.",
      input.sponsor ? `Make ${input.sponsor} visible on screen during the core interaction.` : "Show the core interaction in one continuous take.",
      "Use readable zoom (125–150%) and close unrelated tabs.",
      "Do a dry run with a timer before recording.",
    ],
    excludedFeatures: input.notImplemented,
    method: "heuristic",
  };
}

export const DemoSchema = z.object({
  hook: z.string(),
  segments: z.array(z.object({ start: z.number().int(), end: z.number().int(), title: z.string(), narration: z.string(), onScreen: z.string(), basedOn: z.array(z.string()) })),
  closing: z.string(),
  checklist: z.array(z.string()),
});

export async function sprintDemo(workspaceId: string, input: DemoInput): Promise<DemoDraft> {
  const base = deterministicDemo(input);
  if (!isAIConfigured()) {
    if (input.refinement) base.checklist.unshift(`Refinement noted (apply manually; no AI provider): "${truncate(input.refinement, 120)}"`);
    return base;
  }
  const { data } = await generateStructured({
    agent: "sprint",
    workspaceId,
    schemaName: "sprint_demo_script",
    schema: DemoSchema,
    effort: "low",
    maxTokens: 5000,
    system: `You write hackathon demo scripts. Only reference features in IMPLEMENTED; never show or narrate features in NOT IMPLEMENTED; never invent user results — use REAL RESULTS verbatim or tell the builder to capture one. Timestamps are seconds and must end at or before the time limit. Each segment's basedOn must list IMPLEMENTED features it shows (may be empty for problem/closing).`,
    prompt: JSON.stringify({ idea: input.idea, IMPLEMENTED: input.implemented, NOT_IMPLEMENTED: input.notImplemented, REAL_RESULTS: input.realResults, sponsor: input.sponsor, timeLimitSec: input.timeLimitSec, previousScript: input.previous ?? null, refinement: input.refinement }),
  });
  const allowed = new Set(input.implemented);
  const segments = data.segments
    .filter((s) => s.start < input.timeLimitSec)
    .map((s) => ({ ...s, end: Math.min(s.end, input.timeLimitSec), basedOn: s.basedOn.filter((b) => allowed.has(b)) }));
  return { hook: data.hook, segments: segments.length ? segments : base.segments, closing: data.closing, checklist: data.checklist, excludedFeatures: input.notImplemented, method: "ai" };
}
