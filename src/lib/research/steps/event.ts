import { and, eq, inArray } from "drizzle-orm";
import * as cheerio from "cheerio";
import { atlasExtract } from "@/lib/agents/atlas";
import { describeAIError } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { existingProjects, hackathons, researchSources, uploads } from "@/lib/db/schema";
import type { Extraction, SourceForExtraction } from "@/lib/extract/contract";
import { heuristicExtract } from "@/lib/extract/heuristics";
import { robotsAllows, safeFetch } from "@/lib/net/safe-fetch";
import { webSearch } from "@/lib/search/web";
import { canonicalUrl, hostOf, newId, truncate } from "@/lib/text";
import type { CoverageItem } from "@/lib/types";
import { registerJobType, type StepHandler } from "../jobs";
import { persistExtraction } from "../persist-event";
import { candidateSubpages, guessedTabPages, retrieveSource, storePastedSource, storePdfSource } from "../sources";

/** "/wispr" for https://site.org/wispr/judges; null for root-level event sites. */
function eventPrefixOf(url: string): string | null {
  try {
    const seg = new URL(url).pathname.split("/").filter(Boolean)[0];
    return seg ? `/${seg.toLowerCase()}` : null;
  } catch {
    return null;
  }
}

interface EventInput {
  urls?: string[];
  pastedText?: string;
  uploadIds?: string[];
}

const fetchPrimary: StepHandler = async (ctx) => {
  const input = ctx.job.input as EventInput;
  const hackathonId = ctx.job.hackathonId!;
  const urls = (input.urls ?? []).slice(0, 5);
  const officialHost = urls[0] ? hostOf(urls[0]) : null;
  ctx.state.officialHost = officialHost;
  const eventPathPrefix = urls[0] ? eventPrefixOf(urls[0]) : null;
  ctx.state.eventPathPrefix = eventPathPrefix;
  const ids: string[] = [];
  let ok = 0;
  const failures: string[] = [];
  let subpages: string[] = [];
  let guessed: string[] = [];
  const fetched = new Set<string>();
  for (const [i, url] of urls.entries()) {
    if (!ctx.spend("urlFetches")) break;
    const r = await retrieveSource({ workspaceId: ctx.workspaceId, url, hackathonId, jobId: ctx.job.id, officialHost: i === 0 ? officialHost : hostOf(url) === officialHost ? officialHost : null, eventPathPrefix });
    ids.push(r.row.id);
    fetched.add(canonicalUrl(url));
    if (r.row.finalUrl) fetched.add(canonicalUrl(r.row.finalUrl));
    if (r.ok) {
      ok++;
      if (i === 0 && r.page) {
        subpages = candidateSubpages(r.page, fetched);
        guessed = guessedTabPages(r.page, new Set([...fetched, ...subpages.map(canonicalUrl)]));
      }
    } else failures.push(`${url}: ${r.row.error}`);
  }
  if (input.pastedText?.trim()) {
    const row = await storePastedSource({ workspaceId: ctx.workspaceId, hackathonId, jobId: ctx.job.id, text: input.pastedText });
    ids.push(row.id);
    ok++;
  }
  if (input.uploadIds?.length) {
    const db = await getDb();
    const files = await db.select().from(uploads).where(and(eq(uploads.workspaceId, ctx.workspaceId), inArray(uploads.id, input.uploadIds)));
    for (const f of files) {
      try {
        const row = await storePdfSource({ workspaceId: ctx.workspaceId, hackathonId, jobId: ctx.job.id, filename: f.filename, data: f.data });
        ids.push(row.id);
        ok++;
      } catch (e) {
        failures.push(`${f.filename}: ${(e as Error).message}`);
      }
    }
  }
  ctx.state.subpages = [...subpages, ...guessed];
  ctx.state.guessedSubpages = guessed;
  ctx.state.fetched = [...fetched];
  const coverage: CoverageItem[] = [
    {
      key: "official_pages",
      label: "Official pages inspected",
      status: ok === 0 ? "failed" : failures.length ? "partial" : "verified",
      detail: `${ok} retrieved${failures.length ? `; failed: ${failures.map((f) => truncate(f, 120)).join(" | ")}` : ""}`,
    },
  ];
  if (ok === 0) return { status: "failed", detail: failures.join(" | ") || "Nothing could be retrieved.", coverage, fatal: true };
  return { status: "done", detail: `${ok} source(s) retrieved; ${subpages.length} related official page(s) found to read next.`, counts: { retrieved: ok, failed: failures.length }, coverage };
};

