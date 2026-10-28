import { and, desc, eq } from "drizzle-orm";
import { CROWDED_PROBES, novaGenerate, type DiscoveryMode, type Modifier, type Signal } from "@/lib/agents/nova";
import { describeAIError, isAIConfigured } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { builderProfiles, existingProjects, hackathons, judgingCriteria, opportunitySets, projectIdeas, researchSources } from "@/lib/db/schema";
import { searchRepositories } from "@/lib/search/github";
import { searchHackerNews } from "@/lib/search/hn";
import { webSearch } from "@/lib/search/web";
import { newId, tokenize, truncate } from "@/lib/text";
import type { OpportunityCard, ProjectFingerprint } from "@/lib/types";
import { registerJobType, type StepHandler } from "../jobs";
import { heuristicFingerprint } from "../similarity";

interface OppInput {
  mode: DiscoveryMode;
  modifiers: Modifier[];
  request: string | null;
  baseIdeaId: string | null;
  count: number;
}

function themeTerms(text: string, n = 3) {
  const generic = new Set(["hackathon", "challenge", "build", "project", "tool", "work", "your", "own", "prize", "submit"]);
  return tokenize(text).filter((t) => !generic.has(t) && t.length > 3).slice(0, n);
}

const signals: StepHandler = async (ctx) => {
  const input = ctx.job.input as unknown as OppInput;
  const db = await getDb();
  const [h] = ctx.job.hackathonId ? await db.select().from(hackathons).where(and(eq(hackathons.id, ctx.job.hackathonId), eq(hackathons.workspaceId, ctx.workspaceId))) : [];
  const [profile] = await db.select().from(builderProfiles).where(eq(builderProfiles.workspaceId, ctx.workspaceId));
  const out: Signal[] = [];
  const notes: string[] = [];

  // Official example projects (e.g. an organizer "ideas" page) — real, cited inspiration.
  if (h) {
    const srcs = await db.select().from(researchSources).where(and(eq(researchSources.workspaceId, ctx.workspaceId), eq(researchSources.hackathonId, h.id), eq(researchSources.status, "retrieved")));
    for (const s of srcs.filter((s) => /idea|inspiration|example/i.test(`${s.title} ${s.url}`))) {
      out.push({ kind: "official", label: `Organizer's example projects: ${s.title ?? s.url}`, url: s.finalUrl ?? s.url, detail: truncate(s.extractedText ?? "", 1200) });
    }
    if (h.dossier?.whatToBuild) out.push({ kind: "official", label: "What the organizers ask for", url: h.officialUrl ?? undefined, detail: h.dossier.whatToBuild });
    for (const sp of h.dossier?.sponsors ?? []) out.push({ kind: "sponsor", label: `Sponsor requirement: ${sp.name}`, url: h.officialUrl ?? undefined, detail: sp.usageRequirement });
  }

  // Pain points people describe publicly (Hacker News comments, no key needed).
  const topics = [...new Set([...(profile?.data.interests ?? []), ...themeTerms(`${h?.dossier?.whatToBuild ?? ""} ${input.request ?? ""}`, 2)])].slice(0, 2);
  const painQueries = (topics.length ? topics : ["workflow"]).map((t) => `wish there was a tool ${t}`);
  const wantsPain = input.mode === "unsolved" || input.mode === "underserved" || input.mode === "combinations" || input.mode === "alternative";
  const wantsCrowding = input.mode === "overcrowded" || input.modifiers.includes("less_crowded") || input.mode === "alternative";
  // Budget is reserved up front; the searches are independent, so they run together instead of one
  // after another (sequentially they could take ~30 s in a single request).
  const hnQueries = wantsPain ? painQueries.filter(() => ctx.spend("hnRequests")) : [];
  const probes = wantsCrowding ? CROWDED_PROBES.slice(0, 5).filter(() => ctx.spend("githubRequests")) : [];
  const webQuery = ctx.spend("webQueries") ? `${topics[0] ?? "developer"} frustrating manual workflow reddit` : null;
  const [hnResults, repoResults, web] = await Promise.all([
    Promise.all(hnQueries.map((q) => searchHackerNews(q, { tags: "comment", hitsPerPage: 6 }))),
    Promise.all(probes.map((probe) => searchRepositories(probe, { perPage: 1 }))),
    webQuery ? webSearch(webQuery, { maxResults: 5 }) : Promise.resolve(null),
  ]);

  // Pain points people describe publicly (Hacker News comments, no key needed).
  for (const r of hnResults) {
    if (r.status !== "ok" && r.status !== "empty") notes.push(r.detail ?? "HN search failed");
    for (const hit of r.hits.filter((x) => x.snippet.length > 60)) {
      out.push({ kind: "pain_point", label: `HN comment: “${truncate(hit.snippet, 140)}”`, url: String(hit.meta?.discussionUrl ?? hit.url), detail: hit.snippet });
    }
  }

  // Crowded categories, measured with GitHub repository counts.
  for (const [i, r] of repoResults.entries()) {
    if (r.status === "rate_limited") {
      notes.push(r.detail ?? "GitHub rate limited");
      break;
    }
    if (typeof r.totalCount === "number") {
      const probe = probes[i];
      out.push({ kind: "crowded", label: `${r.totalCount.toLocaleString("en-IN")} public GitHub repositories match “${probe}”`, url: `https://github.com/search?q=${encodeURIComponent(probe)}&type=repositories`, detail: `Counted via the GitHub search API on ${new Date().toISOString().slice(0, 10)}.` });
    }
  }

  // Web pain points when a licensed search provider is configured.
  if (web?.status === "ok") for (const hit of web.hits) out.push({ kind: "pain_point", label: hit.title, url: hit.url, detail: hit.snippet });
  else if (web?.status === "not_configured") notes.push("Web search not configured — only Hacker News and GitHub signals were gathered.");

  // Known projects for this hackathon/ideas — to avoid duplicating them.
  const known = await db.select().from(existingProjects).where(eq(existingProjects.workspaceId, ctx.workspaceId)).orderBy(desc(existingProjects.createdAt)).limit(25);
  for (const k of known.slice(0, 10)) out.push({ kind: "competitor", label: `Existing project: ${k.name}`, url: k.url, detail: k.description ?? undefined });

  ctx.state.signals = out;
  ctx.state.signalNotes = notes;
  return {
    status: "done",
    detail: `${out.length} signals: ${out.filter((s) => s.kind === "pain_point").length} public pain points, ${out.filter((s) => s.kind === "crowded").length} crowded-category counts, ${out.filter((s) => s.kind === "official").length} official, ${out.filter((s) => s.kind === "competitor").length} known projects.${notes.length ? ` ${notes.join(" ")}` : ""}`,
    counts: { signals: out.length },
  };
};

