import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { researchSources } from "@/lib/db/schema";
import { extractHtml, type ExtractedPage } from "@/lib/extract/html";
import { extractPdf } from "@/lib/extract/pdf";
import { robotsAllows, safeFetch, SafeFetchError } from "@/lib/net/safe-fetch";
import { canonicalUrl, newId, sha256, truncate } from "@/lib/text";
import type { SourceType } from "@/lib/types";
import { classifySource } from "./verify";

export type SourceRow = typeof researchSources.$inferSelect;

export interface RetrieveOptions {
  workspaceId: string;
  url: string;
  hackathonId?: string | null;
  ideaId?: string | null;
  jobId?: string | null;
  officialHost?: string | null;
  /** First path segment of the event URL (e.g. "/wispr"), used to rank site-wide pages lower. */
  eventPathPrefix?: string | null;
  sourceType?: SourceType;
  authority?: number;
  skipRobots?: boolean;
}

export interface RetrievedSource {
  row: SourceRow;
  page: ExtractedPage | null;
  ok: boolean;
}

const MAX_STORED_TEXT = 200_000;

/** Fetch one public page or PDF safely, extract its text, and store it with provenance. Failures are stored too. */
export async function retrieveSource(opts: RetrieveOptions): Promise<RetrievedSource> {
  const db = await getDb();
  const retrievedAt = new Date();
  const base = {
    id: newId("src"),
    workspaceId: opts.workspaceId,
    hackathonId: opts.hackathonId ?? null,
    ideaId: opts.ideaId ?? null,
    researchJobId: opts.jobId ?? null,
    url: opts.url,
    retrievedAt,
  };
  const classify = (finalUrl: string, title: string) =>
    opts.sourceType ? { sourceType: opts.sourceType, authority: opts.authority ?? 6 } : classifySource(finalUrl, opts.officialHost ?? null, title, opts.eventPathPrefix ?? null);

  try {
    if (!opts.skipRobots && !(await robotsAllows(opts.url))) {
      throw new SafeFetchError("robots_disallowed", "The site's robots.txt disallows automated access to this page.");
    }
    const res = await safeFetch(opts.url, { maxBytes: 4_000_000 });
    let page: ExtractedPage;
    if (res.contentType.startsWith("application/pdf")) {
      const pdf = await extractPdf(res.body);
      page = {
        url: res.finalUrl,
        title: decodeURIComponent(new URL(res.finalUrl).pathname.split("/").pop() || "Document"),
        description: null,
        siteName: null,
        imageUrl: null,
        publishedAt: null,
        modifiedAt: null,
        text: pdf.text,
        links: [],
        markupHints: [],
        contentHash: pdf.contentHash,
      };
    } else if (res.contentType.startsWith("text/plain") || res.contentType.startsWith("text/markdown")) {
      const text = res.body.toString("utf8");
      page = { url: res.finalUrl, title: null, description: null, siteName: null, imageUrl: null, publishedAt: null, modifiedAt: null, text, links: [], markupHints: [], contentHash: sha256(text) };
    } else {
      page = extractHtml(res.body.toString("utf8"), res.finalUrl);
    }
    const { sourceType, authority } = classify(res.finalUrl, page.title ?? "");
    const [row] = await db
      .insert(researchSources)
      .values({
        ...base,
        finalUrl: res.finalUrl,
        title: page.title,
        publisher: page.siteName ?? new URL(res.finalUrl).hostname.replace(/^www\./, ""),
        sourceType,
        authority,
        publishedAt: page.publishedAt ? new Date(page.publishedAt) : null,
        excerpt: truncate(page.description ?? page.text.slice(0, 400), 400),
        extractedText: page.text.slice(0, MAX_STORED_TEXT),
        markupHints: page.markupHints,
        contentHash: page.contentHash,
        httpStatus: res.status,
        status: "retrieved",
      })
      .returning();
    return { row, page, ok: true };
  } catch (e) {
    const err = e as SafeFetchError;
    const { sourceType, authority } = classify(opts.url, "");
    const [row] = await db
      .insert(researchSources)
      .values({
        ...base,
        sourceType,
        authority,
        status: err.code === "unsafe_url" || err.code === "blocked_address" || err.code === "robots_disallowed" ? "blocked" : "failed",
        httpStatus: err.status ?? null,
        error: err.message ?? String(e),
      })
      .returning();
    return { row, page: null, ok: false };
  }
}

