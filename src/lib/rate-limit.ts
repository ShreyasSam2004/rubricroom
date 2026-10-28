import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { usageCounters } from "@/lib/db/schema";

/**
 * Fixed-window counter stored in the database, so limits hold across serverless instances.
 * Returns whether this unit of work is allowed and, if not, when the window resets.
 */
export async function consume(scope: string, limit: number, windowSec: number, amount = 1) {
  const db = await getDb();
  const now = Date.now();
  const windowStart = Math.floor(now / (windowSec * 1000)) * windowSec * 1000;
  const key = `${scope}:${windowStart}`;
  const expiresAt = new Date(windowStart + windowSec * 1000);
  const rows = await db
    .insert(usageCounters)
    .values({ key, count: amount, expiresAt })
    .onConflictDoUpdate({ target: usageCounters.key, set: { count: sql`${usageCounters.count} + ${amount}` } })
    .returning({ count: usageCounters.count });
  const count = rows[0]?.count ?? amount;
  const retryAfterSec = Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000));
  // Opportunistic cleanup of expired windows.
  if (Math.random() < 0.02) {
    await db.delete(usageCounters).where(sql`${usageCounters.expiresAt} < now()`).catch(() => undefined);
  }
  return { allowed: count <= limit, count, limit, retryAfterSec };
}

export async function peek(scope: string, windowSec: number) {
  const db = await getDb();
  const windowStart = Math.floor(Date.now() / (windowSec * 1000)) * windowSec * 1000;
  const rows = await db
    .select({ count: usageCounters.count })
    .from(usageCounters)
    .where(sql`${usageCounters.key} = ${`${scope}:${windowStart}`}`);
  return rows[0]?.count ?? 0;
}