const generate: StepHandler = async (ctx) => {
  const input = ctx.job.input as unknown as OppInput;
  const sigs = (ctx.state.signals as Signal[]) ?? [];
  if (!isAIConfigured()) {
    ctx.state.cards = [];
    ctx.state.removed = [];
    return { status: "not_configured", detail: "Nova needs an AI provider to propose opportunities. The research signals above are real and can still guide you." };
  }
  const db = await getDb();
  const [h] = ctx.job.hackathonId ? await db.select().from(hackathons).where(eq(hackathons.id, ctx.job.hackathonId)) : [];
  const crit = h ? await db.select().from(judgingCriteria).where(eq(judgingCriteria.hackathonId, h.id)) : [];
  const [profile] = await db.select().from(builderProfiles).where(eq(builderProfiles.workspaceId, ctx.workspaceId));
  const ideas = await db.select().from(projectIdeas).where(eq(projectIdeas.workspaceId, ctx.workspaceId));
  const known = await db.select().from(existingProjects).where(eq(existingProjects.workspaceId, ctx.workspaceId)).limit(25);
  const prevSets = await db.select().from(opportunitySets).where(eq(opportunitySets.workspaceId, ctx.workspaceId)).orderBy(desc(opportunitySets.createdAt)).limit(3);
  const avoid: { name: string; fingerprint: ProjectFingerprint }[] = [
    ...known.map((k) => ({ name: k.name, fingerprint: k.fingerprint ?? heuristicFingerprint(k.description ?? "", k.name) })),
    ...ideas.map((i) => ({ name: i.name, fingerprint: i.opportunity?.fingerprint ?? heuristicFingerprint(i.name, i.name) })),
    ...prevSets.flatMap((s) => s.cards.map((c) => ({ name: c.name, fingerprint: c.fingerprint }))),
  ];
  const base = input.baseIdeaId ? ideas.find((i) => i.id === input.baseIdeaId) : null;
  const hoursLeft = h?.deadlineAt ? Math.max(0, ((h.deadlineAt.getTime() - Date.now()) / 86_400_000) * (profile?.data.hoursPerDay ?? 6)) : null;
  try {
    if (!ctx.spend("aiCalls")) throw new Error("AI budget for this job is exhausted.");
    const { cards, removed } = await novaGenerate({
      workspaceId: ctx.workspaceId,
      hackathon: h
        ? {
            name: h.name,
            summary: h.dossier?.summary ?? h.description ?? "",
            whatToBuild: h.dossier?.whatToBuild ?? "",
            criteria: crit.map((c) => ({ name: c.name, weight: c.weight })),
            sponsors: (h.dossier?.sponsors ?? []).map((s) => s.name),
            mandatory: (h.dossier?.mandatory ?? []).map((m) => m.text).slice(0, 8),
          }
        : null,
      profile: profile?.data ?? null,
      hoursAvailable: hoursLeft ? Math.round(hoursLeft) : null,
      mode: input.mode,
      modifiers: input.modifiers,
      request: input.request,
      baseIdea: base ? { name: base.name, summary: base.opportunity?.pitch ?? base.name } : null,
      signals: sigs.slice(0, 40),
      avoid: avoid.slice(0, 40),
      count: Math.min(8, Math.max(3, input.count)),
    });
    ctx.state.cards = cards;
    ctx.state.removed = removed;
    return { status: "done", detail: `Nova proposed ${cards.length + removed.length} directions; ${removed.length} removed as duplicates of known concepts.`, counts: { cards: cards.length, removed: removed.length } };
  } catch (err) {
    ctx.state.cards = [];
    return { status: "failed", detail: `Generation failed: ${await describeAIError(err)}` };
  }
};

