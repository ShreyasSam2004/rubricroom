import fs from "node:fs";
import path from "node:path";
import type { SourceForExtraction } from "@/lib/extract/contract";
import { extractHtml } from "@/lib/extract/html";

export const FIXTURES = path.join(__dirname, "fixtures");

export function fixture(name: string) {
  return fs.readFileSync(path.join(FIXTURES, name), "utf8");
}

/** The three real WeMakeDevs × Wispr pages, as extraction sources (main page first). */
export function wisprSources(): SourceForExtraction[] {
  const pages: [string, string, number, SourceForExtraction["sourceType"]][] = [
    ["wispr-main.html", "https://www.wemakedevs.org/wispr", 2, "official_page"],
    ["wispr-judges.html", "https://www.wemakedevs.org/wispr/judges", 2, "official_judging"],
    ["wispr-schedule.html", "https://www.wemakedevs.org/wispr/schedule", 1, "official_schedule"],
  ];
  return pages.map(([file, url, authority, sourceType], i) => {
    const p = extractHtml(fixture(file), url);
    return { ref: i, sourceId: `src_${i}`, url, title: p.title, sourceType, authority, publishedAt: null, retrievedAt: "2026-10-26T18:55:00Z", text: p.text, markupHints: p.markupHints };
  });
}

/** A Response-like object for injecting into fetch-based code under test. */
export function fakeResponse(body: string | Buffer, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(typeof body === "string" ? body : new Uint8Array(body), { status: init.status ?? 200, headers: init.headers ?? { "content-type": "text/html" } });
}
