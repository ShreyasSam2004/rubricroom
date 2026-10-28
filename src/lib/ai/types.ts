import type { z } from "zod";
import type { AgentName } from "@/lib/types";

export interface StructuredRequest<S extends z.ZodType> {
  agent: AgentName | "command";
  workspaceId?: string | null;
  system: string;
  prompt: string;
  schema: S;
  schemaName: string;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  /** "fast" runs the quicker, cheaper model (AI_FAST_MODEL) for short replies where waiting hurts most. */
  tier?: "main" | "fast";
  /** Streams the response: called with all of the JSON received so far, each time more arrives. */
  onText?: (soFar: string) => void;
}

export interface StructuredResult<T> {
  data: T;
  provider: "anthropic" | "openai";
  model: string;
  usage: { input: number; output: number };
}

export class AINotConfiguredError extends Error {
  constructor() {
    super("No AI provider is configured. Set ANTHROPIC_API_KEY (or OPENAI_API_KEY) to enable this agent.");
    this.name = "AINotConfiguredError";
  }
}

export class AIRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIRefusalError";
  }
}

export class AIOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIOutputError";
  }
}

export class RateLimitedError extends Error {
  constructor(
    message: string,
    public readonly retryAfterSec: number,
  ) {
    super(message);
    this.name = "RateLimitedError";
  }
}
