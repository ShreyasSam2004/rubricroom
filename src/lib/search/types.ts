export type SearchSource = "tavily" | "exa" | "github" | "hackernews" | "devpost_gallery";

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
  source: SearchSource;
  meta?: Record<string, unknown>;
}

export type SearchStatus = "ok" | "empty" | "rate_limited" | "failed" | "not_configured" | "budget_exhausted";

export interface SearchOutcome {
  provider: SearchSource;
  query: string;
  status: SearchStatus;
  hits: SearchHit[];
  detail?: string;
  totalCount?: number;
  rateLimit?: { remaining: number | null; resetAt: string | null };
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
