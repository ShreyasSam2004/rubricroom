import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { sha256 } from "@/lib/text";
import type { MarkupHint } from "@/lib/types";

export interface PageLink {
  url: string;
  text: string;
  sameSite: boolean;
}

export interface ExtractedPage {
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  imageUrl: string | null;
  publishedAt: string | null;
  modifiedAt: string | null;
  text: string;
  links: PageLink[];
  /** Values hidden in markup that the visible text misrepresents (e.g. animated counters rendering "0%"). */
  markupHints: MarkupHint[];
  contentHash: string;
}

const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "main", "header", "footer", "aside", "nav", "ul", "ol", "li", "dl", "dt", "dd",
  "table", "tr", "td", "th", "thead", "tbody", "blockquote", "pre", "figure", "figcaption", "br", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6", "form", "fieldset", "details", "summary",
]);
const DROP_TAGS = "script,style,noscript,svg,iframe,template,canvas,video,audio,object,embed,link,meta,head,button[aria-hidden=true]";

function walk($: cheerio.CheerioAPI, node: AnyNode, out: string[]) {
  if (node.type === "text") {
    const t = (node as unknown as { data: string }).data.replace(/\s+/g, " ");
    if (t.trim()) out.push(t);
    return;
  }
  if (node.type !== "tag") return;
  const el = node as Element;
  const tag = el.name.toLowerCase();
  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag[1]);
    const inner: string[] = [];
    for (const child of el.children ?? []) walk($, child, inner);
    const text = inner.join("").replace(/\s+/g, " ").trim();
    if (text) out.push(`\n\n${"#".repeat(Math.min(level, 4))} ${text}\n`);
    return;
  }
  const block = BLOCK_TAGS.has(tag);
  if (block) out.push("\n");
  if (tag === "li") out.push("- ");
  for (const child of el.children ?? []) walk($, child, out);
  if (tag === "td" || tag === "th") out.push(" | ");
  if (block) out.push("\n");
  // Adjacent inline elements ("<span>Track 1</span><span>for developers</span>") would otherwise fuse into one word.
  else if (INLINE_SEPARATED.has(tag)) {
    const last = out[out.length - 1];
    if (last && !/\s$/.test(last)) out.push(" ");
  }
}

const INLINE_SEPARATED = new Set(["span", "a", "strong", "em", "b", "i", "small", "label", "sup", "sub", "code", "mark", "time", "abbr"]);

export function htmlToText($: cheerio.CheerioAPI): string {
  const root = $("body").length ? $("body")[0] : $.root()[0];
  const out: string[] = [];
  walk($, root as AnyNode, out);
  return out
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function firstDate(values: (string | undefined | null)[]): string | null {
  for (const v of values) {
    if (!v) continue;
    const d = new Date(v);
    if (!Number.isNaN(d.getTime()) && d.getFullYear() > 1995) return d.toISOString();
  }
  return null;
}

function jsonLdDates($: cheerio.CheerioAPI) {
  const published: string[] = [];
  const modified: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text());
      const items = Array.isArray(data) ? data : data["@graph"] ?? [data];
      for (const item of items) {
        if (item?.datePublished) published.push(String(item.datePublished));
        if (item?.dateModified) modified.push(String(item.dateModified));
      }
    } catch {
      /* malformed JSON-LD is common; ignore */
    }
  });
  return { published, modified };
}

const VALUE_PATTERNS = [
  /\\?"value\\?":\s*(\d{1,3}(?:\.\d+)?)\s*,\s*\\?"duration\\?"/g, // RSC payload: {"value":30,"duration":1.2}
  /\\?"share\\?":\s*(\d{1,3}(?:\.\d+)?)/g, // bar share props
  /width:\s*(\d{1,3}(?:\.\d+)?)%/g, // progress bars: style="width:30%"
  /(?:data-(?:value|target|count|to)|aria-valuenow)="(\d{1,3}(?:\.\d+)?)"/g,
];

function escapeForJson(s: string) {
  return JSON.stringify(s).slice(1, -1);
}