const discoverPages: StepHandler = async (ctx) => {
  const subpages = (ctx.state.subpages as string[] | undefined) ?? [];
  if (!subpages.length) {
    return { status: "skipped", detail: "No linked rules, judging, schedule or FAQ pages were found on the official page.", coverage: [{ key: "rules_document", label: "Rules document retrieved", status: "not_available", detail: "No separate rules page linked from the official page." }] };
  }
  let ok = 0;
  const done: string[] = [];
  const failed: string[] = [];
  const guessed = new Set((ctx.state.guessedSubpages as string[] | undefined) ?? []);
  let notFound = 0;
  for (const url of subpages) {
    if (guessed.has(url)) {
      // A guessed tab address: keep it only if it exists (and robots.txt allows reading it).
      const exists = (await robotsAllows(url)) && (await safeFetch(url, { maxBytes: 4_000_000 }).then(() => true, () => false));
      if (!exists) {
        notFound++;
        continue;
      }
    }
    if (!ctx.spend("urlFetches")) break;
    const r = await retrieveSource({ workspaceId: ctx.workspaceId, url, hackathonId: ctx.job.hackathonId, jobId: ctx.job.id, officialHost: ctx.state.officialHost as string, eventPathPrefix: ctx.state.eventPathPrefix as string | null });
    if (r.ok) {
      ok++;
      done.push(r.row.title ?? url);
    } else failed.push(`${url}: ${r.row.error}`);
  }
  const skipped = subpages.length - ok - failed.length - notFound;
  return {
    status: "done",
    detail: `Read ${ok} related official page(s): ${done.map((d) => truncate(d, 60)).join("; ")}${failed.length ? `. Failed: ${failed.length}` : ""}${skipped > 0 ? `. ${skipped} skipped (fetch budget).` : ""}`,
    counts: { retrieved: ok, failed: failed.length },
  };
};

export async function sourcesForExtraction(workspaceId: string, hackathonId: string, primaryUrl?: string | null): Promise<SourceForExtraction[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(researchSources)
    .where(and(eq(researchSources.workspaceId, workspaceId), eq(researchSources.hackathonId, hackathonId), eq(researchSources.status, "retrieved")));
  const newestFirst = rows
    .filter((r) => r.sourceType !== "devpost_project" && r.sourceType !== "github_repo" && r.extractedText)
    .sort((a, b) => (b.retrievedAt?.getTime() ?? 0) - (a.retrievedAt?.getTime() ?? 0));
  const seenUrls = new Set<string>();
  const official = newestFirst.filter((r) => {
    const key = r.sourceType === "user_pasted" || r.sourceType === "user_pdf" ? `${r.url}:${r.contentHash}` : canonicalUrl(r.finalUrl ?? r.url);
    if (seenUrls.has(key)) return false;
    seenUrls.add(key);
    return true;
  });
  // The URL the user submitted goes first (it anchors the event name), then by authority.
  const primary = primaryUrl ? canonicalUrl(primaryUrl) : null;
  const isPrimary = (r: (typeof rows)[number]) => (primary && (canonicalUrl(r.url) === primary || canonicalUrl(r.finalUrl ?? "") === primary) ? 0 : 1);
  const sorted = official.sort((a, b) => isPrimary(a) - isPrimary(b) || a.authority - b.authority || a.createdAt.getTime() - b.createdAt.getTime());
  return sorted.map((r, i) => ({
    ref: i,
    sourceId: r.id,
    url: r.finalUrl ?? r.url,
    title: r.title,
    sourceType: r.sourceType,
    authority: r.authority,
    publishedAt: r.publishedAt?.toISOString() ?? null,
    retrievedAt: r.retrievedAt?.toISOString() ?? null,
    text: r.extractedText ?? "",
    markupHints: r.markupHints ?? [],
  }));
}

