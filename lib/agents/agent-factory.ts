import type { FunctionDeclaration } from '@google/genai';
import { GeminiAgent } from './gemini-agent';
import { MistralAgent } from './mistral-agent';

/**
 * Picks the tool-agent backend from a model id. Both GeminiAgent and
 * MistralAgent expose the same `run(userPrompt, callback, images)` →
 * { result, toolCallsLog, usage } interface, so callers can stay
 * provider-agnostic after construction.
 *
 * NOTE: `tools`/`executeTool` overrides only apply to the Mistral branch —
 * GeminiAgent uses the fixed default toolset (geminiTools). That's fine for the
 * routes using the factory (generate/tweak/tweak-slides), which all use the
 * default toolset on Gemini; the yearplan toolset only needs the override on
 * the Mistral side (the Gemini yearplan path is its own inline loop).
 */
export type ToolAgent = GeminiAgent | MistralAgent;

export function providerForModel(model: string): 'gemini' | 'mistral' {
  return model.startsWith('mistral-') ? 'mistral' : 'gemini';
}

export interface CreateAgentOptions {
  model: string;
  systemInstruction?: string;
  maxTurns?: number;
  thinkingLevel?: 'low' | 'high';
  tools?: FunctionDeclaration[];
  executeTool?: (toolName: string, args: any) => Promise<any>;
}

export function createToolAgent(opts: CreateAgentOptions): ToolAgent {
  if (providerForModel(opts.model) === 'mistral') {
    if (!process.env.MISTRAL_API_KEY) {
      throw new Error('MISTRAL_API_KEY not configured. Add it to .env.local');
    }
    return new MistralAgent({
      apiKey: process.env.MISTRAL_API_KEY,
      model: opts.model,
      systemInstruction: opts.systemInstruction,
      maxTurns: opts.maxTurns,
      tools: opts.tools,
      executeTool: opts.executeTool,
    });
  }

  if (!process.env.GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY not configured. Add it to .env.local');
  }
  return new GeminiAgent({
    apiKey: process.env.GOOGLE_API_KEY,
    model: opts.model,
    systemInstruction: opts.systemInstruction,
    maxTurns: opts.maxTurns,
    thinkingLevel: opts.thinkingLevel,
  });
}
