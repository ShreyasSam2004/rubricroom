import type { FetchLike, SearchHit, SearchOutcome } from "./types";

interface AlgoliaHit {
  objectID: string;
  title?: string | null;
  url?: string | null;
  story_text?: string | null;
  comment_text?: string | null;
  story_title?: string | null;
  story_id?: number | null;
  points?: number | null;
  num_comments?: number | null;
  created_at: string;
  author?: string;
}

function stripTags(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/\s+/g, " ").trim();
}

/** Hacker News search via the public Algolia API (no key). `tags` e.g. "story", "show_hn", "comment". */
export async function searchHackerNews(query: string, opts: { tags?: string; hitsPerPage?: number; fetchImpl?: FetchLike } = {}): Promise<SearchOutcome> {
  const f = opts.fetchImpl ?? fetch;
  const params = new URLSearchParams({ query, tags: opts.tags ?? "story", hitsPerPage: String(opts.hitsPerPage ?? 8) });
  let res: Response;
  try {
    res = await f(`https://hn.algolia.com/api/v1/search?${params}`, { signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    return { provider: "hackernews", query, status: "failed", hits: [], detail: `Hacker News search unreachable: ${(e as Error).message}` };
  }
  if (res.status === 429) return { provider: "hackernews", query, status: "rate_limited", hits: [], detail: "Hacker News search rate limit reached." };
  if (!res.ok) return { provider: "hackernews", query, status: "failed", hits: [], detail: `Hacker News search responded with HTTP ${res.status}.` };
  const json = (await res.json()) as { hits: AlgoliaHit[]; nbHits: number };
  const hits: SearchHit[] = (json.hits ?? []).map((h) => {
    const isComment = Boolean(h.comment_text);
    const discussion = `https://news.ycombinator.com/item?id=${isComment ? h.objectID : h.objectID}`;
    return {
      title: stripTags(h.title ?? h.story_title ?? "Hacker News discussion"),
      url: !isComment && h.url ? h.url : discussion,
      snippet: stripTags(h.story_text ?? h.comment_text ?? "").slice(0, 600),
      publishedAt: h.created_at,
      source: "hackernews",
      meta: { discussionUrl: discussion, points: h.points ?? null, comments: h.num_comments ?? null, author: h.author ?? null, isComment },
    };
  });
  return { provider: "hackernews", query, status: hits.length ? "ok" : "empty", hits, totalCount: json.nbHits };
}
