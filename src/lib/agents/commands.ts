// "Ask RubricRoom" — natural-language (usually Wispr-dictated) commands mapped onto a typed,
// allowlisted registry. Nothing the user says is ever executed as code; mutating intents always
// come back with confirm=true so the UI asks before acting.

import { z } from "zod";
import { generateStructured, isAIConfigured, wrapUntrusted } from "@/lib/ai";
import type { CommandIntent } from "@/lib/types";

export const PAGES = {
  dashboard: { label: "Dashboard", href: "/" },
  hackathons: { label: "Explore Hackathons", href: "/hackathons" },
  intelligence: { label: "Hackathon Intelligence", href: "/hackathons/active" },
  radar: { label: "Opportunity Radar", href: "/radar" },
  ideas: { label: "My Ideas", href: "/ideas" },
  judge: { label: "Judge's Room", href: "/judge" },
  compare: { label: "Idea Comparison", href: "/compare" },
  plan: { label: "Build Strategy", href: "/plan" },
  evidence: { label: "Evidence Board", href: "/evidence" },
  sources: { label: "Research Sources", href: "/sources" },
  settings: { label: "Settings", href: "/settings" },
  demo: { label: "Demo Strategy", href: "/plan#demo" },
} as const;
export type PageKey = keyof typeof PAGES;

export const COMMAND_REGISTRY: Record<CommandIntent, { description: string; mutates: boolean }> = {
  navigate: { description: "Open a page", mutates: false },
  generate_ideas: { description: "Generate new opportunities in Opportunity Radar", mutates: true },
  compare_ideas: { description: "Compare saved ideas", mutates: false },
  start_debate: { description: "Start a Judge's Room debate on an idea", mutates: true },
  update_idea: { description: "Change the current idea (creates a new version)", mutates: true },
  query_rubric: { description: "Show what the judges reward", mutates: false },
  create_plan: { description: "Create a build plan for the selected idea", mutates: true },
  update_milestone: { description: "Mark a build task done / in progress", mutates: true },
  query_evidence: { description: "Show missing submission evidence", mutates: false },
  explain_assessment: { description: "Explain why an assessment changed", mutates: false },
  show_top_ideas: { description: "Show your top ideas", mutates: false },
  unknown: { description: "Not recognised", mutates: false },
};

export interface ParsedCommand {
  intent: CommandIntent;
  page: PageKey | null;
  params: {
    count?: number;
    days?: number;
    mode?: string;
    modifiers?: string[];
    ideaName?: string;
    taskQuery?: string;
    taskStatus?: "done" | "doing" | "todo";
    change?: string;
    request?: string;
  };
  confirm: boolean;
  summary: string;
  method: "rules" | "ai";
}

const PAGE_WORDS: [RegExp, PageKey][] = [
  [/opportunit|radar/i, "radar"],
  [/judge'?s? room|debate|judges? room/i, "judge"],
  [/compar/i, "compare"],
  [/evidence|proof/i, "evidence"],
  [/sources?|citations?|references/i, "sources"],
  [/build (plan|strategy)|plan\b|milestones?|tasks?/i, "plan"],
  [/demo (script|strategy|plan)/i, "demo"],
  [/my ideas|ideas list|saved ideas/i, "ideas"],
  [/intelligence|dossier|rules|hackathon details/i, "intelligence"],
  [/hackathons|explore/i, "hackathons"],
  [/settings|profile|preferences/i, "settings"],
  [/dashboard|home/i, "dashboard"],
];

const MODIFIER_WORDS: [RegExp, string][] = [
  [/less crowded|less common|not crowded|uncrowded/i, "less_crowded"],
  [/easier|simpler|less work|quick(er)? to build/i, "easier"],
  [/human impact|more impact|social good|helps people/i, "impact"],
  [/ambitious|harder|technical/i, "ambitious"],
  [/visual|demo-?able/i, "visual"],
  [/commercial|business|monetiz|make money/i, "commercial"],
  [/sponsor|wispr/i, "sponsor"],
  [/more ideas|generate more|another batch/i, "more"],
];

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
function num(text: string): number | undefined {
  const m = text.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
  if (!m) return undefined;
  return /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1].toLowerCase()];
}

