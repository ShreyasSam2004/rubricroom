import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

type DbState = { db: Db; kind: "postgres" | "pglite"; close: () => Promise<void> };

const globalForDb = globalThis as unknown as { __rrDb?: Promise<DbState> };

function migrationsFolder() {
  return path.join(process.cwd(), "drizzle");
}

/**
 * The embedded database lives OUTSIDE the project folder by default. `next dev` watches the
 * project tree, and a database inside it turns every write into a file change → recompile →
 * full page reload. A configured PGLITE_DIR inside the project is redirected for the same reason.
 */
export function pgliteDir(): string {
  const fallback = path.join(os.homedir(), ".rubricroom", "pglite");
  const configured = process.env.PGLITE_DIR?.trim();
  if (!configured) return fallback;
  const dir = path.resolve(configured);
  const rel = path.relative(process.cwd(), dir);
  const insideProject = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  if (insideProject && process.env.NODE_ENV !== "production") {
    console.warn(`[rubricroom] PGLITE_DIR=${configured} is inside the project, which makes \`next dev\` reload on every write. Using ${fallback} instead.`);
    return fallback;
  }
  return dir;
}

async function connect(): Promise<DbState> {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const client = postgres(url, {
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      prepare: false, // compatible with transaction-mode poolers (Supabase, Neon)
      idle_timeout: 20,
    });
    const db = drizzle(client, { schema }) as unknown as Db;
    await runMigrations(() => migrate(db as never, { migrationsFolder: migrationsFolder() }));
    return { db, kind: "postgres", close: () => client.end() };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  let client: InstanceType<typeof PGlite>;
  if (process.env.PGLITE_MEMORY === "1") {
    client = new PGlite();
  } else {
    const dir = pgliteDir();
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    client = new PGlite(dir);
  }
  const db = drizzle(client, { schema }) as unknown as Db;
  await runMigrations(() => migrate(db as never, { migrationsFolder: migrationsFolder() }));
  return { db, kind: "pglite", close: () => client.close() };
}

/** Concurrent cold starts can race on the first migration; the loser retries once the winner has finished. */
async function runMigrations(run: () => Promise<void>) {
  try {
    await run();
  } catch (err) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      await run();
    } catch {
      throw err;
    }
  }
}

export async function getDb(): Promise<Db> {
  if (!globalForDb.__rrDb) {
    globalForDb.__rrDb = connect().catch((err) => {
      globalForDb.__rrDb = undefined;
      throw err;
    });
  }
  return (await globalForDb.__rrDb).db;
}

export async function getDbKind(): Promise<"postgres" | "pglite"> {
  await getDb();
  return (await globalForDb.__rrDb!).kind;
}

/** Test helper: drop the singleton so each test file can start from a fresh in-memory database. */
export async function resetDbForTests() {
  if (globalForDb.__rrDb) {
    const state = await globalForDb.__rrDb;
    await state.close().catch(() => undefined);
  }
  globalForDb.__rrDb = undefined;
}

export { schema };