const extract: StepHandler = async (ctx) => {
  const sources = await sourcesForExtraction(ctx.workspaceId, ctx.job.hackathonId!, (ctx.job.input as EventInput).urls?.[0]);
  if (!sources.length) return { status: "failed", detail: "No retrieved text to extract from.", fatal: true };
  let extraction: Extraction;
  let method: "ai" | "heuristic";
  let notes: string[];
  try {
    if (!ctx.spend("aiCalls")) throw new Error("AI budget for this job is exhausted.");
    ({ extraction, method, notes } = await atlasExtract(ctx.workspaceId, sources, { onProgress: ctx.progress }));
  } catch (err) {
    extraction = heuristicExtract(sources);
    method = "heuristic";
    notes = [`AI extraction unavailable (${await describeAIError(err)}); the deterministic parser was used instead.`];
  }
  ctx.state.extraction = extraction;
  ctx.state.method = method;
  ctx.state.notes = notes;
  return {
    status: "done",
    detail: `${method === "ai" ? "Atlas (AI)" : "Deterministic parser"} extracted ${extraction.facts.length} facts, ${extraction.criteria.length} judging criteria, ${extraction.rules.length} rules and ${extraction.submission.length} submission requirements from ${sources.length} source(s).`,
    counts: { facts: extraction.facts.length, criteria: extraction.criteria.length, rules: extraction.rules.length },
  };
};

const verify: StepHandler = async (ctx) => {
  const sources = await sourcesForExtraction(ctx.workspaceId, ctx.job.hackathonId!, (ctx.job.input as EventInput).urls?.[0]);
  const extraction = ctx.state.extraction as Extraction | undefined;
  if (!extraction) return { status: "failed", detail: "Nothing to verify.", fatal: true };
  const res = await persistExtraction({
    workspaceId: ctx.workspaceId,
    hackathonId: ctx.job.hackathonId!,
    sources,
    extraction,
    method: (ctx.state.method as "ai" | "heuristic") ?? "heuristic",
    notes: (ctx.state.notes as string[]) ?? [],
  });
  delete ctx.state.extraction; // keep the job row small; the persisted claims are the record
  const rulesDoc = sources.find((s) => s.sourceType === "official_rules" || s.sourceType === "user_pdf" || s.sourceType === "user_pasted");
  const weighted = extraction.criteria.filter((c) => c.weight !== null).length;
  const coverage: CoverageItem[] = [
    rulesDoc
      ? { key: "rules_document", label: "Rules document retrieved", status: "verified", detail: rulesDoc.title ?? rulesDoc.url }
      : { key: "rules_document", label: "Rules document retrieved", status: "not_available", detail: "No separate official rules page or document was found; rules were taken from the event pages." },
    {
      key: "rubric",
      label: "Rubric verified",
      status: extraction.criteria.length === 0 ? "not_available" : weighted === extraction.criteria.length ? "verified" : "partial",
      detail: extraction.criteria.length ? `${extraction.criteria.length} criteria, ${weighted} with published weights` : "No judging criteria found in the retrieved pages.",
    },
    {
      key: "submission_page",
      label: "Submission requirements found",
      status: extraction.submission.length ? "verified" : "not_available",
      detail: extraction.submission.length ? `${extraction.submission.length} required deliverable(s)` : "No explicit list of deliverables found.",
    },
  ];
  return { status: "done", detail: `${res.verified} of ${res.claims} claims matched their source text verbatim; ${res.conflicts} conflict(s) between sources.`, counts: res, coverage };
};