/** Rule-based parser — handles the common commands instantly and offline. */
export function parseCommandRules(raw: string): ParsedCommand | null {
  const text = raw.trim().replace(/[.!?]+$/, "");
  if (!text) return null;
  const t = text.toLowerCase();
  const base = { params: {}, method: "rules" as const };

  if (/\b(why|explain)\b.*\b(score|assessment|rating|originality|changed?|went (up|down))\b/.test(t)) {
    return { ...base, intent: "explain_assessment", page: "ideas", confirm: false, summary: "Explain the latest assessment change" };
  }
  if (/\b(what|which)\b.*\b(evidence|proof)\b.*\b(missing|need|left)\b|\bmissing evidence\b/.test(t)) {
    return { ...base, intent: "query_evidence", page: "evidence", confirm: false, summary: "Show missing submission evidence" };
  }
  if (/\b(what|show)\b.*\bjudges?\b.*\b(care|want|reward|look|criteria)|\brubric\b|\bjudging criteria\b/.test(t)) {
    return { ...base, intent: "query_rubric", page: "intelligence", confirm: false, summary: "Show the official judging criteria" };
  }
  if (/\b(top|best)\b.*\bideas?\b/.test(t) && !/\b(generate|give|suggest)\b/.test(t)) {
    const count = num(t) ?? 3;
    return { ...base, intent: "show_top_ideas", page: "ideas", params: { count }, confirm: false, summary: `Show your top ${count} ideas` };
  }
  if (/\bcompare\b/.test(t)) {
    return { ...base, intent: "compare_ideas", page: "compare", confirm: false, summary: "Compare your saved ideas" };
  }
  if (/\b(create|make|build|generate)\b.*\b(plan|schedule|roadmap)\b|\b\d+[- ]day (implementation )?plan\b/.test(t)) {
    const days = num(t);
    return { ...base, intent: "create_plan", page: "plan", params: days ? { days } : {}, confirm: true, summary: `Create a${days ? ` ${days}-day` : ""} build plan for the selected idea` };
  }
  const milestone = t.match(/\bmark\b\s+(.+?)\s+(as\s+)?(done|complete|completed|finished|in progress|started|todo|not done)\b/);
  if (milestone) {
    const s = milestone[3];
    const taskStatus = /done|complete|finished/.test(s) ? "done" : /progress|started/.test(s) ? "doing" : "todo";
    return { ...base, intent: "update_milestone", page: "plan", params: { taskQuery: milestone[1], taskStatus }, confirm: true, summary: `Mark "${milestone[1]}" as ${taskStatus}` };
  }
  if (/\b(remove|drop|cut|add|change|rename|focus (only )?on|replace)\b.*\b(mvp|feature|idea|plan|scope|dashboard|app)\b/.test(t)) {
    return { ...base, intent: "update_idea", page: "ideas", params: { change: text }, confirm: true, summary: `Update the idea: "${text}"` };
  }
  if (/\b(give|generate|suggest|find|show)\b.*\b(ideas?|opportunit|something|directions?|alternatives?)\b|\bsomething (better|less|easier|more)\b/.test(t)) {
    const modifiers = MODIFIER_WORDS.filter(([re]) => re.test(t)).map(([, m]) => m);
    const mode = /\b(better than|alternative|instead of my)\b/.test(t) ? "alternative" : /crowded/.test(t) && !/less crowded/.test(t) ? "overcrowded" : /underserved|neglected/.test(t) ? "underserved" : /sponsor|wispr/.test(t) ? "sponsor" : "unsolved";
    return { ...base, intent: "generate_ideas", page: "radar", params: { mode, modifiers, request: text }, confirm: true, summary: `Generate ideas (${mode}${modifiers.length ? `; ${modifiers.join(", ")}` : ""})` };
  }
  if (/\b(start|begin|open)\b.*\b(debate|judge|judges)\b|\bchallenge my idea\b|\bdefend\b/.test(t)) {
    return { ...base, intent: "start_debate", page: "judge", confirm: false, summary: "Open the Judge's Room" };
  }
  if (/\b(open|go to|show|take me to|navigate)\b/.test(t)) {
    const hit = PAGE_WORDS.find(([re]) => re.test(t));
    if (hit) return { ...base, intent: "navigate", page: hit[1], confirm: false, summary: `Open ${PAGES[hit[1]].label}` };
  }
  const bare = PAGE_WORDS.find(([re]) => re.test(t));
  if (bare && t.split(/\s+/).length <= 3) return { ...base, intent: "navigate", page: bare[1], confirm: false, summary: `Open ${PAGES[bare[1]].label}` };
  return null;
}

export const AiCommandSchema = z.object({
  intent: z.enum(["navigate", "generate_ideas", "compare_ideas", "start_debate", "update_idea", "query_rubric", "create_plan", "update_milestone", "query_evidence", "explain_assessment", "show_top_ideas", "unknown"]),
  page: z.enum(["dashboard", "hackathons", "intelligence", "radar", "ideas", "judge", "compare", "plan", "evidence", "sources", "settings", "demo"]).nullable(),
  count: z.number().int().nullable(),
  days: z.number().int().nullable(),
  mode: z.enum(["unsolved", "overcrowded", "underserved", "sponsor", "combinations", "alternative"]).nullable(),
  modifiers: z.array(z.enum(["more", "ambitious", "impact", "less_crowded", "easier", "sponsor", "visual", "commercial"])),
  taskQuery: z.string().nullable(),
  taskStatus: z.enum(["done", "doing", "todo"]).nullable(),
  change: z.string().nullable(),
  summary: z.string(),
});

export async function interpretCommand(workspaceId: string, text: string): Promise<ParsedCommand> {
  const rules = parseCommandRules(text);
  const unknown: ParsedCommand = { intent: "unknown", page: null, params: {}, confirm: false, summary: "I couldn't map that to an action. Try “Open Opportunity Radar” or “Compare my ideas”.", method: "rules" };
  if (rules || !isAIConfigured()) return rules ?? unknown;
  let data: z.infer<typeof AiCommandSchema>;
  try {
    ({ data } = await generateStructured({
    agent: "command",
    workspaceId,
    schemaName: "rubricroom_command",
    schema: AiCommandSchema,
    effort: "low",
    maxTokens: 800,
    system: `You map a user's spoken request to exactly one RubricRoom command from a fixed list. You never execute anything. Intents: ${Object.entries(COMMAND_REGISTRY)
      .map(([k, v]) => `${k} = ${v.description}`)
      .join("; ")}. If nothing fits, use "unknown". The summary is a short confirmation sentence of what will happen.`,
    prompt: wrapUntrusted({ kind: "voice_command" }, text, 1200),
  }));
  } catch {
    return unknown;
  }
  return {
    intent: data.intent,
    page: data.page,
    params: {
      count: data.count ?? undefined,
      days: data.days ?? undefined,
      mode: data.mode ?? undefined,
      modifiers: data.modifiers,
      taskQuery: data.taskQuery ?? undefined,
      taskStatus: data.taskStatus ?? undefined,
      change: data.change ?? undefined,
      request: data.intent === "generate_ideas" ? text : undefined,
    },
    confirm: COMMAND_REGISTRY[data.intent].mutates,
    summary: data.summary,
    method: "ai",
  };
}
