// Deterministic (offline) event extractor. It never invents values: every item it returns is a
// sentence or line that literally exists in a retrieved source, and fields it cannot find are
// reported as uncertainties. Atlas uses it when no AI provider is configured, and as a cross-check.

import { emptyExtraction, type Extraction, type SourceForExtraction } from "./contract";
import { describeMention, findDateMentions, findDateRanges, inferYear, mentionToIso, TZ_NAMES, type DateMention } from "./dates";

const PLATFORM_NAMES = /^(devpost|devfolio|mlh|major league hacking|luma|lu\.ma|eventbrite|hackerearth|unstop|dorahacks|taikai|hackclub)$/i;

interface Line {
  text: string;
  heading: string; // nearest heading above
  isHeading: boolean;
  question: string | null; // FAQ question this line answers
  ref: number;
}

function linesOf(src: SourceForExtraction): Line[] {
  const raw = src.text.split("\n").map((l) => l.trim()).filter(Boolean);
  const out: Line[] = [];
  let heading = "";
  let question: string | null = null;
  for (const text of raw) {
    const isHeading = /^#{1,4}\s/.test(text);
    if (isHeading) {
      heading = text.replace(/^#+\s*/, "");
      question = null;
    }
    out.push({ text, heading, isHeading, question: isHeading ? null : question, ref: src.ref });
    if (!isHeading) question = /\?$/.test(text) && text.length < 120 ? text : null;
  }
  return out;
}

function sentencesOf(line: string): string[] {
  return line
    .replace(/^[-*•]\s*/, "")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9₹$"'(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}

function clean(s: string) {
  return s.replace(/^#+\s*/, "").replace(/^[-*•]\s*/, "").replace(/\s+/g, " ").trim();
}

function stripNumbering(s: string) {
  return clean(s).replace(/^(\d{1,2}\s*[.)]?\s*)+/, "").trim();
}

type Hit = { ref: number; quote: string; context: string };

function findSentences(lines: Line[], test: (sentence: string, line: Line) => boolean, limit = 6): Hit[] {
  const hits: Hit[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (line.isHeading) continue;
    for (const s of sentencesOf(line.text)) {
      if (seen.has(s) || /\?$/.test(s)) continue;
      if (test(s, line)) {
        seen.add(s);
        hits.push({ ref: line.ref, quote: s, context: `${line.question ?? ""} ${s}` });
        if (hits.length >= limit) return hits;
      }
    }
  }
  return hits;
}

const GENERIC_PATH = /^(hackathons?|events?|challenges?|competitions?|overview|home|index|en|about|rules|schedule|judging|faq|prizes)$/i;

/**
 * When the page title is just the site's name ("WeMakeDevs" on wemakedevs.org), take the event
 * name from the address ("/hackathons/openmetadata"), using the casing the page itself uses.
 */
function eventNameFromAddress(primary: SourceForExtraction, titleName: string): { name: string; quote: string } | null {
  let url: URL;
  try {
    url = new URL(primary.url);
  } catch {
    return null;
  }
  const brand = titleName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const host = url.hostname.toLowerCase().replace(/[^a-z0-9.]/g, "");
  if (titleName && !(brand.length >= 3 && host.includes(brand))) return null;
  const slug = url.pathname.split("/").filter(Boolean).reverse().find((s) => !GENERIC_PATH.test(s) && /[a-z]/i.test(s));
  if (!slug) return null;
  const words = decodeURIComponent(slug).split(/[-_]+/).filter(Boolean);
  const pattern = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s-]?");
  const cased = primary.text.match(new RegExp(`\\b${pattern}\\b`, "i"))?.[0];
  if (!cased) return null;
  const base = cased === cased.toLowerCase() ? cased.replace(/\b\w/g, (c) => c.toUpperCase()) : cased;
  const eventWord = /hackathon/i.test(`${url.pathname} ${primary.text.slice(0, 2000)}`) ? "Hackathon" : "";
  return { name: [base, eventWord].filter(Boolean).join(" "), quote: cased };
}

function deadlineScore(context: string): number {
  const c = context.toLowerCase();
  let score = 0;
  if (/submissions?\s+(close|closes|closing|due|deadline)/.test(c)) score += 6;
  if (/\bdeadline\b/.test(c)) score += 4;
  if (/submit[^.]{0,40}\b(by|before)\b/.test(c)) score += 4;
  if (/\bclose[sd]?\b/.test(c)) score += 2;
  if (/\bsubmi/.test(c)) score += 1;
  if (/\b(announce|winners?|results?|scores?|judg|prize money)/.test(c)) score -= 5;
  if (/\b(start|starts|opens?|begins?|kick|announced)\b/.test(c) && !/close/.test(c)) score -= 4;
  if (/\bregistration\b/.test(c) && !/submi/.test(c)) score -= 3;
  return score;
}

export function heuristicExtract(sources: SourceForExtraction[], now = new Date()): Extraction {
  const out = emptyExtraction();
  if (sources.length === 0) return out;
  const primary = sources[0];
  const allLines = sources.flatMap(linesOf);
  const { year: contextYear } = inferYear(sources.map((s) => `${s.title ?? ""} ${s.text}`), now);

  // ---------- name & organizer ----------
  const h1 = allLines.find((l) => l.ref === primary.ref && /^#\s/.test(l.text));
  const titleParts = (primary.title ?? "").split(/\s+[|–—]\s+/).map((p) => p.trim()).filter(Boolean);
  const titleName = titleParts.find((p) => !/^(judging|schedule|rules|faq|prizes|overview|home)$/i.test(p)) ?? "";
  out.name = clean(h1?.text ?? titleName) || titleName;
  let organizerFromTitle = titleParts.slice(1).find((p) => !PLATFORM_NAMES.test(p) && p !== out.name);
  const hostedBy = findSentences(allLines, (s) => /\b(hosted|organi[sz]ed|presented|run|brought to you) by\b/i.test(s), 1)[0];
  const fromAddress = !h1 ? eventNameFromAddress(primary, out.name) : null;
  if (fromAddress) {
    // The title only names the site (e.g. "WeMakeDevs"), so it is the organizer, not the event.
    organizerFromTitle = organizerFromTitle ?? out.name;
    out.name = fromAddress.name;
    out.facts.push({ field: "name", value: out.name, dateIso: null, confidence: "medium", note: "The page title only names the site; the event name comes from the page address and text.", sourceRef: primary.ref, quote: fromAddress.quote });
  } else if (out.name) {
    out.facts.push({ field: "name", value: out.name, dateIso: null, confidence: "high", note: null, sourceRef: primary.ref, quote: h1 ? clean(h1.text) : primary.title ?? out.name });
  }
  if (organizerFromTitle) {
    out.organizer = organizerFromTitle;
    out.facts.push({ field: "organizer", value: organizerFromTitle, dateIso: null, confidence: "medium", note: "Taken from the official page title.", sourceRef: primary.ref, quote: primary.title ?? organizerFromTitle });
  } else if (hostedBy) {
    const m = hostedBy.quote.match(/\bby\s+([A-Z][\w&.\- ]{1,60})/);
    if (m) {
      out.organizer = m[1].trim();
      out.facts.push({ field: "organizer", value: out.organizer, dateIso: null, confidence: "medium", note: null, sourceRef: hostedBy.ref, quote: hostedBy.quote });
    }
  }

  // ---------- description / summary ----------
  const afterH1 = h1 ? allLines.slice(allLines.indexOf(h1) + 1, allLines.indexOf(h1) + 8) : allLines.slice(0, 12);
  const descLine =
    afterH1.find((l) => !l.isHeading && l.text.length >= 80 && l.text.length <= 500) ??
    afterH1.find((l) => !l.isHeading && l.text.length >= 50 && l.text.length <= 500);
  if (descLine) {
    out.facts.push({ field: "description", value: clean(descLine.text), dateIso: null, confidence: "medium", note: null, sourceRef: descLine.ref, quote: clean(descLine.text) });
  }

  // ---------- format ----------
  // Decide the format from the event page itself when it says so; site-wide pages only as a fallback.
  const formatTest = (s: string) => /\b(online|virtual|remote|in[- ]person|offline|on[- ]site|hybrid|venue)\b/i.test(s) && s.length < 260;
  const primaryFormat = findSentences(allLines.filter((l) => l.ref === primary.ref), formatTest, 4);
  const formatHits = primaryFormat.length ? primaryFormat : findSentences(allLines.filter((l) => (sources.find((x) => x.ref === l.ref)?.authority ?? 9) <= 2), formatTest, 4);
  if (formatHits.length) {
    const joined = formatHits.map((h) => h.quote.toLowerCase()).join(" ");
    const online = /\b(online|virtual|remote)\b/.test(joined);
    const offline = /\b(in[- ]person|offline|on[- ]site|venue)\b/.test(joined);
    const value = /\bhybrid\b/.test(joined) || (online && offline) ? "hybrid" : online ? "online" : "offline";
    const best = formatHits.find((h) => new RegExp(value === "hybrid" ? "hybrid" : value === "online" ? "online|virtual|remote" : "in[- ]person|offline|on[- ]site|venue", "i").test(h.quote)) ?? formatHits[0];
    out.facts.push({ field: "format", value, dateIso: null, confidence: "medium", note: null, sourceRef: best.ref, quote: best.quote });
  }

  // ---------- eligibility / location ----------
  const elig = findSentences(allLines, (s, l) => /\b(anyone in|open to|eligib|residents? of|citizens? of|must be (located|based)|participants from|who can take part)\b/i.test(`${l.question ?? ""} ${s}`) && !/\bpay(ing)?\b/i.test(s), 3);
  const eligRank = (q: string) => (/\b(anyone in|residents? of|citizens? of|must be (located|based)|eligib)/i.test(q) ? 0 : 1);
  elig.sort((a, b) => eligRank(a.quote) - eligRank(b.quote));
  for (const h of elig.slice(0, 2)) {
    out.facts.push({ field: "eligibility", value: h.quote, dateIso: null, confidence: "medium", note: null, sourceRef: h.ref, quote: h.quote });
  }
  const loc = elig
    .map((h) => h.quote.match(/\b[Aa]nyone in ([A-Z][A-Za-z ]{2,30}?)(?:[.,;]|$)/) ?? h.quote.match(/\b[Rr]esidents? of ([A-Z][A-Za-z ]{2,30}?)(?:[.,;]|$)/))
    .find(Boolean);
  if (loc) {
    const hit = elig.find((h) => h.quote.includes(loc[0]))!;
    out.facts.push({ field: "location", value: loc[1].trim(), dateIso: null, confidence: "medium", note: "Geographic restriction stated by the organizer.", sourceRef: hit.ref, quote: hit.quote });
  }

  // ---------- team ----------
  const team = findSentences(allLines, (s) => /\b(solo|no teams|individuals? only|teams? of|team size|members per team|up to \d+ (members|people|participants))\b/i.test(s), 3);
  if (team.length) {
    const q = team[0].quote;
    const range = q.match(/(\d+)\s*(?:-|to|–)\s*(\d+)\s*(?:members|people|participants)/i);
    const upTo = q.match(/(?:teams? of|up to)\s*(?:up to\s*)?(\d+)/i);
    const value = /\b(solo|no teams|individuals? only)\b/i.test(q)
      ? "Solo only (1 person)"
      : range
        ? `${range[1]}–${range[2]} people`
        : upTo
          ? `Up to ${upTo[1]} people`
          : q;
    out.facts.push({ field: "team_size", value, dateIso: null, confidence: "high", note: null, sourceRef: team[0].ref, quote: q });
  }

  // ---------- age ----------
  const age = findSentences(allLines, (s) => /\b(1[3-9]|2[01])\+|\bat least (1[3-9]|2[01]) years|\b(1[3-9]|2[01]) years (of age|old)|\bage (limit|requirement)/i.test(s), 1)[0];
  if (age) out.facts.push({ field: "age", value: age.quote, dateIso: null, confidence: "medium", note: null, sourceRef: age.ref, quote: age.quote });

  // ---------- dates ----------
  const mentions: { m: DateMention; ref: number; sentence: string; context: string }[] = [];
  for (const line of allLines) {
    if (line.isHeading && !/\d/.test(line.text)) continue;
    for (const s of sentencesOf(line.isHeading ? clean(line.text) : line.text)) {
      for (const m of findDateMentions(s)) mentions.push({ m, ref: line.ref, sentence: s, context: `${line.heading} ${line.question ?? ""} ${s}` });
    }
  }
  // Schedule-style lists: a short date-only line followed by its label.
  const EVENTISH = /\b(open|close|closes|announce|start|starts|publish|deadline|submission|judg|winner|result|regist|begin|end|ends|last day|kick|ceremony|demo day|check[- ]?in)\w*/i;
  for (let i = 0; i < allLines.length - 1; i++) {
    const l = allLines[i];
    const ms = findDateMentions(l.text);
    const rest = ms.length === 1 ? l.text.replace(ms[0].raw, "").replace(/[^\p{L}]/gu, "") : "x".repeat(99);
    if (ms.length === 1 && rest.length <= 4 && findDateRanges(l.text).length === 0) {
      const label = allLines[i + 1];
      const src = sources.find((s) => s.ref === l.ref);
      const scheduleSource = /schedule|timeline|dates|calendar/i.test(`${src?.url ?? ""} ${src?.title ?? ""} ${l.heading}`);
      if (
        label &&
        !label.isHeading &&
        findDateMentions(label.text).length === 0 &&
        !/^starts? in\b|\b\d+\s*(days?|hours?)\b/i.test(label.text) &&
        (scheduleSource || EVENTISH.test(label.text))
      ) {
        out.timeline.push({
          label: clean(label.text),
          dateText: clean(l.text),
          dateIso: mentionToIso(ms[0], contextYear, findDateMentions(allLines.map((x) => x.text).join("\n")).find((x) => x.tz)?.tz).iso,
          sourceRef: l.ref,
          quote: clean(l.text),
        });
        mentions.push({ m: ms[0], ref: l.ref, sentence: clean(l.text), context: `${clean(label.text)} ${clean(l.text)}` });
      }
    }
  }

  const tzMention = mentions.find((x) => x.m.tz)?.m.tz ?? null;
  const ranges = sources.flatMap((s) => findDateRanges(s.text).map((r) => ({ ...r, ref: s.ref })));
  const deadlines = mentions
    .map((x) => ({ ...x, score: deadlineScore(x.context) }))
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score || Number(b.m.hour !== null) - Number(a.m.hour !== null));
  if (deadlines.length) {
    const best = deadlines[0];
    const { iso, notes } = mentionToIso(best.m, contextYear, tzMention);
    out.facts.push({
      field: "deadline",
      value: describeMention(best.m, contextYear),
      dateIso: iso,
      confidence: best.m.hour !== null && best.m.tz ? "high" : "medium",
      note: notes.length ? notes.join("; ") : null,
      sourceRef: best.ref,
      quote: best.sentence,
    });
    // Additional deadline statements from *other* sources are kept so conflicts can be detected.
    const seenRefs = new Set([best.ref]);
    for (const other of deadlines.slice(1)) {
      if (seenRefs.has(other.ref)) continue;
      seenRefs.add(other.ref);
      const o = mentionToIso(other.m, contextYear, tzMention);
      out.facts.push({ field: "deadline", value: describeMention(other.m, contextYear), dateIso: o.iso, confidence: "medium", note: o.notes.join("; ") || null, sourceRef: other.ref, quote: other.sentence });
    }
    const tz = best.m.tz ?? tzMention;
    if (tz) {
      out.facts.push({ field: "timezone", value: TZ_NAMES[tz] ?? tz, dateIso: null, confidence: best.m.tz ? "high" : "medium", note: `Stated as "${tz}".`, sourceRef: best.ref, quote: best.sentence });
    }
  } else {
    // No stated submission deadline, but the event page gives its dates: use the last day, and say so.
    const r = ranges.find((x) => x.ref === primary.ref) ?? ranges[0];
    if (r) {
      const src = sources.find((s) => s.ref === r.ref)!;
      const end: DateMention = { index: r.index, raw: r.raw, year: r.year, month: r.endMonth, day: r.endDay, hour: null, minute: null, tz: tzMention };
      const { iso, notes } = mentionToIso(end, contextYear, tzMention);
      out.facts.push({
        field: "deadline",
        value: describeMention(end, contextYear),
        dateIso: iso,
        confidence: "low",
        note: ["The page gives the event dates but no separate submission deadline, so the last event day is used", ...notes].join("; "),
        sourceRef: r.ref,
        quote: src.text.slice(r.index, r.index + r.raw.length),
      });
    }
  }

  const startMention = mentions.find((x) => /\b(start|starts|begins?|opens?|kick)/i.test(x.context) && !/close/i.test(x.sentence));
  if (startMention) {
    const { iso } = mentionToIso({ ...startMention.m, hour: startMention.m.hour ?? 0, minute: startMention.m.minute ?? 0 }, contextYear, tzMention);
    out.facts.push({ field: "start_date", value: describeMention(startMention.m, contextYear), dateIso: iso, confidence: "medium", note: null, sourceRef: startMention.ref, quote: startMention.sentence });
  } else if (ranges[0]) {
    const r = ranges[0];
    const src = sources.find((s) => s.ref === r.ref)!;
    out.facts.push({ field: "start_date", value: `${r.startDay}/${r.month}/${r.year ?? contextYear}`, dateIso: null, confidence: "low", note: "From a date range on the page.", sourceRef: r.ref, quote: src.text.slice(r.index, r.index + r.raw.length) });
  }
  const judging = mentions.find(
    (x) => /\b(scores?\b[^.]*\bpublish|judges'? scores|judging (starts|period|begins|round)|scores and comments)/i.test(x.context) && !/close/i.test(x.context),
  );
  if (judging) out.facts.push({ field: "judging_dates", value: describeMention(judging.m, contextYear), dateIso: mentionToIso(judging.m, contextYear, tzMention).iso, confidence: "medium", note: null, sourceRef: judging.ref, quote: judging.sentence });
  const winners = mentions.find((x) => /\b(winners?|results?)\b.*\b(announc|land|declared|sent)|announc\w*\b.*\bwinners?/i.test(x.context));
  if (winners) out.facts.push({ field: "winner_announcement", value: describeMention(winners.m, contextYear), dateIso: mentionToIso(winners.m, contextYear, tzMention).iso, confidence: "medium", note: null, sourceRef: winners.ref, quote: winners.sentence });

  const reg = findSentences(allLines, (s) => /\bregistration\b/i.test(s) && /\b(open|close|until|stays|deadline)\b/i.test(s), 1)[0];
  if (reg) out.facts.push({ field: "registration", value: reg.quote, dateIso: null, confidence: "medium", note: null, sourceRef: reg.ref, quote: reg.quote });

  // ---------- requirements: accounts, AI tools, IP, hardware, cost, open source ----------
  const needs = findSentences(allLines, (s, l) => /\baccount\b/i.test(s) && /\b(need|required|must|what do i need|set up)\b/i.test(`${l.question ?? ""} ${s}`), 2);
  if (needs[0]) out.facts.push({ field: "required_accounts", value: needs[0].quote, dateIso: null, confidence: "medium", note: null, sourceRef: needs[0].ref, quote: needs[0].quote });
  const hw = findSentences(allLines, (s, l) => /\b(computer|laptop|microphone|hardware|device)\b/i.test(s) && /\b(need|required|must|what do i need)\b/i.test(`${l.question ?? ""} ${s}`), 1)[0];
  if (hw) out.facts.push({ field: "hardware", value: hw.quote, dateIso: null, confidence: "medium", note: null, sourceRef: hw.ref, quote: hw.quote });
  const ai = findSentences(allLines, (s, l) => /\b(ai|chatgpt|claude|copilot|llm|cursor|assistant)\b/i.test(s) && /\b(use any|allowed|permitted|can use|may use|not allowed|prohibited|other tools)\b/i.test(`${l.question ?? ""} ${s}`), 2);
  if (ai[0]) out.facts.push({ field: "ai_tools", value: ai[0].quote, dateIso: null, confidence: "medium", note: null, sourceRef: ai[0].ref, quote: ai[0].quote });
  const ip = findSentences(
    allLines,
    (s, l) => /\b(who owns|ownership|intellectual property|ip rights|right to feature|you own|retain (all )?rights)\b/i.test(`${l.question ?? ""} ${s}`),
    2,
  );
  if (ip.length) {
    const quote = ip.map((h) => h.quote).join(" ");
    out.facts.push({ field: "ip", value: quote, dateIso: null, confidence: "medium", note: null, sourceRef: ip[0].ref, quote: ip[0].quote });
  }
  const cost = findSentences(allLines, (s) => /\b(free to enter|entry fee|registration fee|free of charge)\b/i.test(s), 1)[0];
  if (cost) out.facts.push({ field: "cost", value: cost.quote, dateIso: null, confidence: "medium", note: null, sourceRef: cost.ref, quote: cost.quote });
  const oss = findSentences(allLines, (s) => /\b(open[- ]source|public repo(sitory)?|github repo(sitory)?|mit licen[cs]e|apache licen[cs]e)\b/i.test(s), 1)[0];
  if (oss) out.facts.push({ field: "open_source", value: oss.quote, dateIso: null, confidence: "low", note: null, sourceRef: oss.ref, quote: oss.quote });
  // Licence grants on submissions are IP terms, not open-source requirements.
  const grant = findSentences(allLines, (s) => /\bgrant\b[^.]*\blicen[cs]e\b|\blicen[cs]e\b[^.]*\b(your|the) (project|submission)/i.test(s), 1)[0];
  if (grant) out.facts.push({ field: "ip", value: grant.quote, dateIso: null, confidence: "medium", note: "Licence terms for submissions.", sourceRef: grant.ref, quote: grant.quote });

  // ---------- judging criteria ----------
  const judgingContext = (l: Line, src?: SourceForExtraction) =>
    /judg|criteri|rubric|scor|evaluat|assess/i.test(`${l.heading} ${src?.title ?? ""} ${src?.url ?? ""}`);
  for (const src of sources) {
    const lines = linesOf(src);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const pct = l.text.match(/^(\d{1,3}(?:\.\d+)?)\s?%$/);
      if (pct && judgingContext(l, src)) {
        const name = lines[i + 1] && !/%$/.test(lines[i + 1].text) ? clean(lines[i + 1].text) : null;
        if (!name) continue;
        const desc = lines[i + 2] && !/^\d{1,3}(\.\d+)?\s?%$/.test(lines[i + 2].text) ? clean(lines[i + 2].text) : "";
        let weight: number | null = Number(pct[1]);
        let fromHint = false;
        if (weight === 0) {
          const hint = src.markupHints.find((h) => h.label && clean(h.label) === name && typeof h.value === "number");
          if (hint) {
            weight = hint.value!;
            fromHint = true;
          } else weight = null;
        }
        out.criteria.push({ name, description: desc, weight, weightFromMarkupHint: fromHint, track: null, sourceRef: src.ref, quote: name });
        continue;
      }
      if (!judgingContext(l, src) || l.isHeading) continue;
      const inline =
        l.text.match(/^(?:[-*•]\s*)?(?:\d+[.)]\s*)?([A-Z][^%:–—()]{2,70}?)\s*(?:[–—:-]|\()\s*(\d{1,3})\s?%\)?(?:\s*[–—:-]\s*(.*))?$/) ??
        l.text.match(/^(?:[-*•]\s*)?(\d{1,3})\s?%\s*[–—:-]?\s*([A-Z][^%]{2,80})$/);
      if (inline) {
        const numFirst = /^\d/.test(inline[1]);
        const name = clean(numFirst ? inline[2] : inline[1]);
        let weight: number | null = Number(numFirst ? inline[1] : inline[2]);
        let fromHint = false;
        if (weight === 0) {
          // "0 % Use of Switch": an animated counter on the label's own line.
          const hint = src.markupHints.find((h) => h.label && clean(h.label) === name && typeof h.value === "number");
          weight = hint ? hint.value! : null;
          fromHint = Boolean(hint);
        }
        out.criteria.push({ name, description: clean((numFirst ? "" : inline[3]) ?? ""), weight, weightFromMarkupHint: fromHint, track: null, sourceRef: src.ref, quote: clean(l.text) });
      }
    }
  }
  // Criteria listed without weights (bullets under a "Judging criteria" heading).
  if (out.criteria.length === 0) {
    for (const l of allLines) {
      if (!/^[-*•]\s/.test(l.text) || !/judging criteria|criteria|how .*judged|rubric/i.test(l.heading)) continue;
      const name = clean(l.text).split(/[:–—]/)[0].trim();
      if (name.length < 3 || name.length > 80) continue;
      out.criteria.push({ name, description: clean(l.text).slice(name.length).replace(/^[:–—]\s*/, ""), weight: null, weightFromMarkupHint: false, track: null, sourceRef: l.ref, quote: clean(l.text) });
    }
  }
  // De-duplicate criteria seen on multiple pages; keep the first (highest-authority source comes first).
  const seenCrit = new Set<string>();
  out.criteria = out.criteria.filter((c) => {
    const k = c.name.toLowerCase();
    if (seenCrit.has(k)) return false;
    seenCrit.add(k);
    return true;
  });
  for (const c of out.criteria) {
    if (c.description) out.judgesReward.push({ text: `${c.name} — ${c.description}`, sourceRef: c.sourceRef, quote: c.description });
  }
  const judgeLooks = findSentences(allLines, (s) => /\bjudges? (look|need|have to|want|reward|check)/i.test(s), 3);
  for (const h of judgeLooks) out.judgesReward.push({ text: h.quote, sourceRef: h.ref, quote: h.quote });

  // ---------- tracks ----------
  const seenTrackNumbers = new Set<string>();
  for (const src of sources) {
    const lines = linesOf(src);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].text.match(/^track\s*(\d+)\s*[:–—-]?\s*(.*)$/i);
      if (!m || seenTrackNumbers.has(m[1])) continue;
      const head = lines.slice(i + 1, i + 3).find((l) => l.isHeading);
      if (!head) continue;
      const name = clean(head.text);
      const descLine = lines.slice(lines.indexOf(head) + 1, lines.indexOf(head) + 3).find((l) => !l.isHeading && l.text.length > 30);
      if (out.tracks.some((t) => t.name === name)) continue;
      seenTrackNumbers.add(m[1]);
      out.tracks.push({ name, audience: m[2] ? clean(m[2]) : `Track ${m[1]}`, description: descLine ? clean(descLine.text) : "", sourceRef: src.ref, quote: descLine ? clean(descLine.text) : clean(lines[i].text) });
    }
  }

  // ---------- submission requirements ----------
  const subLines = allLines.filter((l) => /what you submit|submission requirements|what to submit|deliverables|how to submit/i.test(l.heading) && /^[-*•]\s/.test(l.text));
  const subKey = (s: string): Extraction["submission"][number]["key"] => {
    const t = s.toLowerCase();
    if (/video/.test(t)) return "demo_video";
    if (/usage card|usage|insights/.test(t)) return "usage_evidence";
    if (/repo|github|source code/.test(t)) return "repository";
    if (/screenshot/.test(t)) return "screenshots";
    if (/slides|deck|presentation/.test(t)) return "presentation";
    if (/link|url|working project|deployed|live/.test(t)) return "project_url";
    if (/few lines|description|write[- ]?up|readme|explain|problem/.test(t)) return "description";
    if (/form|portal/.test(t)) return "form";
    return "other";
  };
  for (const l of subLines) {
    const label = stripNumbering(l.text);
    if (label.length < 6) continue;
    if (out.submission.some((s) => s.label.toLowerCase() === label.toLowerCase() || (subKey(label) !== "other" && s.key === subKey(label)))) continue;
    const dur = label.match(/(?:up to|maximum of|max(?:imum)?|no (?:longer|more) than)\s+((?:\d+|one|two|three|four|five)\s*(?:minutes?|mins?))/i);
    out.submission.push({ key: subKey(label), label, detail: dur ? `Maximum length: ${dur[1]}` : null, required: true, sourceRef: l.ref, quote: label });
  }

  // ---------- prizes ----------
  const prizeHits = findSentences(allLines, (s, l) => /(₹|\$|€|£|\binr\b|\busd\b)\s?[\d,]{2,}|\b\d[\d,]*\s?(?:inr|usd)\b/i.test(s) && (/\bprize|winner|cash|award|each\b/i.test(s) || /prize/i.test(l.heading)) && !/₹0\b/.test(s), 6);
  for (const h of prizeHits) out.prizes.push({ text: h.quote, sourceRef: h.ref, quote: h.quote });
  for (const l of allLines) {
    const b = l.text.match(/^Bonus\s*(.+)$/);
    if (b) out.prizes.push({ text: `Bonus: ${clean(b[1])}`, sourceRef: l.ref, quote: clean(l.text) });
  }

  // ---------- sponsors ----------
  const parties = out.organizer.split(/\s+(?:x|×|&|and)\s+/i).map((p) => p.trim()).filter((p) => p.length > 1);
  for (const party of parties) {
    const usage = findSentences(allLines, (s) => new RegExp(`\\b(use|using|built with|powered by|speak|dictat)\\w*\\b[^.]*\\b${party.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(s), 2);
    if (usage.length) {
      out.sponsors.push({ name: party, technology: party, usageRequirement: usage.map((u) => u.quote).join(" "), sourceRef: usage[0].ref, quote: usage[0].quote });
    }
  }

  // ---------- mandatory / prohibited / recommendations ----------
  const ruleCategory = (s: string): Extraction["rules"][number]["category"] => {
    const t = s.toLowerCase();
    if (/\b(team|solo|individual)\b/.test(t)) return "team";
    if (/\b(submit|submission|video|link|demo|screenshot|deadline)\b/.test(t)) return "submission";
    if (/\b(owns?|ownership|feature your|intellectual)\b/.test(t)) return "ip";
    if (/\b(anyone in|eligib|students?|residents?|india|age)\b/.test(t)) return "eligibility";
    if (/\b(judg|score)\b/.test(t)) return "judging";
    if (/\b(ai|api|tool|voice|wispr|flow|keyboard|app builder|code)\b/.test(t)) return "technology";
    return "other";
  };
  const prohibitedRe = /\b(not allowed|prohibited|doesn't count|does not count|don't count|cannot|can't|no teams|not permitted|disqualif|must not|may not)\b/i;
  const mandatoryRe = /\b(must|required|have to|has to|need to|needs to|mandatory|only)\b/i;
  const recommendRe = /\b(recommend|encourag|should|can still|best entry|start early|as much as you can)\b/i;
  const ruleHits = findSentences(
    allLines,
    (s) => (prohibitedRe.test(s) || mandatoryRe.test(s) || recommendRe.test(s)) && s.length < 300 && !/cookie|privacy/i.test(s),
    40,
  );
  for (const h of ruleHits) {
    const level = prohibitedRe.test(h.quote) || mandatoryRe.test(h.quote) ? "mandatory" : "recommended";
    out.rules.push({ category: ruleCategory(h.context), text: h.quote, level, applicability: null, sourceRef: h.ref, quote: h.quote });
    if (prohibitedRe.test(h.quote)) out.prohibited.push({ text: h.quote, sourceRef: h.ref, quote: h.quote });
    else if (mandatoryRe.test(h.quote)) out.mandatory.push({ text: h.quote, sourceRef: h.ref, quote: h.quote });
    else out.recommendations.push({ text: h.quote, sourceRef: h.ref, quote: h.quote });
  }

  // When a date omits its year, say where the year came from if the page states it explicitly.
  const explicitYear = sources
    .flatMap((s) => [...findDateRanges(s.text), ...findDateMentions(s.text)].filter((m) => m.year === contextYear).map((m) => m.raw))
    .find(Boolean);
  if (explicitYear) {
    for (const f of out.facts) {
      if (f.note?.includes("inferred from page context")) {
        f.note = f.note.replace(/year not stated next to the date; \d{4} inferred from page context/, `year ${contextYear} from “${explicitYear}” on the same site`);
      }
    }
  }

  // ---------- plain-language summary (assembled only from found facts) ----------
  const fact = (f: string) => out.facts.find((x) => x.field === f)?.value;
  const parts: string[] = [];
  if (out.name) parts.push(`${out.name}${out.organizer ? ` is run by ${out.organizer}` : ""}${fact("format") ? ` as an ${fact("format")} event` : ""}.`);
  if (fact("description")) parts.push(/[.!?]$/.test(fact("description")!) ? fact("description")! : `${fact("description")}.`);
  if (fact("deadline")) parts.push(`Submissions are due ${fact("deadline")}.`);
  if (fact("team_size")) parts.push(`Participation: ${fact("team_size")}.`);
  out.summary = parts.join(" ");
  out.whatToBuild = out.tracks.length
    ? out.tracks.map((t) => `${t.name}: ${t.description}`).join(" ")
    : findSentences(allLines, (s) => /\bbuild (a|an|something|your)\b/i.test(s), 1)[0]?.quote ?? "";

  // ---------- uncertainties: say what we could not establish ----------
  const labels: Record<string, string> = {
    deadline: "Submission deadline",
    team_size: "Team size rules",
    eligibility: "Eligibility restrictions",
    age: "Age restrictions",
    format: "Event format (online/offline)",
    ip: "Intellectual-property terms",
    ai_tools: "Whether AI tools are permitted",
    open_source: "Open-source / repository requirements",
  };
  for (const [field, label] of Object.entries(labels)) {
    if (!out.facts.some((f) => f.field === field)) out.uncertainties.push(`${label}: not stated in the retrieved pages.`);
  }
  if (out.criteria.length === 0) out.uncertainties.push("Judging criteria: not found in the retrieved pages.");
  else if (out.criteria.some((c) => c.weight === null)) out.uncertainties.push("Some judging criteria have no published weight.");
  if (out.submission.length === 0) out.uncertainties.push("Submission requirements: no explicit list found.");
  return out;
}
