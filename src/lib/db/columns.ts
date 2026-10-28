import { getTableColumns } from "drizzle-orm";
import { researchJobs, researchSources } from "./schema";

function omit<T extends Record<string, unknown>, K extends keyof T>(obj: T, ...keys: K[]): Omit<T, K> {
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}

/**
 * Column sets for list views. Pages never display a source's stored page text (tens of KB each) or
 * a job's internal step state, so loading them only slows queries and page rendering.
 */
export const sourceSummaryColumns = omit(getTableColumns(researchSources), "extractedText");
export const jobSummaryColumns = omit(getTableColumns(researchJobs), "state");
