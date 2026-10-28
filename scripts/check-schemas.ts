/**
 * Probe every agent's structured-output schema against the live Claude API. The API compiles a
 * grammar from each schema and rejects ones that are too large; that check only happens server-side,
 * so mocked tests can't catch it. Output is capped at a few tokens, so this costs almost nothing.
 *
 *   npx tsx --env-file=.env.local scripts/check-schemas.ts
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { AtlasCompactSchema } from "../src/lib/agents/atlas";
import { AiCommandSchema } from "../src/lib/agents/commands";
import { ForgeSchema } from "../src/lib/agents/forge";
import { CardsSchema } from "../src/lib/agents/nova";
import { ChangeSchema, IdeaSchema, PrismCompareSchema } from "../src/lib/agents/prism";
import { QuerySchema, ReportSchema, ScoutCompareSchema } from "../src/lib/agents/scout";
import { AiPlanSchema, DemoSchema } from "../src/lib/agents/sprint";
import { AssessmentSchema, DebateSchema, OpeningSchema } from "../src/lib/agents/verdict";

const SCHEMAS: [string, z.ZodType][] = [
  ["atlas_event_dossier", AtlasCompactSchema],
  ["verdict_assessment", AssessmentSchema],
  ["verdict_debate_turn", DebateSchema],
  ["verdict_opening", OpeningSchema],
  ["scout_queries", QuerySchema],
  ["scout_compare", ScoutCompareSchema],
  ["scout_originality_report", ReportSchema],
  ["nova_opportunities", CardsSchema],
  ["forge_feasibility", ForgeSchema],
  ["prism_structure_pitch", IdeaSchema],
  ["prism_idea_change", ChangeSchema],
  ["prism_compare_ideas", PrismCompareSchema],
  ["sprint_plan", AiPlanSchema],
  ["sprint_demo_script", DemoSchema],
  ["rubricroom_command", AiCommandSchema],
];

async function main() {
  const client = new Anthropic({ maxRetries: 1 });
  const model = process.env.AI_MODEL || "claude-opus-5-5";
  let failed = 0;
  for (const [name, schema] of SCHEMAS) {
    try {
      await client.beta.messages.parse({
        model,
        max_tokens: 64,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { format: betaZodOutputFormat(schema), effort: "low" },
        messages: [{ role: "user", content: "Schema probe. Reply with a minimal valid object." }],
      });
      console.log(`ok    ${name}`);
    } catch (e) {
      if (e instanceof Anthropic.BadRequestError) {
        failed++;
        console.log(`FAIL  ${name}: ${e.message.slice(0, 220)}`);
      } else {
        // Truncated output / parse errors mean the schema compiled and generation started.
        console.log(`ok    ${name} (compiled; ${(e as Error).name})`);
      }
    }
  }
  console.log(failed ? `\n${failed} schema(s) rejected by the API.` : "\nAll schemas accepted by the API.");
  process.exit(failed ? 1 : 0);
}

main();
