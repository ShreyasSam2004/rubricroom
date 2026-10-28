// Structured concept comparison. Titles are deliberately ignored: two projects are only similar if
// their user, problem, workflow and output overlap. Scores are heuristics, labelled as such in the UI.

import { tokenize, truncate } from "@/lib/text";
import type { FingerprintDimension, OverlapLevel, ProjectFingerprint, SimilarityResult } from "@/lib/types";

export const DIMENSIONS: { key: FingerprintDimension; label: string; weight: number }[] = [
  { key: "problem", label: "Core problem", weight: 0.24 },
  { key: "targetUser", label: "Target user", weight: 0.16 },
  { key: "workflow", label: "Core workflow", weight: 0.18 },
  { key: "transformation", label: "What it does to the input", weight: 0.14 },
  { key: "output", label: "Output", weight: 0.1 },
  { key: "input", label: "Input", weight: 0.06 },
  { key: "technology", label: "Enabling technology", weight: 0.06 },
  { key: "delivery", label: "Delivery", weight: 0.06 },
];

const TECH = [
  "gemini", "openai", "gpt", "claude", "anthropic", "llm", "embedding", "rag", "whisper", "voice", "speech", "dictation", "wispr",
  "transcription", "github", "next.js", "nextjs", "react", "vue", "svelte", "python", "fastapi", "flask", "django", "node", "express",
  "firebase", "firestore", "supabase", "postgres", "mongodb", "vector", "langchain", "agent", "multi-agent", "computer vision", "ocr",
  "webrtc", "websocket", "chrome extension", "browser extension", "slack", "discord", "whatsapp", "telegram", "stripe", "twilio",
];
const DELIVERY: [RegExp, string][] = [
  [/chrome extension|browser extension/i, "browser extension"],
  [/\bios\b|android|mobile app|react native|flutter/i, "mobile app"],
  [/discord bot/i, "Discord bot"],
  [/slack (bot|app)/i, "Slack app"],
  [/whatsapp/i, "WhatsApp bot"],
  [/telegram/i, "Telegram bot"],
  [/\bcli\b|command[- ]line|terminal/i, "command-line tool"],
  [/vs ?code extension|ide plugin/i, "IDE extension"],
  [/\bapi\b|sdk/i, "API / SDK"],
  [/web ?app|website|dashboard|next\.js|react|browser/i, "web app"],
];

function sentences(text: string) {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 8);
}

function firstMatch(text: string, res: RegExp[]): string {
  for (const s of sentences(text)) if (res.some((r) => r.test(s))) return truncate(s, 220);
  return "";
}

/** Build a fingerprint from free text (README, Devpost story, product page) without a model. */
export function heuristicFingerprint(text: string, title = ""): ProjectFingerprint {
  const all = `${title}. ${text}`.slice(0, 20_000);
  const lower = all.toLowerCase();
  const userMatch =
    all.match(/\b(?:for|helps?|built for|designed for|aimed at|empowers?)\s+((?:hackathon\s+)?(?:teams?|participants?|students?|developers?|builders?|organi[sz]ers?|judges?|founders?|marketers?|recruiters?|job seekers?|candidates?|freelancers?|designers?|sales reps?|small businesses?|creators?|teachers?|patients?|doctors?|clinics?|engineers?)[^.,;]{0,60})/i) ?? null;
  const tech = TECH.filter((t) => lower.includes(t));
  const delivery = DELIVERY.find(([re]) => re.test(all))?.[1] ?? "";
  const counts = new Map<string, number>();
  for (const tok of tokenize(all)) counts.set(tok, (counts.get(tok) ?? 0) + 1);
  const keywords = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([t]) => t);
  return {
    targetUser: userMatch ? truncate(userMatch[1].trim(), 120) : "",
    problem: firstMatch(all, [/\b(problem|struggl|hard to|waste|pain|frustrat|time[- ]consuming|tedious|slow|manual|repetitive|confus|overwhelm|hours)\b/i]),
    workflow: firstMatch(all, [/\b(user|you|team|organi[sz]er)s?\s+(enter|paste|upload|type|speak|submit|provide|give|select|record)/i, /\bstep\b|\bthen\b.*\bthen\b/i]),
    input: firstMatch(all, [/\b(enter|paste|upload|input|provide|give it|submit|record|dictate)s?\b/i]),
    transformation: firstMatch(all, [/\b(analy[sz]|research|score|evaluat|compar|summari[sz]|extract|transcrib|classif|detect|investigat|generat|recommend|plan)\w*/i]),
    output: firstMatch(all, [/\b(returns?|produces?|generates?|outputs?|delivers?|creates?|turns? .* into|you get)\b/i]),
    technology: tech.join(", "),
    delivery,
    keywords,
  };
}

function tokenSet(s: string) {
  return new Set(tokenize(s));
}

export function jaccard(a: string, b: string): number | null {
  if (!a.trim() || !b.trim()) return null;
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (A.size === 0 || B.size === 0) return null;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  // Overlap coefficient blended with Jaccard: short fields shouldn't be punished for brevity.
  const jac = inter / (A.size + B.size - inter);
  const overlap = inter / Math.min(A.size, B.size);
  return 0.5 * jac + 0.5 * overlap;
}

export function cosine(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const va = new Map<string, number>();
  const vb = new Map<string, number>();
  for (const t of a) va.set(t, (va.get(t) ?? 0) + 1);
  for (const t of b) vb.set(t, (vb.get(t) ?? 0) + 1);
  let dot = 0;
  for (const [t, n] of va) dot += n * (vb.get(t) ?? 0);
  const na = Math.sqrt([...va.values()].reduce((s, n) => s + n * n, 0));
  const nb = Math.sqrt([...vb.values()].reduce((s, n) => s + n * n, 0));
  return na && nb ? dot / (na * nb) : 0;
}

