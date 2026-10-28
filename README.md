# RubricRoom

**Challenge your idea before the judges do.**
_Research smarter. Build differently. Prove what matters._

Paste a hackathon link, pitch your idea by voice, and let a team of AI specialists research the competition, challenge your assumptions, find better opportunities and build an evidence-backed strategy.

RubricRoom was built for the **WeMakeDevs × Wispr Flow "No Hands" challenge (Track 1: Builders)**. Its principle: *don't just generate ideas — investigate whether they deserve to be built.* It never promises a win and never calls an idea "unique" just because a search came back empty.

---

## What it does

| Capability | What actually happens |
|---|---|
| **Hackathon Intelligence** | Fetches the official page through an SSRF-safe fetcher, follows linked rules/judging/schedule/FAQ pages, extracts the event dossier and **checks every claim's quote against the retrieved text**. Conflicts between sources are shown with the reason one was preferred (source-authority hierarchy). Missing fields say *Not verified*. |
| **Animated-counter recovery** | The WeMakeDevs judging page renders its weights as "0%" in static HTML and animates them in the browser. RubricRoom recovers 30/30/25/15 from the page's own markup, pairs each value with the criterion label it precedes, and labels the result *recovered from page markup*. |
| **Competitor research (Scout)** | Varied search angles (not just the title) → GitHub REST API, Hacker News (Algolia), and Devpost/Product Hunt/web via Tavily or Exa → reads the actual READMEs/pages → compares concept *structure* (user, problem, workflow, input, output…), not names → originality report with explicit research limitations. |
| **Opportunity Radar (Nova)** | Six discovery modes + eight modifiers. Gathers real signals first (HN pain-point comments, GitHub crowding counts, the organizer's own example ideas). Problems are labelled *observed* only when a retrieved signal backs them; references can only be URLs research retrieved — enforced in code. A diversity check removes the same concept under a new name. |
| **The Judge's Room (Verdict)** | Voice-first debate against simulated evaluation roles (User Advocate, Originality Skeptic, Engineering, Sponsor, Demo). Every claim you make is classified (user-reported / checkable / speculative / correction / differentiator). **Code-enforced guardrails**: ratings can't rise without an accepted, non-speculative claim; user-reported evidence moves a criterion at most +1 and never to 5; links are reachability-checked (and a link to the hackathon's own site doesn't count). Corrections become *proposals* you confirm. |
| **Evidence-based reassessment** | Immutable idea versions, a full assessment audit trail (before → after, reason, evidence), version compare/restore/branch/merge. |
| **Comparison arena (Prism)** | 2–5 ideas side by side on problem, personal relevance, rubric alignment, overlap, feasibility, scope, demo, sponsor use, evidence and risks. *Select as My Project* is reversible. |
| **Build Strategy (Forge + Sprint)** | Calendar-true plan computed in code from the real deadline (in the event's timezone) and your hours: Core MVP / Strong demo / Optional, day-by-day tasks with dependencies and acceptance criteria, risk register with scope cuts, Markdown/JSON export. Past the deadline it's labelled a *post-deadline roadmap*. |
| **Demo Strategy** | A timed script that only narrates features you've marked done; refine by voice. |
| **Evidence-to-Rubric Board (Proof)** | Each official criterion → suggested proof → attached artifacts. URLs are reachability-checked (*"reachability verified" ≠ "works"*); screenshots and Wispr usage cards are always *needs human verification*. Readiness reads "4 of 6 required artifacts prepared". |
| **Ask RubricRoom** | Dictate a command ("Give me something less crowded and easier to build") → mapped to an allow-listed intent; mutating actions require confirmation; nothing is executed as code. |

### Wispr Flow, honestly
Wispr Flow inserts polished dictated text wherever the cursor is. RubricRoom doesn't pretend to control Wispr or have a transcription API: it makes every important input a roomy, auto-focusing field built for dictation (pitch, debate answers, corrections, change requests, commands, demo refinements), tells you to hold your Wispr Flow shortcut (Settings lists the defaults: Fn on Mac, Ctrl + Win on Windows), handles Hindi/Hinglish/mixed text and preserves the original pitch. It can't tell whether text was dictated, so it never fabricates usage stats — attach your real Insights usage card on the Evidence Board. Optional spoken judge replies use the browser's speech synthesis, separate from dictation.

---

## Quick start

```bash
npm install
npm run dev            # http://localhost:3000
```

No keys are required: the app runs on an embedded PGlite database and an **offline rule-based mode** that is labelled everywhere it's used. Click **Try RubricRoom with a Real Hackathon** for the seeded WeMakeDevs × Wispr dossier (a cached snapshot of the official pages, labelled as cached with its retrieval time — `npm run seed:refresh` re-fetches it through the app's own fetcher).

### Product tour

A 2-minute walkthrough of every feature (`public/demo/rubricroom-tour.mp4`, rendered from real captures of the app) plays inline on the dashboard for new visitors, with clickable chapters, and opens from **Watch the 2-minute tour** in the dashboard hero for everyone. To update it, replace the MP4 (H.264, `-movflags +faststart`) and poster in `public/demo/` and adjust `TOUR_CHAPTERS` in `src/components/tour/product-tour.tsx` if scene times change.

### Example runs

The dashboard also offers **example runs** on other real hackathons: PayPal AI Hackathon (Devpost) and HackOdisha 6.0 (Devfolio, Hinglish pitch). Each is a complete session captured with the real pipeline — live page retrieval and Atlas extraction with citations, the pitch structured by Prism and assessed by Verdict, Scout competitor research, a Judge's Room exchange, and a Forge + Sprint build plan and demo script. The pitches and the participant's debate answers were written for the examples and are labelled as samples. Opening an example copies it into the visitor's own workspace with fresh ids. `npm run examples:capture` re-runs the capture (needs `ANTHROPIC_API_KEY`; search keys recommended), and `npm run examples:capture code-for-a-billion-2026` adds a third example defined in the script. Sites whose robots.txt disallows automated access are not used.

### Configuration (`.env.local`, see `.env.example`)

| Variable | Enables | Without it |
|---|---|---|
| `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY` + `OPENAI_MODEL`) | AI agents (default model `claude-opus-5-5`, override with `AI_MODEL`) | Deterministic extraction, rule-based judge/planner; Nova only gathers signals |
| `AI_SPEED` | `fast` (default): Opus fast mode, about 2x quicker agent replies at 2x the token price; falls back to standard speed automatically | `standard`: normal speed and price |
| `AI_FAST_MODEL` | The quick model that writes the Judge's Room opening question (default `gpt-5-mini` with OpenAI, `claude-haiku-5-5` with Anthropic) | Default used |
| `TAVILY_API_KEY` or `EXA_API_KEY` | Devpost / Product Hunt / web search | Those sources show **Not configured**; GitHub + HN still run |
| `GITHUB_TOKEN` | Higher GitHub rate limit | Unauthenticated (low limit; partial results are labelled) |
| `DATABASE_URL` | Hosted Postgres (required for public deployment) | Embedded PGlite in `~/.rubricroom/pglite` (outside the project, so `next dev` doesn't reload on writes) |
| `AI_DAILY_BUDGET_USD` | Shared daily AI spending cap, estimated from each call's token usage at list price (`AI_PRICE_INPUT_PER_M` / `AI_PRICE_OUTPUT_PER_M` to override) | Default $3/day; past the cap every agent answers rule-based until 00:00 UTC |
| `RATE_LIMIT_*` | Public-demo protection | Defaults: 30 AI calls/h per visitor network (`RATE_LIMIT_AI_PER_IP_HOUR`), 60 AI calls/h per workspace, 12 research runs/h, 300 requests/day per IP |

With OpenAI, each agent's effort maps one step lighter on GPT-5 reasoning (`low` → `minimal`, `medium` → `low`). Judge replies and Atlas extraction run at the lightest level (a reply starts in about 1.5 s; tested to classify claims and verify quotes as well as the heavier level), while the rubric assessment keeps more reasoning because lighter settings shifted its scores. Any agent whose AI call fails or is capped falls back to its rule-based version, so no action breaks.

Waiting is always visible. The Judge's Room opens straight away: the quick model streams the opening question while Verdict scores the idea against the rubric alongside it (a lease keeps two tabs from doing it twice, and an answer sent before scoring finishes waits for it). Judge replies stream word by word. During event research, Atlas reports what it has extracted so far into the step trace.

Deadlines are shown as the source states them: a page that gives only a date ("Apr 26, 2026") is shown as that date and counted down to the end of that day, never converted from midnight UTC. When the active hackathon's deadline has passed, the upcoming hackathon closing soonest takes over, with a notice and a way back; one you choose with **Make active** stays.

## Architecture

```
Next.js 16 (App Router, RSC) · TypeScript · Tailwind v4 · Radix primitives · Lucide
├─ src/proxy.ts                anonymous, httpOnly workspace cookie (no login; per-visitor isolation)
├─ src/lib/net/                SSRF-safe fetch: protocol/port/host checks, DNS checked at connect time
│                              (blocks rebinding + redirects into private ranges), size/type/time limits, robots.txt
├─ src/lib/extract/            HTML/PDF text, markup-hint recovery, deterministic extractor, date parser
├─ src/lib/research/           durable step-driven jobs (one bounded step per request, lease-locked,
│                              budgets for queries/fetches/GitHub/AI/time), verification + conflict resolution
├─ src/lib/agents/             Atlas · Scout · Nova · Verdict · Forge · Prism · Sprint · Proof · command interpreter
│                              (separate prompts, tools and Zod output contracts; shared structured records)
├─ src/lib/ai/                 Claude SDK structured outputs (+ server-side refusal fallbacks), optional OpenAI
│                              adapter, untrusted-content wrapper (prompt-injection boundary), audit log of every call
└─ src/lib/db/schema.ts        Drizzle/Postgres schema (PGlite locally); migrations in ./drizzle
```

External pages are always data, never instructions: they're wrapped in tags the model is told never to obey, attempts to close the tag are neutralized, and every extracted value is re-checked against the source text in code.

## Tests

```bash
npm run typecheck && npm run lint
npm test               # 131 unit + integration tests (Vitest, in-memory Postgres)
npm run check:schemas  # sends every agent schema to the live Claude API (a few tokens each)
npx playwright install chromium && npm run build && npm run test:e2e   # 10 end-to-end tests
```

Coverage includes SSRF (private ranges, metadata IP, IPv4-mapped IPv6, numeric hosts, redirect revalidation), extraction against the real WeMakeDevs pages (title, deadline, weights, tracks, deliverables, missing weights, injected instructions), PDF rules, conflicting dates, GitHub success/rate-limit/empty/failure, duplicate results, similarity (same name ≠ same idea; renamed duplicates detected), Nova evidence grounding, judge guardrails, debate persistence + audit trail, immutable versions, calendar-true planning, command allow-listing, cross-workspace isolation, rate limits, and the full no-login demo in a real browser (desktop + mobile).

## Deploying publicly

1. Create a Postgres database (Neon or Supabase both work; transaction poolers are supported).
2. Deploy to Vercel (or any Node host) with `DATABASE_URL`, `ANTHROPIC_API_KEY`, and optionally `TAVILY_API_KEY`/`EXA_API_KEY` and `GITHUB_TOKEN`.
3. Migrations run automatically on first request (`npm run db:migrate` to run them explicitly).

Research jobs don't rely on background promises: the client advances them one bounded step per request and all state lives in Postgres, so they work on serverless hosts.

## Two-minute demo (only shows what's built)

1. **0:00 – Problem.** "I spent hours comparing hackathon ideas and rereading judging pages, and still wasn't sure. So I built RubricRoom."
2. **0:15 – Event intelligence.** Paste `https://www.wemakedevs.org/wispr` → Atlas reads the official pages → Judging tab: 30/30/25/15 recovered from markup, deadline 31 Oct 2026 11:59 pm IST, each with a source quote.
3. **0:35 – Research.** Scout checks who already built the idea — real GitHub, Hacker News and Devpost links, overlaps quoted from their pages, research limitations listed.
4. **0:55 – The Judge's Room.** Hold the Wispr Flow shortcut and pitch; the panel challenges; answer by voice with a real example → claim accepted as user-reported, one criterion moves 3→4 with the reason shown; "judges will love it" is rejected.
5. **1:25 – Correction by voice.** "Remove the video calls and focus on the dashboard" → confirm → version 2, reassessed.
6. **1:40 – Plan & proof.** Calendar-true plan to the deadline; Evidence Board: "Submission readiness: X of 4 required artifacts prepared".
7. **1:55 – Close.** "Challenge your idea before the judges do."

## Limitations (stated, not hidden)
- Research can't see private submissions, unindexed projects or closed communities; originality is never claimed from absence of evidence.
- Offline mode uses keyword/structure heuristics; ratings and comparisons are labelled rule-based.
- Reachability checks don't prove an app works; screenshots can't be machine-verified.
- No scheduled monitoring or alerts are claimed — nothing runs in the background without a request.
