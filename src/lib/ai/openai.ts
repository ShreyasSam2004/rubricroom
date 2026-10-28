// Optional OpenAI adapter (Chat Completions + strict JSON schema), used only when AI_PROVIDER=openai
// or when OPENAI_API_KEY is the only key present.

import { z } from "zod";
import { aiModel, keys } from "@/lib/env";
import { AIOutputError, AIRefusalError, type StructuredRequest, type StructuredResult } from "./types";

type JsonSchema = Record<string, unknown>;

const REASONING = { low: "minimal", medium: "low", high: "medium" } as const;

/** OpenAI strict mode requires every object to list all properties as required and forbid extras. */
export function toStrictJsonSchema(schema: z.ZodType): JsonSchema {
  const raw = z.toJSONSchema(schema, { target: "draft-7" }) as JsonSchema;
  delete raw.$schema;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const obj = node as JsonSchema;
    if (obj.type === "object" && obj.properties && typeof obj.properties === "object") {
      obj.additionalProperties = false;
      obj.required = Object.keys(obj.properties as object);
    }
    for (const v of Object.values(obj)) visit(v);
  };
  visit(raw);
  return raw;
}

interface Completion {
  model?: string;
  content: string;
  refusal: string | null;
  finish?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface Chunk {
  model?: string;
  choices?: { delta?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

/** Read a streamed completion (server-sent events), reporting the content as it grows. */
async function readStream(res: Response, onText: (soFar: string) => void): Promise<Completion> {
  const out: Completion = { content: "", refusal: null };
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const line = (raw: string) => {
    const l = raw.trim();
    if (!l.startsWith("data:")) return;
    const data = l.slice(5).trim();
    if (!data || data === "[DONE]") return;
    const chunk = JSON.parse(data) as Chunk;
    out.model ??= chunk.model;
    if (chunk.usage) out.usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (choice?.delta?.refusal) out.refusal = (out.refusal ?? "") + choice.delta.refusal;
    if (choice?.finish_reason) out.finish = choice.finish_reason;
    if (choice?.delta?.content) {
      out.content += choice.delta.content;
      try {
        onText(out.content);
      } catch {
        /* a display callback must never break the call */
      }
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      line(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  if (buf) line(buf);
  return out;
}

export async function openaiStructured<S extends z.ZodType>(req: StructuredRequest<S>, model = aiModel()): Promise<StructuredResult<z.infer<S>>> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${keys.openai()}` },
    body: JSON.stringify({
      model,
      max_completion_tokens: req.maxTokens ?? 16_000,
      // GPT-5's reasoning levels run heavier than the agents' effort hints, so each maps one step
      // down (a "medium" Verdict call took ~45 s at reasoning "medium", far too slow for a reply).
      ...(/^(gpt-5|o\d)/i.test(model) ? { reasoning_effort: REASONING[req.effort ?? "medium"] } : {}),
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: req.schemaName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60), schema: toStrictJsonSchema(req.schema), strict: true },
      },
      ...(req.onText ? { stream: true, stream_options: { include_usage: true } } : {}),
    }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AIOutputError(`OpenAI request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  let completion: Completion;
  if (req.onText) completion = await readStream(res, req.onText);
  else {
    const json = (await res.json()) as {
      model?: string;
      choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = json.choices?.[0];
    completion = { model: json.model, content: choice?.message?.content ?? "", refusal: choice?.message?.refusal ?? null, finish: choice?.finish_reason, usage: json.usage };
  }
  if (completion.refusal) throw new AIRefusalError(completion.refusal);
  if (completion.finish === "length") throw new AIOutputError("The model ran out of output tokens before finishing.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(completion.content);
  } catch {
    throw new AIOutputError("The model response was not valid JSON.");
  }
  const result = req.schema.safeParse(parsed);
  if (!result.success) throw new AIOutputError("The model response did not match the expected structure.");
  return {
    data: result.data as z.infer<S>,
    provider: "openai",
    model: completion.model ?? model,
    usage: { input: completion.usage?.prompt_tokens ?? 0, output: completion.usage?.completion_tokens ?? 0 },
  };
}