const gallery: StepHandler = async (ctx) => {
  const db = await getDb();
  const [h] = await db.select().from(hackathons).where(and(eq(hackathons.id, ctx.job.hackathonId!), eq(hackathons.workspaceId, ctx.workspaceId)));
  const host = (ctx.state.officialHost as string | null) ?? "";
  const found: { name: string; url: string; snippet: string; platform: string }[] = [];
  let detail = "";
  let status: CoverageItem["status"] = "not_searched";
  if (/(^|\.)devpost\.com$/.test(host) && host !== "devpost.com" && ctx.spend("urlFetches")) {
    try {
      const res = await safeFetch(`https://${host}/project-gallery`, { maxBytes: 3_000_000 });
      const $ = cheerio.load(res.body.toString("utf8"));
      $("a[href*='devpost.com/software/']").each((_, el) => {
        const href = $(el).attr("href")!;
        const name = $(el).find("h5").first().text().trim() || $(el).text().replace(/\s+/g, " ").trim().slice(0, 80);
        const tagline = $(el).find("p.small, .tagline").first().text().trim();
        if (name && !found.some((f) => canonicalUrl(f.url) === canonicalUrl(href))) found.push({ name, url: href, snippet: tagline, platform: "devpost" });
      });
      status = found.length ? "verified" : "not_available";
      detail = found.length ? `${found.length} public submissions listed in the official project gallery.` : "The official gallery is empty or not public yet.";
    } catch (e) {
      status = "failed";
      detail = `Could not read the official project gallery: ${(e as Error).message}`;
    }
  } else {
    const q = `${h?.name ?? ""} hackathon project submission`;
    if (h?.name && ctx.spend("webQueries")) {
      const r = await webSearch(q, { includeDomains: ["devpost.com"], maxResults: 10 });
      if (r.status === "ok") {
        for (const hit of r.hits) if (/devpost\.com\/software\//.test(hit.url)) found.push({ name: hit.title.replace(/\s*\|\s*Devpost$/, ""), url: hit.url, snippet: hit.snippet, platform: "devpost" });
        status = found.length ? "partial" : "not_available";
        detail = found.length ? `${found.length} public Devpost project(s) found by web search mentioning this event. Not an official gallery; may be incomplete.` : "Web search found no public submissions for this event.";
      } else {
        status = r.status === "not_configured" ? "not_configured" : r.status === "rate_limited" ? "failed" : "failed";
        detail = r.status === "not_configured" ? "This event has no public project gallery on its site, and no web search provider is configured to look elsewhere." : (r.detail ?? "Search failed.");
      }
    } else {
      detail = "Not searched (no event name or budget).";
    }
  }
  if (found.length) {
    await db.insert(existingProjects).values(
      found.slice(0, 30).map((f) => ({
        id: newId("proj"),
        workspaceId: ctx.workspaceId,
        hackathonId: ctx.job.hackathonId,
        researchJobId: ctx.job.id,
        name: f.name,
        url: f.url,
        sourcePlatform: f.platform,
        description: f.snippet || null,
        lastVerifiedAt: new Date(),
        verification: "partially_verified" as const,
      })),
    );
  }
  return {
    status: status === "failed" ? "failed" : status === "not_configured" ? "not_configured" : "done",
    detail,
    counts: { projects: found.length },
    coverage: [
      { key: "public_submissions", label: "Public submissions inspected", status, detail },
      { key: "competitor_research", label: "External competitor research", status: "not_searched", detail: "Runs per idea from My Ideas or the Judge's Room." },
    ],
  };
};

registerJobType(
  "event",
  [
    { key: "fetch_primary", label: "Fetch the official event page", agent: "atlas", phase: "fetching_sources" },
    { key: "discover_pages", label: "Read linked rules, judging, schedule and FAQ pages", agent: "atlas", phase: "fetching_sources" },
    { key: "extract", label: "Extract event details, rubric and requirements", agent: "atlas", phase: "extracting" },
    { key: "verify", label: "Check every claim against the source text", agent: "atlas", phase: "evaluating" },
    { key: "gallery", label: "Look for public submissions", agent: "scout", phase: "searching_projects" },
  ],
  { fetch_primary: fetchPrimary, discover_pages: discoverPages, extract, verify, gallery },
  async (job) => {
    const db = await getDb();
    await db
      .update(hackathons)
      .set({ sourceStatus: job.status === "complete" ? "complete" : job.status === "failed" ? "failed" : "partial", coverage: job.coverage, updatedAt: new Date() })
      .where(and(eq(hackathons.id, job.hackathonId!), eq(hackathons.workspaceId, job.workspaceId)));
  },
);
