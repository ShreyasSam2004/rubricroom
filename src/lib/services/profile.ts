import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { builderProfiles } from "@/lib/db/schema";
import { newId } from "@/lib/text";
import type { BuilderProfileData } from "@/lib/types";

export const DEFAULT_PROFILE: BuilderProfileData = {
  mode: "solo",
  teamSize: 1,
  languages: ["TypeScript"],
  frameworks: ["Next.js", "React"],
  experienceLevel: "intermediate",
  hoursPerDay: 6,
  reusableProjects: "",
  apiBudget: "low",
  hardware: "Laptop with microphone",
  interests: [],
  personalProblems: "",
  hasRealTester: false,
  targetTrack: "",
  desiredComplexity: "balanced",
  explanationLanguage: "en",
};

export async function getProfile(workspaceId: string): Promise<{ data: BuilderProfileData; isDefault: boolean }> {
  const db = await getDb();
  const [row] = await db.select().from(builderProfiles).where(eq(builderProfiles.workspaceId, workspaceId));
  return row ? { data: { ...DEFAULT_PROFILE, ...row.data }, isDefault: false } : { data: DEFAULT_PROFILE, isDefault: true };
}

export async function saveProfile(workspaceId: string, data: BuilderProfileData) {
  const db = await getDb();
  await db
    .insert(builderProfiles)
    .values({ id: newId("prof"), workspaceId, data })
    .onConflictDoUpdate({ target: builderProfiles.workspaceId, set: { data, updatedAt: new Date() } });
  return data;
}
