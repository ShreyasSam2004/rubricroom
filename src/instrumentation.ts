/**
 * Runs once when the server starts. Opening the database (and applying migrations) takes about a
 * second, so start it now instead of making the first visitor wait for it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getDb } = await import("@/lib/db/client");
  getDb().catch((err) => console.error("[rubricroom] database warm-up failed:", err));
}