export function levelFor(score: number): OverlapLevel {
  if (score >= 0.5) return "strong";
  if (score >= 0.32) return "moderate";
  if (score >= 0.18) return "adjacent";
  return "different";
}

export const LEVEL_LABEL: Record<OverlapLevel, string> = {
  strong: "Strong overlap",
  moderate: "Moderate overlap",
  adjacent: "Adjacent concept",
  different: "Different core problem",
};

/** Compare two fingerprints dimension by dimension; missing dimensions are excluded, not counted as 0. */
export function compareFingerprints(mine: ProjectFingerprint, theirs: ProjectFingerprint): SimilarityResult {
  const dims = {} as Record<FingerprintDimension, number>;
  let weighted = 0;
  let weightUsed = 0;
  const overlaps: string[] = [];
  const differences: string[] = [];
  for (const d of DIMENSIONS) {
    const sim = jaccard(mine[d.key], theirs[d.key]);
    dims[d.key] = sim ?? -1;
    if (sim === null) continue;
    weighted += sim * d.weight;
    weightUsed += d.weight;
    if (sim >= 0.45) overlaps.push(`${d.label}: both — "${truncate(theirs[d.key], 90)}"`);
    else if (sim < 0.12) differences.push(`${d.label}: theirs "${truncate(theirs[d.key], 70)}" vs yours "${truncate(mine[d.key], 70)}"`);
  }
  const kw = cosine(mine.keywords, theirs.keywords);
  const structural = weightUsed > 0 ? weighted / weightUsed : 0;
  // Keyword overlap only nudges the score; structure dominates when enough dimensions are present.
  const coverage = Math.min(1, weightUsed / 0.6);
  const score = Math.max(0, Math.min(1, structural * coverage * 0.85 + kw * (1 - coverage * 0.85)));
  return { score: Math.round(score * 100) / 100, level: levelFor(score), dimensions: dims, overlaps, differences, method: "heuristic" };
}

const GENERIC = new Set(["user", "help", "make", "get", "new", "one", "real", "time", "way", "work", "thing", "build", "built", "project", "product", "feature", "system", "platform", "app", "web", "data", "based", "simple", "easy", "using", "create"]);

/**
 * Compare an idea with a long, noisy document (README, Devpost story, product page) without a
 * model. Each idea dimension is matched against the *best matching sentence* in their text, and
 * weighted coverage of the idea's key terms is blended in. Overlaps quote their actual sentence.
 */
export function compareIdeaToDocument(mine: ProjectFingerprint, ideaText: string, theirText: string): SimilarityResult {
  // Only substantive sentences: headings, nav labels and short fragments match everything.
  const theirSentences = sentences(theirText)
    .filter((s) => !/^#/.test(s) && s.length >= 40)
    .slice(0, 400)
    .map((s) => ({ s, toks: new Set(tokenize(s)) }))
    .filter((x) => x.toks.size >= 6);
  const dims = {} as Record<FingerprintDimension, number>;
  const overlaps: string[] = [];
  const differences: string[] = [];
  let weighted = 0;
  let used = 0;
  for (const d of DIMENSIONS) {
    const mineToks = new Set(tokenize(mine[d.key]).filter((t) => !GENERIC.has(t)));
    if (mineToks.size === 0) {
      dims[d.key] = -1;
      continue;
    }
    let best = 0;
    let bestSentence = "";
    for (const { s, toks } of theirSentences) {
      let inter = 0;
      for (const t of mineToks) if (toks.has(t)) inter++;
      if (inter < 2 && mineToks.size > 2) continue;
      const recall = inter / mineToks.size;
      const precision = inter / toks.size;
      const sim = recall * (0.6 + 0.4 * Math.min(1, precision * 4));
      if (sim > best) {
        best = sim;
        bestSentence = s;
      }
    }
    dims[d.key] = Math.round(best * 100) / 100;
    weighted += best * d.weight;
    used += d.weight;
    if (best >= 0.32 && bestSentence) overlaps.push(`${d.label} — they write: “${truncate(bestSentence, 140)}”`);
    else if (best < 0.12) differences.push(`${d.label}: yours (“${truncate(mine[d.key], 80)}”) is not described in their reviewed page.`);
  }
  // Weighted coverage of the idea's most frequent distinctive terms.
  const counts = new Map<string, number>();
  for (const t of tokenize(ideaText)) if (!GENERIC.has(t)) counts.set(t, (counts.get(t) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  const theirSet = new Set(tokenize(theirText));
  const totalW = top.reduce((s, [, n]) => s + n, 0);
  const covered = top.reduce((s, [t, n]) => s + (theirSet.has(t) ? n : 0), 0);
  const coverage = totalW ? covered / totalW : 0;
  const structural = used ? weighted / used : 0;
  const score = Math.max(0, Math.min(1, 0.55 * structural + 0.45 * coverage * 0.8));
  return { score: Math.round(score * 100) / 100, level: levelFor(score), dimensions: dims, overlaps: overlaps.slice(0, 5), differences: differences.slice(0, 4), method: "heuristic" };
}

/** Two concepts are duplicates when problem, audience and workflow all substantially overlap. */
export function isDuplicateConcept(a: ProjectFingerprint, b: ProjectFingerprint): boolean {
  const p = jaccard(a.problem, b.problem) ?? 0;
  const u = jaccard(a.targetUser, b.targetUser) ?? 0;
  const w = jaccard(a.workflow, b.workflow) ?? 0;
  return p >= 0.5 && u >= 0.5 && w >= 0.45;
}
