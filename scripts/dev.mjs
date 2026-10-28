// `npm run dev [-- -p 3217]`: starts `next dev`, then opens every page and API route once in the
// background (plus each page's scripts and styles) so Turbopack compiles them up front. Without this,
// the first visit to each page waits several seconds for its compile. Turbopack caches compiled
// output on disk, so later restarts warm up quickly.
import { spawn } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const portFlag = args.findIndex((a) => a === "-p" || a === "--port");
const port = portFlag >= 0 ? args[portFlag + 1] : (process.env.PORT ?? "3000");
const base = `http://localhost:${port}`;

const child = spawn(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "dev", ...args], { stdio: "inherit" });
const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));

// A fixed anonymous workspace for warm-up requests, so they don't create a new one each time.
const headers = { cookie: `rr_ws=ws_${"0".repeat(32)}` };
const PAGES = ["/", "/hackathons", "/hackathons/active", "/hackathons/warmup", "/ideas", "/ideas/warmup", "/judge", "/judge/warmup", "/compare", "/plan", "/plan/warmup", "/evidence", "/radar", "/sources", "/settings"];
// GET only: POST-only routes answer 405 without doing anything, but still get compiled.
const APIS = ["/api/health", "/api/ideas", "/api/ideas/warmup", "/api/hackathons", "/api/hackathons/warmup", "/api/jobs/warmup", "/api/debates", "/api/debates/warmup", "/api/plans", "/api/plans/warmup", "/api/command", "/api/compare", "/api/demo", "/api/examples", "/api/evidence", "/api/opportunities", "/api/profile", "/api/claims/warmup", "/api/sources/warmup", "/api/uploads", "/api/workspace"];

async function get(url) {
  try {
    const res = await fetch(url, { headers, redirect: "manual" });
    return res.headers.get("content-type")?.includes("text/html") ? await res.text() : (await res.arrayBuffer(), "");
  } catch {
    return "";
  }
}

async function warm() {
  for (let i = 0; i < 120; i++) {
    try {
      await fetch(`${base}/api/health`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const t0 = Date.now();
  const assets = new Set();
  for (const page of PAGES) {
    const html = await get(base + page);
    for (const m of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.(?:js|css))"/g)) assets.add(m[1]);
  }
  await Promise.all([...assets].map((a) => get(base + a)));
  for (const api of APIS) await get(base + api);
  console.log(`[warm-up] compiled ${PAGES.length} pages and ${APIS.length} API routes in ${((Date.now() - t0) / 1000).toFixed(1)}s, so every page opens fast now.`);
}

void warm();
