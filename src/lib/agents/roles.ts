// Simulated evaluation roles. These are perspectives, not impersonations of real judges, and they
// claim no knowledge of any real judge's private preferences.

export type JudgeRole = "user_advocate" | "originality_skeptic" | "engineering_judge" | "sponsor_judge" | "demo_judge";

export const JUDGE_ROLES: Record<JudgeRole, { label: string; question: string; color: string }> = {
  user_advocate: { label: "The User Advocate", question: "Does someone genuinely need this?", color: "teal" },
  originality_skeptic: { label: "The Originality Skeptic", question: "How is this different from existing tools?", color: "violet" },
  engineering_judge: { label: "The Engineering Judge", question: "Can this be built and demonstrated reliably?", color: "slate" },
  sponsor_judge: { label: "The Sponsor Judge", question: "Is the required technology used meaningfully?", color: "amber" },
  demo_judge: { label: "The Demo Judge", question: "Will I understand the value in two minutes?", color: "coral" },
};

export type CriterionCategory = "problem" | "sponsor" | "working" | "demo" | "originality" | "other";

/** Classify on the criterion name first (descriptions often mention other criteria), then name + description. */
export function categorizeCriterion(name: string, description = ""): CriterionCategory {
  const byName = classify(name.toLowerCase());
  return byName !== "other" ? byName : classify(`${name} ${description}`.toLowerCase());
}

function classify(t: string): CriterionCategory {
  if (/\b(demo|presentation|pitch|video|clear|communicat|storytell)/.test(t)) return "demo";
  if (/\b(wispr|sponsor|use of|usage|integrat|meaningful|api|partner tech|technology used|used meaningfully)/.test(t)) return "sponsor";
  // "Does it solve a real problem in your work?" mentions "work" but is about the problem — check problem words first.
  if (/\b(problem|impact|need|solve|useful|value|relevan)/.test(t)) return "problem";
  if (/\b(work|working|functional|technical|execution|implementation|complete|quality|polish|live link|does it work)/.test(t)) return "working";
  if (/\b(original|novel|innovat|creativ|unique|differen)/.test(t)) return "originality";
  if (/\b(user|real)\b/.test(t)) return "problem";
  return "other";
}

export const CATEGORY_ROLE: Record<CriterionCategory, JudgeRole> = {
  problem: "user_advocate",
  sponsor: "sponsor_judge",
  working: "engineering_judge",
  demo: "demo_judge",
  originality: "originality_skeptic",
  other: "user_advocate",
};

export const DEBATE_MODES = {
  friendly: { label: "Friendly brainstorming", description: "Supportive, but still evidence-based." },
  critical: { label: "Critical judge", description: "Skeptical questions on every criterion." },
  stress: { label: "Aggressive stress test", description: "Hard questions, no benefit of the doubt." },
  technical: { label: "Technical feasibility review", description: "Architecture, scope and demo reliability." },
  originality: { label: "Originality challenge", description: "Overlap with existing projects." },
  rehearsal: { label: "Final pitch rehearsal", description: "Two-minute clarity and proof." },
} as const;

export type DebateMode = keyof typeof DEBATE_MODES;

export const MODE_ROLES: Record<DebateMode, JudgeRole[]> = {
  friendly: ["user_advocate", "demo_judge", "sponsor_judge"],
  critical: ["user_advocate", "originality_skeptic", "sponsor_judge", "engineering_judge", "demo_judge"],
  stress: ["originality_skeptic", "engineering_judge", "user_advocate", "sponsor_judge"],
  technical: ["engineering_judge"],
  originality: ["originality_skeptic"],
  rehearsal: ["demo_judge", "user_advocate"],
};
