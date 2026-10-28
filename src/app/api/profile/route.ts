import { z } from "zod";
import { apiHandler } from "@/lib/api";
import { getProfile, saveProfile } from "@/lib/services/profile";

export const GET = apiHandler(null, async ({ workspaceId }) => getProfile(workspaceId));

export const PUT = apiHandler(
  z.object({
    mode: z.enum(["solo", "team"]),
    teamSize: z.number().int().min(1).max(10),
    languages: z.array(z.string().max(40)).max(15),
    frameworks: z.array(z.string().max(40)).max(15),
    experienceLevel: z.enum(["beginner", "intermediate", "advanced"]),
    hoursPerDay: z.number().min(1).max(16),
    reusableProjects: z.string().max(2000),
    apiBudget: z.enum(["none", "low", "moderate", "high"]),
    hardware: z.string().max(300),
    interests: z.array(z.string().max(60)).max(15),
    personalProblems: z.string().max(3000),
    hasRealTester: z.boolean(),
    targetTrack: z.string().max(80),
    desiredComplexity: z.enum(["simple", "balanced", "ambitious"]),
    explanationLanguage: z.enum(["en", "hi", "hinglish"]),
  }),
  async ({ workspaceId, body }) => ({ profile: await saveProfile(workspaceId, body) }),
);
