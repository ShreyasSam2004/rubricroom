// Judging weights are saved only when they're real: an animated counter's "0%" is never a weight,
// and "recovered from page markup" needs a value the markup recovery actually found.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { hackathons, judgingCriteria, workspaces } from "@/lib/db/schema";
import type { SourceForExtraction } from "@/lib/extract/contract";
import { extractHtml } from "@/lib/extract/html";
import { heuristicExtract } from "@/lib/extract/heuristics";
import { persistExtraction } from "@/lib/research/persist-event";
import { fixture } from "../helpers";

const W = `ws_${"e".repeat(32)}`;
const page = extractHtml(fixture("switch-judging.html"), "https://www.wemakedevs.org/hackathons/switch");
const source = (markupHints = page.markupHints): SourceForExtraction => ({ ref: 0, sourceId: "src_switch", url: "https://www.wemakedevs.org/hackathons/switch", title: page.title, sourceType: "official_judging", authority: 1, publishedAt: null, retrievedAt: null, text: page.text, markupHints });

async function save(hackathonId: string, src: SourceForExtraction, edit: (x: ReturnType<typeof heuristicExtract>) => void) {
  const db = await getDb();
  await db.insert(hackathons).values({ id: hackathonId, workspaceId: W, name: "Flip the Switch Hackathon", officialUrl: src.url });
  const x = heuristicExtract([src], new Date("2026-10-29T00:00:00Z"));
  edit(x);
  await persistExtraction({ workspaceId: W, hackathonId, sources: [src], extraction: x, method: "ai", notes: [] });
  return (await db.select().from(judgingCriteria).where(eq(judgingCriteria.hackathonId, hackathonId))).sort((a, b) => a.position - b.position).map((c) => [c.name, c.weight, c.weightBasis]);
}

beforeAll(async () => {
  await resetDbForTests();
  const db = await getDb();
  await db.insert(workspaces).values({ id: W });
});

afterAll(async () => {
  await resetDbForTests();
});

describe("judging weights", () => {
  it("saves the weights recovered from the bars, labelled as recovered from markup", async () => {
    expect(await save("hack_switch_a", source(), () => undefined)).toEqual([
      ["Use of Switch", 30, "markup_recovered"],
      ["Technical execution", 25, "markup_recovered"],
      ["Creativity and impact", 25, "markup_recovered"],
      ["Presentation", 20, "markup_recovered"],
    ]);
  });

  it("refuses a model's 0% weights that claim to come from markup the recovery never found", async () => {
    const rows = await save("hack_switch_b", source([]), (x) => {
      for (const c of x.criteria) Object.assign(c, { weight: 0, weightFromMarkupHint: true });
    });
    expect(rows.map(([, weight, basis]) => [weight, basis])).toEqual(Array(4).fill([null, "illustrative"]));
  });

  it("drops the markup label from a weight no recovered value backs", async () => {
    const rows = await save("hack_switch_c", source([]), (x) => {
      Object.assign(x.criteria[0], { weight: 40, weightFromMarkupHint: true });
    });
    expect(rows[0]).toEqual(["Use of Switch", 40, "official"]);
  });
});