const save: StepHandler = async (ctx) => {
  const input = ctx.job.input as unknown as OppInput;
  const db = await getDb();
  const cards = (ctx.state.cards as OpportunityCard[]) ?? [];
  const removed = (ctx.state.removed as { name: string; duplicateOf: string }[]) ?? [];
  await db.insert(opportunitySets).values({
    id: newId("opps"),
    workspaceId: ctx.workspaceId,
    hackathonId: ctx.job.hackathonId,
    researchJobId: ctx.job.id,
    mode: input.mode,
    modifiers: input.modifiers,
    request: input.request,
    cards,
    signals: ((ctx.state.signals as Signal[]) ?? []).map((s) => ({ label: s.label, url: s.url, detail: s.detail ? truncate(s.detail, 600) : undefined, kind: s.kind })),
    diversityNotes: removed.map((r) => `Removed “${r.name}” — same problem, audience and workflow as “${r.duplicateOf}”.`),
    method: isAIConfigured() ? "ai" : "signals_only",
  });
  return { status: "done", detail: cards.length ? `${cards.length} distinct opportunities saved.` : "Signals saved (no cards generated)." };
};

registerJobType(
  "opportunities",
  [
    { key: "signals", label: "Gather real problem and crowding signals", agent: "nova", phase: "exploring" },
    { key: "generate", label: "Propose differentiated directions", agent: "nova", phase: "exploring" },
    { key: "save", label: "Check diversity and save", agent: "nova", phase: "evaluating" },
  ],
  { signals, generate, save },
);
