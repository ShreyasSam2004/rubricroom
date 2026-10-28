/**
 * Capture the example runs shown in the demo. Each example runs RubricRoom's real pipeline on a
 * real hackathon — live page retrieval + Atlas, a pitch structured by Prism and assessed by
 * Verdict, Scout competitor research, a Judge's Room session, Forge + Sprint build plan and demo
 * script — in a throwaway database, then writes every resulting row to src/seed/examples.json.
 * The pitches and the participant's debate answers below are written for the examples.
 *
 *   npx tsx --env-file=.env.local scripts/capture-examples.ts [example-key ...]
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface ExampleSpec {
  key: string;
  platform: string;
  urls: string[];
  pitchLanguage: "en" | "hinglish";
  blurb: string;
  pitch: string;
  answers: string[];
}

const EXAMPLES: ExampleSpec[] = [
  {
    key: "paypal-ai-2026",
    platform: "Devpost",
    urls: ["https://paypalaihackathon.devpost.com/", "https://paypalaihackathon.devpost.com/rules"],
    pitchLanguage: "en",
    blurb: "An AI collections assistant for freelancers, built on PayPal Invoicing. Shows a sponsor-API hackathon with a full official rubric and prize categories.",
    pitch:
      "PayNudge is an AI collections assistant for freelancers who invoice through PayPal. Freelancers lose weeks chasing overdue invoices and hate writing awkward reminder emails. PayNudge connects to PayPal Invoicing in the sandbox, watches which invoices are overdue, and drafts a reminder in the freelancer's own tone — friendly first, firmer later. If a client replies that they can't pay in full, the agent proposes splitting the amount and creates new PayPal invoices for each part, but nothing is sent until the freelancer approves it with one tap. When PayPal reports the payment through a webhook, PayNudge marks the invoice settled and stops the follow-ups. Built with Next.js, the PayPal Invoicing and Webhooks APIs in sandbox mode, and Claude for drafting and reading client replies.",
    answers: [
      "I freelance as a designer. Last quarter 5 of my 12 PayPal invoices went past due, and I spent two evenings writing reminder emails. Two of those clients only paid after I offered to split the amount.",
      "PayPal can already send automatic reminders, but they're generic and they can't act on a reply. The part I'm building first is reading a client's reply like 'can I pay half now?' and turning it into two new PayPal invoices that the freelancer approves before anything is sent.",
    ],
  },
  {
    // lablab.ai was the first choice for this slot, but its robots.txt disallows automated access,
    // which RubricRoom respects — so this example uses a hackathon whose site allows it.
    key: "code-for-a-billion-2026",
    platform: "Code for India",
    urls: ["https://codeforindia.org/hackathon"],
    pitchLanguage: "en",
    blurb: "An open-source voice assistant for ASHA health workers. Shows a 90-day build-a-thon with an official, equally weighted rubric that rewards proven impact over intentions.",
    pitch:
      "HomeVisit Notes is an open-source voice assistant for ASHA workers, India's community health volunteers. After each home visit, an ASHA speaks a short note in Hindi — 'Sunita, seven months pregnant, BP 150 by 100, swelling in her feet'. The agent turns it into a structured visit record, checks it against simple danger-sign rules for pregnancy and newborn care, and when something like high blood pressure appears it drafts an alert to the supervising ANM with the patient's details for the ASHA to send. At month end it fills the household visit register that ASHAs currently copy by hand. It is a lightweight web app that works on a low-cost Android phone, released under the MIT license, for the Health impact area.",
    answers: [
      "My aunt is an ASHA in a village near Sitapur. She covers about 200 households and spends two evenings every month copying visit notes into the paper register, and she says danger signs are often noticed late because the notes sit in her diary until the monthly meeting.",
      "On proven impact: we don't have deployment data yet. The plan is a two-week pilot with five ASHAs in her block, measuring the time spent on the monthly register and how many danger-sign alerts reach the ANM within 24 hours, and publishing those numbers in the README.",
    ],
  },
  {
    key: "hackodisha-6-2026",
    platform: "Devfolio",
    urls: ["https://hackodisha-6a.devfolio.co/"],
    pitchLanguage: "hinglish",
    blurb: "A Hinglish pitch for a voice-first crop helper. HackOdisha publishes no judging rubric, so RubricRoom does not invent one: the assessment uses general rule-based checks, while the Judge’s Room still debates with AI.",
    pitch:
      "Mera idea hai Krishi Saathi — Odisha ke chhote kisaano ke liye ek voice-first helper. Bahut saare kisaan typing nahi karte, toh woh Odia ya Hindi mein voice note bolte hain, jaise 'dhaan ke patte peele ho rahe hain'. App us voice note ko text mein badalta hai, ek photo ke saath possible fasal ki bimari batata hai, simple language mein agla step samjhata hai, aur nearest Krishi Vigyan Kendra ka number deta hai. Saath mein yeh bhi check karta hai ki kisaan KALIA scheme ke liye eligible hai ya nahi. Pehla version ek simple web app hoga jo WhatsApp jaisa dikhega, Next.js aur ek AI model ke saath.",
    answers: [
      "Mere chacha Sundargarh mein dhaan ugaate hain. Pichhle saal unhone teen baar galat dawai khareedi kyunki dukaan wale ne andaaza lagaya tha ki kaunsi bimari hai.",
      "Photo se bimari pehchanne wale apps pehle se hain. Mera focus voice note se shuru karna hai aur local madad dena hai — nearest KVK ka number aur KALIA eligibility — sirf bimari ka naam nahi.",
    ],
  },
];

const DISCLOSURE =
  "Each example is a real RubricRoom run: the hackathon pages were retrieved live and every extracted fact cites its source; competitor research, assessments, judge replies, the build plan and the demo script are the agents' actual output. The pitches and the participant's answers in the Judge's Room were written to demonstrate the product — they are sample ideas, not a real team's submission.";

async function main() {
  const only = process.argv.slice(2);
  const dbDir = path.join(os.tmpdir(), `rubricroom-capture-${Date.now()}`);
  process.env.PGLITE_DIR = dbDir; // throwaway database; read lazily on first getDb()

  const { getDb } = await import("../src/lib/db/client");
  const schema = await import("../src/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const { aiModel, aiProvider, aiSpeed } = await import("../src/lib/env");
  const { startHackathonResearch } = await import("../src/lib/services/hackathons");
  const { assessCurrentVersion, createIdea } = await import("../src/lib/services/ideas");
  const { addDebateTurn, startDebate } = await import("../src/lib/services/debates");
  const { createDemo, createPlan } = await import("../src/lib/services/plans");
  const { advanceJob, createJob, isTerminal } = await import("../src/lib/research/jobs");
  const { EXAMPLE_TABLES } = await import("../src/lib/services/examples");

  if (aiProvider() !== "anthropic") throw new Error("Capture needs ANTHROPIC_API_KEY so the examples show real agent output.");
  const model = `${aiModel()}${aiSpeed() === "fast" ? " (fast mode)" : ""}`;
  const db = await getDb();
  const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

  async function runJob(ws: string, jobId: string, label: string) {
    for (let i = 0; i < 200; i++) {
      const job = await advanceJob(ws, jobId);
      if (!job) throw new Error(`${label}: job vanished`);
      if (isTerminal(job.status)) {
        log(`  ${label}: ${job.status}${job.error ? ` (${job.error})` : ""}`);
        return job;
      }
    }
    throw new Error(`${label}: did not finish`);
  }

  const outFile = path.join(process.cwd(), "src", "seed", "examples.json");
  const previous = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : { examples: [] };
  const captured = [];

  for (const spec of EXAMPLES) {
    if (only.length && !only.includes(spec.key)) {
      const kept = previous.examples.find((e: { key: string }) => e.key === spec.key);
      if (kept) captured.push(kept);
      continue;
    }
    log(`▶ ${spec.key}`);
    const ws = `ws_${crypto.randomBytes(16).toString("hex")}`;
    await db.insert(schema.workspaces).values({ id: ws });

    const { hackathonId, jobId } = await startHackathonResearch(ws, { urls: spec.urls });
    await runJob(ws, jobId, "event research (fetch + Atlas)");
    const [h] = await db.select().from(schema.hackathons).where(eq(schema.hackathons.id, hackathonId));
    log(`  hackathon: ${h.name} · deadline ${h.deadlineAt?.toISOString() ?? "not verified"}`);

    const { ideaId } = await createIdea(ws, { hackathonId, pitch: spec.pitch, origin: "sample" });
    await assessCurrentVersion(ws, ideaId, { reason: "Initial assessment" });
    const [idea] = await db.select().from(schema.projectIdeas).where(eq(schema.projectIdeas.id, ideaId));
    log(`  idea: ${idea.name} (Prism + Verdict)`);

    const research = await createJob({ workspaceId: ws, jobType: "idea_research", ideaId, hackathonId });
    await runJob(ws, research.id, "competitor research (Scout)");

    const { id: sessionId } = await startDebate(ws, { ideaId, mode: "critical", language: spec.pitchLanguage === "hinglish" ? "hinglish" : "en" });
    for (const text of spec.answers) await addDebateTurn(ws, sessionId, { text });
    log(`  Judge's Room: ${spec.answers.length} answers`);

    const planId = await createPlan(ws, ideaId);
    await createDemo(ws, ideaId, {});
    log("  build plan + demo script (Forge + Sprint)");

    const rows: Record<string, Record<string, unknown>[]> = {};
    for (const [name, table] of Object.entries(EXAMPLE_TABLES)) {
      const all = (await db.select().from(table as typeof schema.hackathons).where(eq((table as typeof schema.hackathons).workspaceId, ws))) as Record<string, unknown>[];
      // Finished jobs keep their steps and coverage; intermediate step state is not needed.
      rows[name] = name === "research_jobs" ? all.map((r) => ({ ...r, state: {}, lockedUntil: null })) : all;
    }
    captured.push({
      key: spec.key,
      hackathonName: h.name,
      platform: spec.platform,
      url: spec.urls[0],
      ideaName: idea.name,
      pitchLanguage: spec.pitchLanguage === "hinglish" ? "Hinglish" : "English",
      blurb: spec.blurb,
      capturedAt: new Date().toISOString(),
      model,
      hackathonId,
      ideaId,
      sessionId,
      planId,
      workspaceId: ws,
      rows,
    });
  }

  const fixture = { generatedAt: new Date().toISOString(), generator: "scripts/capture-examples.ts", disclosure: DISCLOSURE, examples: captured };
  fs.writeFileSync(outFile, JSON.stringify(fixture));
  log(`Wrote ${outFile} (${(fs.statSync(outFile).size / 1024).toFixed(0)} KB, ${captured.length} examples)`);
  try {
    fs.rmSync(dbDir, { recursive: true, force: true });
  } catch {
    log(`(left the throwaway database at ${dbDir})`);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