/** Nearest numeric value that appears in the markup shortly *before* `label`. */
function valueBefore(rawHtml: string, label: string, window = 1200): number | null {
  const variants = [label, escapeForJson(label), escapeForJson(escapeForJson(label)), label.replace(/'/g, "&#x27;").replace(/"/g, "&quot;")];
  let idx = -1;
  for (const v of variants) {
    idx = rawHtml.indexOf(v);
    if (idx >= 0) break;
  }
  if (idx < 0) return null;
  const slice = rawHtml.slice(Math.max(0, idx - window), idx);
  let best: { pos: number; value: number } | null = null;
  for (const pattern of VALUE_PATTERNS) {
    for (const m of slice.matchAll(new RegExp(pattern.source, "g"))) {
      const pos = m.index ?? 0;
      if (!best || pos > best.pos) best = { pos, value: Number(m[1]) };
    }
  }
  return best ? best.value : null;
}

/**
 * Recover numbers that animated counters hide. Many marketing sites render "0%" or "₹0" in
 * static HTML and count up in the browser; the real values live in inline styles or the
 * framework payload. We surface them as *hints* paired with the label that follows each
 * counter — the extractor decides whether they apply and records the method.
 */
export function recoverMarkupHints(rawHtml: string, visibleText: string): MarkupHint[] {
  const lines = visibleText.split("\n").map((l) => l.trim()).filter(Boolean);
  const labels: string[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^0\s?%$/.test(lines[i])) labels.push(lines[i + 1].replace(/^#+\s*/, ""));
  }
  if (labels.length < 2) return [];
  const hints: MarkupHint[] = [];
  for (const label of labels) {
    const value = valueBefore(rawHtml, label);
    if (value !== null) {
      hints.push({ text: `Markup value ${value}% precedes "${label}" (visible text shows an animated 0%).`, label, value });
    }
  }
  if (hints.length) {
    const sum = hints.reduce((a, h) => a + (h.value ?? 0), 0);
    hints.unshift({
      text: `Visible text shows "0%" ${labels.length} times (animated counters). ${hints.length} values recovered from page markup${
        sum === 100 ? " and they sum to 100" : ` (sum ${sum})`
      }.`,
    });
  }
  return hints;
}

export function extractHtml(rawHtml: string, pageUrl: string): ExtractedPage {
  const $ = cheerio.load(rawHtml);
  const meta = (sel: string) => $(sel).attr("content")?.trim() || null;
  const title =
    meta('meta[property="og:title"]') || $("title").first().text().trim() || $("h1").first().text().trim() || null;
  const description = meta('meta[name="description"]') || meta('meta[property="og:description"]');
  const siteName = meta('meta[property="og:site_name"]');
  const imageUrl = meta('meta[property="og:image"]');
  const ld = jsonLdDates($);
  const publishedAt = firstDate([
    meta('meta[property="article:published_time"]'),
    meta('meta[name="date"]'),
    meta('meta[name="pubdate"]'),
    ...ld.published,
  ]);
  const modifiedAt = firstDate([meta('meta[property="article:modified_time"]'), ...ld.modified]);

  const base = new URL(pageUrl);
  const links: PageLink[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("javascript:")) return;
    try {
      const abs = new URL(href, base);
      abs.hash = "";
      const key = abs.toString();
      if (seen.has(key) || !/^https?:$/.test(abs.protocol)) return;
      seen.add(key);
      links.push({
        url: key,
        text: $(el).text().replace(/\s+/g, " ").trim().slice(0, 120),
        sameSite: abs.hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, ""),
      });
    } catch {
      /* ignore bad hrefs */
    }
  });

  $(DROP_TAGS).remove();
  const body = htmlToText($);
  // The meta description is part of the page the organizer published; keep it quotable.
  const text = description && !body.includes(description) ? `> ${description}\n\n${body}` : body;
  return {
    url: pageUrl,
    title,
    description,
    siteName,
    imageUrl,
    publishedAt,
    modifiedAt,
    text,
    links: links.slice(0, 400),
    markupHints: recoverMarkupHints(rawHtml, text),
    contentHash: sha256(text),
  };
}
