// Starts the production server on a fresh embedded database for Playwright.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = path.join(os.tmpdir(), "rubricroom-e2e-pglite");
fs.rmSync(dir, { recursive: true, force: true });
const port = process.env.E2E_PORT ?? "3218";
const child = spawn(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "start", "-p", port], {
  stdio: "inherit",
  env: { ...process.env, PGLITE_DIR: dir, AI_PROVIDER: "none", SEARCH_PROVIDER: "none", RATE_LIMIT_IP_PER_DAY: "5000", NODE_ENV: "production" },
});
const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
