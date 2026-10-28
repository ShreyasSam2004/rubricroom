/**
 * Refresh the cached demo snapshot by fetching the real pages through RubricRoom's own
 * SSRF-safe fetcher and extractor. The demo workspace is then built from this snapshot by the
 * same extraction/verification code the live pipeline uses, and is labelled as cached with
 * these retrieval timestamps.
 *
 *   npm run seed:refresh
 */
import fs from "node:fs";
import path from "node:path";
import { extractHtml } from "../src/lib/extract/html";
import { safeFetch } from "../src/lib/net/safe-fetch";
import { classifySource } from "../src/lib/research/verify";

const OFFICIAL = [
  "https://www.wemakedevs.org/wispr",
  "https://www.wemakedevs.org/wispr/judges",
  "https://www.wemakedevs.org/wispr/schedule",
  "https://www.wemakedevs.org/wispr/ideas",
];

async function grab(url: string) {
  const res = await safeFetch(url, { maxBytes: 4_000_000 });
  const page = extractHtml(res.body.toString("utf8"), res.finalUrl);
  return { res, page, retrievedAt: new Date().toISOString() };
}

async function main() {
  const sources = [];
  for (const url of OFFICIAL) {
    const { res, page, retrievedAt } = await grab(url);
    const { sourceType, authority } = classifySource(res.finalUrl, "wemakedevs.org", page.title ?? "");
    sources.push({
      url,
      finalUrl: res.finalUrl,
      title: page.title,
      publisher: page.siteName ?? "WeMakeDevs",
      sourceType,
      authority,
      publishedAt: page.publishedAt,
      retrievedAt,
      httpStatus: res.status,
      text: page.text,
      markupHints: page.markupHints,
      contentHash: page.contentHash,
      excerpt: (page.description ?? page.text).slice(0, 400),
    });
    console.log(`✓ ${url} (${page.text.length} chars, ${page.markupHints.length} markup hints)`);
  }
  const out = path.join(process.cwd(), "src", "seed", "wispr-snapshot.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), generator: "scripts/refresh-seed.ts (RubricRoom safeFetch + extractHtml)", sources }, null, 1));
  console.log(`\nWrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