/** Store user-pasted rules text as a source. It is labelled as user-provided, never as official. */
export async function storePastedSource(opts: { workspaceId: string; hackathonId: string; jobId?: string | null; text: string; title?: string }) {
  const db = await getDb();
  const text = opts.text.slice(0, MAX_STORED_TEXT);
  const [row] = await db
    .insert(researchSources)
    .values({
      id: newId("src"),
      workspaceId: opts.workspaceId,
      hackathonId: opts.hackathonId,
      researchJobId: opts.jobId ?? null,
      url: `pasted:${sha256(text).slice(0, 12)}`,
      title: opts.title || "Pasted rules text",
      publisher: "Provided by you",
      sourceType: "user_pasted",
      authority: 4,
      retrievedAt: new Date(),
      excerpt: truncate(text, 400),
      extractedText: text,
      contentHash: sha256(text),
      status: "retrieved",
    })
    .returning();
  return row;
}

export async function storePdfSource(opts: { workspaceId: string; hackathonId: string; jobId?: string | null; filename: string; data: Buffer }) {
  const db = await getDb();
  const pdf = await extractPdf(opts.data);
  const [row] = await db
    .insert(researchSources)
    .values({
      id: newId("src"),
      workspaceId: opts.workspaceId,
      hackathonId: opts.hackathonId,
      researchJobId: opts.jobId ?? null,
      url: `upload:${opts.filename}`,
      title: opts.filename,
      publisher: "Uploaded by you",
      sourceType: "user_pdf",
      authority: 3,
      retrievedAt: new Date(),
      excerpt: truncate(pdf.text, 400),
      extractedText: pdf.text.slice(0, MAX_STORED_TEXT),
      contentHash: pdf.contentHash,
      status: "retrieved",
    })
    .returning();
  return row;
}

export async function sourcesForHackathon(workspaceId: string, hackathonId: string) {
  const db = await getDb();
  return db
    .select()
    .from(researchSources)
    .where(and(eq(researchSources.workspaceId, workspaceId), eq(researchSources.hackathonId, hackathonId)));
}

const TAB_PAGES = ["Rules", "Judging", "Judges", "Schedule", "Timeline", "FAQ", "Prizes", "Resources", "Tracks"];

/**
 * Some event sites render their tabs ("Overview · Rules · Schedule") with JavaScript, so the static
 * HTML shows the labels but no links. For an event page under a path, guess the conventional
 * address of each labelled tab that has no real link. Guesses are probed before being stored.
 */
export function guessedTabPages(page: ExtractedPage, already: Set<string>, limit = 4): string[] {
  const base = new URL(page.url);
  const path = base.pathname.replace(/\/+$/, "");
  if (!path) return [];
  const out: string[] = [];
  for (const label of TAB_PAGES) {
    const slug = label.toLowerCase();
    const shownAsTab = new RegExp(`(?:^|[\\s\\-|•·])${label}(?=$|[\\s\\-|•·])`, "m").test(page.text);
    if (!shownAsTab) continue;
    if (page.links.some((l) => l.sameSite && new URL(l.url).pathname.toLowerCase().includes(slug))) continue;
    const url = `${base.origin}${path}/${slug}`;
    if (already.has(canonicalUrl(url)) || out.includes(url)) continue;
    out.push(url);
    if (out.length >= limit) break;
  }
  return out;
}

/** Pick same-site pages worth reading: rules, judging, schedule, FAQ, prizes, submission, tracks. */
export function candidateSubpages(page: ExtractedPage, already: Set<string>, limit = 6): string[] {
  const scored = page.links
    .filter((l) => l.sameSite)
    .map((l) => {
      const hay = `${l.text} ${new URL(l.url).pathname}`.toLowerCase();
      let score = 0;
      if (/\brules?\b|official[- ]rules|terms/.test(hay)) score += 6;
      if (/judg|criteria|rubric|scoring/.test(hay)) score += 6;
      if (/schedule|timeline|dates/.test(hay)) score += 5;
      if (/faq|questions/.test(hay)) score += 4;
      if (/prize|reward/.test(hay)) score += 3;
      if (/submi|deliverable/.test(hay)) score += 3;
      if (/track|challenge|theme|resources|guidelines|eligib|ideas|inspiration/.test(hay)) score += 2;
      if (/sign[- ]?in|login|register|leaderboard|privacy|cookie|blog$|\/terms-of-service/.test(hay)) score -= 6;
      return { url: l.url, score };
    })
    .filter((x) => x.score > 0 && !already.has(canonicalUrl(x.url)))
    .sort((a, b) => b.score - a.score);
  const out: string[] = [];
  for (const s of scored) {
    if (out.some((u) => canonicalUrl(u) === canonicalUrl(s.url))) continue;
    out.push(s.url);
    if (out.length >= limit) break;
  }
  return out;
}
