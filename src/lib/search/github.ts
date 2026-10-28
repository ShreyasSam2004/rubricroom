import { keys } from "@/lib/env";
import type { FetchLike, SearchHit, SearchOutcome } from "./types";

const API = "https://api.github.com";

function headers() {
  const h: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "RubricRoom-Research",
  };
  const token = keys.github();
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

function rateInfo(res: Response) {
  const remaining = res.headers.get("x-ratelimit-remaining");
  const reset = res.headers.get("x-ratelimit-reset");
  return {
    remaining: remaining === null ? null : Number(remaining),
    resetAt: reset ? new Date(Number(reset) * 1000).toISOString() : null,
  };
}

interface RepoItem {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  topics?: string[];
  homepage: string | null;
  created_at: string;
  pushed_at: string;
  archived: boolean;
  owner?: { avatar_url?: string };
}

/** GitHub repository search (REST). Works unauthenticated at a low rate limit; GITHUB_TOKEN raises it. */
export async function searchRepositories(query: string, opts: { perPage?: number; fetchImpl?: FetchLike } = {}): Promise<SearchOutcome> {
  const f = opts.fetchImpl ?? fetch;
  const url = `${API}/search/repositories?q=${encodeURIComponent(query)}&per_page=${opts.perPage ?? 8}`;
  let res: Response;
  try {
    res = await f(url, { headers: headers(), signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    return { provider: "github", query, status: "failed", hits: [], detail: `GitHub unreachable: ${(e as Error).message}` };
  }
  const rateLimit = rateInfo(res);
  if (res.status === 403 || res.status === 429) {
    const limited = rateLimit.remaining === 0 || res.status === 429 || res.headers.get("retry-after") !== null;
    if (limited) {
      return {
        provider: "github",
        query,
        status: "rate_limited",
        hits: [],
        rateLimit,
        detail: `GitHub search rate limit reached${rateLimit.resetAt ? `; resets at ${rateLimit.resetAt}` : ""}.`,
      };
    }
  }
  if (!res.ok) {
    return { provider: "github", query, status: "failed", hits: [], rateLimit, detail: `GitHub responded with HTTP ${res.status}.` };
  }
  const json = (await res.json()) as { total_count: number; items: RepoItem[] };
  const hits: SearchHit[] = (json.items ?? []).map((r) => ({
    title: r.full_name,
    url: r.html_url,
    snippet: r.description ?? "",
    publishedAt: r.created_at,
    source: "github",
    meta: {
      stars: r.stargazers_count,
      forks: r.forks_count,
      language: r.language,
      topics: r.topics ?? [],
      homepage: r.homepage,
      pushedAt: r.pushed_at,
      archived: r.archived,
      avatar: r.owner?.avatar_url ?? null,
    },
  }));
  return { provider: "github", query, status: hits.length ? "ok" : "empty", hits, totalCount: json.total_count, rateLimit };
}

/** Fetch a repository README (raw text) to give the comparison real implementation evidence. */
export async function fetchReadme(fullName: string, fetchImpl?: FetchLike): Promise<string | null> {
  const f = fetchImpl ?? fetch;
  try {
    const res = await f(`${API}/repos/${fullName}/readme`, {
      headers: { ...headers(), accept: "application/vnd.github.raw" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, 30_000);
  } catch {
    return null;
  }
}
