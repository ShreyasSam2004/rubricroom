import { keys, searchProvider } from "@/lib/env";
import type { FetchLike, SearchHit, SearchOutcome } from "./types";

export interface WebSearchOptions {
  maxResults?: number;
  includeDomains?: string[];
  fetchImpl?: FetchLike;
}

/** Licensed web search (Tavily or Exa). Returns `not_configured` rather than pretending to search. */
export async function webSearch(query: string, opts: WebSearchOptions = {}): Promise<SearchOutcome> {
  const provider = searchProvider();
  if (provider === "none") {
    return { provider: "tavily", query, status: "not_configured", hits: [], detail: "No web search provider configured (set TAVILY_API_KEY or EXA_API_KEY)." };
  }
  return provider === "tavily" ? tavily(query, opts) : exa(query, opts);
}

async function tavily(query: string, opts: WebSearchOptions): Promise<SearchOutcome> {
  const f = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${keys.tavily()}` },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        max_results: Math.min(opts.maxResults ?? 8, 20),
        include_answer: false,
        include_raw_content: false,
        include_published_date: true,
        ...(opts.includeDomains?.length ? { include_domains: opts.includeDomains } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    return { provider: "tavily", query, status: "failed", hits: [], detail: `Tavily unreachable: ${(e as Error).message}` };
  }
  if (res.status === 429) return { provider: "tavily", query, status: "rate_limited", hits: [], detail: "Tavily rate limit reached." };
  if (res.status === 432 || res.status === 433) return { provider: "tavily", query, status: "rate_limited", hits: [], detail: "Tavily plan or pay-as-you-go limit reached." };
  if (!res.ok) return { provider: "tavily", query, status: "failed", hits: [], detail: `Tavily responded with HTTP ${res.status}.` };
  const json = (await res.json()) as { results?: { title: string; url: string; content?: string; published_date?: string | null; score?: number }[] };
  const hits: SearchHit[] = (json.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: (r.content ?? "").slice(0, 800),
    publishedAt: r.published_date ?? null,
    source: "tavily",
    meta: { score: r.score ?? null },
  }));
  return { provider: "tavily", query, status: hits.length ? "ok" : "empty", hits };
}

async function exa(query: string, opts: WebSearchOptions): Promise<SearchOutcome> {
  const f = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f("https://api.exa.ai/search", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": keys.exa() ?? "" },
      body: JSON.stringify({
        query,
        type: "auto",
        numResults: Math.min(opts.maxResults ?? 8, 25),
        contents: { highlights: true },
        ...(opts.includeDomains?.length ? { includeDomains: opts.includeDomains } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    return { provider: "exa", query, status: "failed", hits: [], detail: `Exa unreachable: ${(e as Error).message}` };
  }
  if (res.status === 429) return { provider: "exa", query, status: "rate_limited", hits: [], detail: "Exa rate limit reached." };
  if (res.status === 402) return { provider: "exa", query, status: "rate_limited", hits: [], detail: "Exa credits exhausted." };
  if (!res.ok) return { provider: "exa", query, status: "failed", hits: [], detail: `Exa responded with HTTP ${res.status}.` };
  const json = (await res.json()) as { results?: { title?: string | null; url: string; publishedDate?: string | null; highlights?: string[]; text?: string }[] };
  const hits: SearchHit[] = (json.results ?? []).map((r) => ({
    title: r.title ?? r.url,
    url: r.url,
    snippet: (r.highlights?.join(" … ") ?? r.text ?? "").slice(0, 800),
    publishedAt: r.publishedDate ?? null,
    source: "exa",
  }));
  return { provider: "exa", query, status: hits.length ? "ok" : "empty", hits };
}
