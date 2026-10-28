import { describe, expect, it } from "vitest";
import { classifySource, matchQuote, resolveConflicts, verificationFor, type ComparableClaim } from "@/lib/research/verify";

describe("quote verification", () => {
  const text = "Submissions close on Saturday 31 October at 11:59 pm IST. This is a solo challenge, so every entry is one person's project.";
  it("matches exact quotes (case/punctuation-insensitive)", () => {
    expect(matchQuote("submissions close on Saturday 31 October at 11:59 pm IST", text)).toBe("exact");
  });
  it("accepts close paraphrases", () => {
    expect(matchQuote("This is a solo challenge so every entry is one person project", text)).not.toBe("missing");
  });
  it("flags quotes that are not in the source", () => {
    expect(matchQuote("Teams of up to four people may enter", text)).toBe("missing");
  });
  it("maps match + authority to a verification status", () => {
    expect(verificationFor("exact", 1)).toBe("verified");
    expect(verificationFor("exact", 6)).toBe("partially_verified");
    expect(verificationFor("missing", 1)).toBe("not_verified");
  });
});

describe("conflicting sources", () => {
  const claim = (id: string, value: string, dateIso: string, source: Partial<ComparableClaim["source"]>): ComparableClaim => ({
    id,
    field: "deadline",
    value,
    dateIso,
    source: { id: `s_${id}`, title: source.title ?? id, url: "https://x", authority: source.authority ?? 2, publishedAt: source.publishedAt ?? null, retrievedAt: null },
  });

  it("prefers the current official schedule over an older blog, and keeps both values", () => {
    const blog = claim("blog", "30 Oct 2026", "2026-10-30T18:29:00.000Z", { title: "Organizer blog", authority: 5, publishedAt: "2026-10-01" });
    const schedule = claim("sched", "31 Oct 2026", "2026-10-31T18:29:00.000Z", { title: "Official schedule", authority: 1 });
    const { conflicts, losingClaimIds, preferredByField } = resolveConflicts([blog, schedule]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].values.map((v) => v.value)).toEqual(["31 Oct 2026", "30 Oct 2026"]);
    expect(conflicts[0].preferred).toBe("31 Oct 2026");
    expect(conflicts[0].reason).toMatch(/Official schedule.*over.*Organizer blog/);
    expect(losingClaimIds).toEqual(["blog"]);
    expect(preferredByField.get("deadline")?.id).toBe("sched");
  });

  it("uses publication date to break ties between equal authorities", () => {
    const old = claim("old", "30 Oct", "2026-10-30T00:00:00.000Z", { authority: 2, publishedAt: "2026-09-01" });
    const recent = claim("new", "31 Oct", "2026-10-31T00:00:00.000Z", { authority: 2, publishedAt: "2026-10-20" });
    const { conflicts } = resolveConflicts([old, recent]);
    expect(conflicts[0].preferred).toBe("31 Oct");
    expect(conflicts[0].reason).toMatch(/more recently published/);
  });

  it("does not report a conflict when sources agree", () => {
    const a = claim("a", "31 Oct 2026, 23:59 IST", "2026-10-31T18:29:00.000Z", { authority: 2 });
    const b = claim("b", "31 Oct 2026, 23:59 IST", "2026-10-31T18:29:00.000Z", { authority: 1 });
    expect(resolveConflicts([a, b]).conflicts).toHaveLength(0);
  });
});

describe("source classification", () => {
  it("ranks official pages by type and site-wide pages lower", () => {
    expect(classifySource("https://www.wemakedevs.org/wispr/schedule", "wemakedevs.org", "", "/wispr")).toEqual({ sourceType: "official_schedule", authority: 1 });
    expect(classifySource("https://www.wemakedevs.org/wispr/judges", "wemakedevs.org", "", "/wispr")).toEqual({ sourceType: "official_judging", authority: 2 });
    expect(classifySource("https://www.wemakedevs.org/terms", "wemakedevs.org", "", "/wispr").authority).toBe(3);
    expect(classifySource("https://devpost.com/software/hackwin", "wemakedevs.org").sourceType).toBe("devpost_project");
    expect(classifySource("https://news.ycombinator.com/item?id=1", "wemakedevs.org").authority).toBe(7);
  });
});
