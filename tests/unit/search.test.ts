import { describe, expect, it } from "vitest";
import { searchRepositories } from "@/lib/search/github";
import { searchHackerNews } from "@/lib/search/hn";
import { webSearch } from "@/lib/search/web";
import { canonicalUrl, uniqueBy } from "@/lib/text";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("GitHub search", () => {
  it("normalizes successful results with rate-limit info", async () => {
    const r = await searchRepositories("hackathon judge", {
      fetchImpl: async () =>
        json({ total_count: 2, items: [{ full_name: "a/b", html_url: "https://github.com/a/b", description: "Judge helper", stargazers_count: 3, forks_count: 0, language: "TS", topics: [], homepage: null, created_at: "2026-01-01T00:00:00Z", pushed_at: "2026-02-01T00:00:00Z", archived: false }] }, 200, { "x-ratelimit-remaining": "9", "x-ratelimit-reset": "1800000000" }),
    });
    expect(r.status).toBe("ok");
    expect(r.hits[0]).toMatchObject({ title: "a/b", url: "https://github.com/a/b", source: "github" });
    expect(r.rateLimit?.remaining).toBe(9);
  });

  it("reports rate limiting instead of pretending there were no results", async () => {
    const r = await searchRepositories("x y", { fetchImpl: async () => json({ message: "API rate limit exceeded" }, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1800000000" }) });
    expect(r.status).toBe("rate_limited");
    expect(r.detail).toMatch(/rate limit/);
  });

  it("distinguishes empty results and failures", async () => {
    expect((await searchRepositories("nothing", { fetchImpl: async () => json({ total_count: 0, items: [] }) })).status).toBe("empty");
    expect((await searchRepositories("boom", { fetchImpl: async () => json({}, 500) })).status).toBe("failed");
    expect((await searchRepositories("net", { fetchImpl: async () => Promise.reject(new Error("ECONNRESET")) })).status).toBe("failed");
  });
});

describe("Hacker News search", () => {
  it("maps stories and keeps the discussion link", async () => {
    const r = await searchHackerNews("hackathon", { fetchImpl: async () => json({ nbHits: 1, hits: [{ objectID: "42", title: "Show HN: Thing", url: "https://thing.dev", created_at: "2026-01-01T00:00:00Z", points: 10 }] }) });
    expect(r.hits[0].url).toBe("https://thing.dev");
    expect(r.hits[0].meta?.discussionUrl).toBe("https://news.ycombinator.com/item?id=42");
  });
});

describe("web search without a provider", () => {
  it("returns not_configured rather than fake results", async () => {
    const r = await webSearch("anything");
    expect(r.status).toBe("not_configured");
    expect(r.hits).toEqual([]);
  });
});

describe("duplicate results", () => {
  it("dedupes by canonical URL (tracking params, www, trailing slash)", () => {
    const hits = ["https://www.devpost.com/software/x/?utm_source=a", "https://devpost.com/software/x", "https://devpost.com/software/y"];
    expect(uniqueBy(hits, canonicalUrl)).toHaveLength(2);
  });
});
