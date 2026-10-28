/**
 * Apply database migrations explicitly (they also run automatically on first connection).
 *   DATABASE_URL=postgres://… npm run db:migrate
 */
import { getDb, getDbKind, resetDbForTests } from "../src/lib/db/client";

async function main() {
  await getDb();
  console.log(`Migrations applied (${await getDbKind()}).`);
  await resetDbForTests();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
