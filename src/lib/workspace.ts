import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { workspaces } from "@/lib/db/schema";

export const WORKSPACE_COOKIE = "rr_ws";
const VALID = /^ws_[a-f0-9]{32}$/;

export class NoWorkspaceError extends Error {
  constructor() {
    super("No workspace session. Reload the page to start a new anonymous workspace.");
    this.name = "NoWorkspaceError";
  }
}

export async function currentWorkspaceId(): Promise<string> {
  const store = await cookies();
  const id = store.get(WORKSPACE_COOKIE)?.value;
  if (!id || !VALID.test(id)) throw new NoWorkspaceError();
  return id;
}

/** Resolve (and lazily create) the caller's workspace row. */
export async function requireWorkspace() {
  const id = await currentWorkspaceId();
  const db = await getDb();
  const rows = await db.select().from(workspaces).where(eq(workspaces.id, id));
  if (rows[0]) {
    if (Date.now() - rows[0].lastSeenAt.getTime() > 10 * 60_000) {
      await db.update(workspaces).set({ lastSeenAt: new Date() }).where(eq(workspaces.id, id));
    }
    return rows[0];
  }
  const inserted = await db.insert(workspaces).values({ id }).onConflictDoNothing().returning();
  return inserted[0] ?? (await db.select().from(workspaces).where(eq(workspaces.id, id)))[0];
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim();
}
