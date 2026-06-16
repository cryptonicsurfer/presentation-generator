import { Mistral } from '@mistralai/mistralai';
import type { FunctionDeclaration } from '@google/genai';
import { geminiTools, executeGeminiTool } from './gemini-tools';
import type {
  GeminiAgentMessage,
  GeminiAgentCallback,
  ToolCallLog,
} from './gemini-agent';

/**
 * Mistral Agent Wrapper
 *
 * Drop-in sibling to GeminiAgent: same constructor surface, same callback
 * message types, same `run()` return shape ({ result, toolCallsLog, usage }),
 * so the API routes can pick the agent by provider and call it identically.
 *
 * Reuses the existing tool *executors* (executeGeminiTool / executeYearPlanTool)
 * verbatim — they're provider-agnostic. Only the tool *declarations* need
 * translating from Gemini's FunctionDeclaration (uppercase `Type` enums) to
 * OpenAI/Mistral JSON-Schema tools. Runs through the official `@mistralai/mistralai`
 * SDK pointed at the default EU endpoint.
 *
 * Default/workhorse model: `mistral-medium-3.5` (reliable structured tool-calling
 * in real agent context). NOTE per the chat-app lesson: `mistral-large` emits
 * corrupted tool-calls-as-text under heavy tool load — prefer medium-3.5.
 */

export interface MistralAgentConfig {
  apiKey: string;
  model?: string;
  systemInstruction?: string;
  maxTurns?: number;
  /** Tool declarations (Gemini format). Defaults to the standard DB toolset. */
  tools?: FunctionDeclaration[];
  /** Executor matching `tools`. Defaults to executeGeminiTool. */
  executeTool?: (toolName: string, args: any) => Promise<any>;
}

// Re-export the shared message/log types so callers can import from either agent.
export type {
  GeminiAgentMessage as MistralAgentMessage,
  GeminiAgentCallback as MistralAgentCallback,
  ToolCallLog,
} from './gemini-agent';

/** Recursively lowercase every JSON-Schema `type` value (Gemini `Type.OBJECT`
 * → `"object"` etc.) so the schema is valid for the OpenAI/Mistral tool format. */
function toJsonSchema(node: any): any {
  if (Array.isArray(node)) return node.map(toJsonSchema);
  if (node && typeof node === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = k === 'type' && typeof v === 'string' ? v.toLowerCase() : toJsonSchema(v);
    }
    return out;
  }
  return node;
}

/** Gemini FunctionDeclaration[] → Mistral/OpenAI tools[]. */
function toMistralTools(decls: FunctionDeclaration[]): any[] {
  return decls.map((d) => ({
    type: 'function',
    function: {
      name: d.name,
      description: d.description,
      parameters: toJsonSchema(d.parameters ?? { type: 'object', properties: {} }),
    },
  }));
}

/** Mistral message content can be a string or an array of content chunks. */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c: any) => (typeof c === 'string' ? c : c?.type === 'text' ? c.text ?? '' : ''))
      .join('');
  }
  return '';
}

function safeParseArgs(args: unknown): any {
  if (args && typeof args === 'object') return args;
  if (typeof args === 'string') {
    try {
      return args ? JSON.parse(args) : {};
    } catch {
      return {};
    }
  }
  return {};
}

export class MistralAgent {
  private client: Mistral;
  private config: Required<Pick<MistralAgentConfig, 'model' | 'maxTurns'>> & MistralAgentConfig;
  private tools: FunctionDeclaration[];
  private executeTool: (toolName: string, args: any) => Promise<any>;
  private toolCallsLog: ToolCallLog[] = [];

  constructor(config: MistralAgentConfig) {
    this.config = {
      model: 'mistral-medium-3.5',
      maxTurns: 25,
      ...config,
    };
    this.tools = config.tools ?? geminiTools;
    this.executeTool = config.executeTool ?? executeGeminiTool;
    this.client = new Mistral({ apiKey: this.config.apiKey });
  }

  async run(
    userPrompt: string,
    callback?: GeminiAgentCallback,
    images?: Array<{ data: string; mimeType: string }>
  ): Promise<{
    result: string;
    toolCallsLog: ToolCallLog[];
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  }> {
    callback?.({ type: 'status', message: 'Startar Mistral agent...' });

    console.log('[MistralAgent] Starting with config:', {
      model: this.config.model,
      maxTurns: this.config.maxTurns,
      systemInstructionLength: this.config.systemInstruction?.length,
      toolCount: this.tools.length,
    });

    const mistralTools = toMistralTools(this.tools);

    // History. System prompt is byte-stable → Mistral implicitly caches the prefix.
    const messages: any[] = [];
    if (this.config.systemInstruction) {
      messages.push({ role: 'system', content: this.config.systemInstruction });
    }
    const userContent: any =
      images && images.length > 0
        ? [
            { type: 'text', text: userPrompt },
            ...images.map((img) => ({
              type: 'image_url',
              imageUrl: `data:${img.mimeType};base64,${img.data}`,
            })),
          ]
        : userPrompt;
    messages.push({ role: 'user', content: userContent });

    let turnCount = 0;
    let finalResult = '';
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    while (turnCount < this.config.maxTurns) {
      turnCount++;
      try {
        console.log(`[MistralAgent] Turn ${turnCount}, messages: ${messages.length}`);

        const response = await this.client.chat.complete({
          model: this.config.model,
          messages,
          tools: mistralTools,
          toolChoice: 'auto',
          maxTokens: 8192,
        });

        const usage = response.usage;
        if (usage) {
          totalInputTokens += usage.promptTokens || 0;
          totalOutputTokens += usage.completionTokens || 0;
        }

        const message = response.choices?.[0]?.message;
        const toolCalls = (message?.toolCalls || []) as any[];

        if (toolCalls.length > 0) {
          callback?.({ type: 'thinking', message: 'Mistral kör verktyg...' });

          // Echo the assistant's tool-call message back into history verbatim.
          messages.push({
            role: 'assistant',
            content: message?.content ?? '',
            toolCalls,
          });

          for (const tc of toolCalls) {
            const toolName = tc.function?.name || 'unknown';
            const args = safeParseArgs(tc.function?.arguments);

            callback?.({ type: 'tool', message: `Kör verktyg: ${toolName}`, tool: toolName });
            this.toolCallsLog.push({
              timestamp: new Date().toISOString(),
              type: 'tool_use',
              toolName,
              input: args,
            });

            let toolResult: any;
            try {
              toolResult = await this.executeTool(toolName, args);
              this.toolCallsLog.push({
                timestamp: new Date().toISOString(),
                type: 'tool_result',
                toolName,
                output: toolResult,
              });
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : 'Unknown error';
              toolResult = { success: false, error: errorMsg };
              this.toolCallsLog.push({
                timestamp: new Date().toISOString(),
                type: 'tool_result',
                toolName,
                error: errorMsg,
              });
            }

            messages.push({
              role: 'tool',
              toolCallId: tc.id,
              name: toolName,
              content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
            });
          }

          callback?.({ type: 'thinking', message: 'Mistral analyserar resultat...' });
        } else {
          finalResult = extractText(message?.content);
          console.log(`[MistralAgent] Final text response, length: ${finalResult.length}`);
          callback?.({ type: 'status', message: 'Mistral klar!' });
          break;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[MistralAgent] Error on turn ${turnCount}:`, error);
        callback?.({ type: 'error', message: errorMsg });
        throw error;
      }
    }

    // Max turns without a final text answer → force a final pass with tools off.
    if (turnCount >= this.config.maxTurns && !finalResult) {
      console.log('[MistralAgent] Max turns reached, requesting final output...');
      try {
        callback?.({ type: 'thinking', message: 'Max turns nådda, begär slutresultat...' });
        messages.push({
          role: 'user',
          content:
            'You have reached the maximum number of tool calls. Based on all the data you have collected, NOW generate the final JSON output as instructed. Do not call any more tools.',
        });
        const response = await this.client.chat.complete({
          model: this.config.model,
          messages,
          toolChoice: 'none',
          maxTokens: 8192,
        });
        const usage = response.usage;
        if (usage) {
          totalInputTokens += usage.promptTokens || 0;
          totalOutputTokens += usage.completionTokens || 0;
        }
        finalResult = extractText(response.choices?.[0]?.message?.content);
      } catch (error) {
        console.error('[MistralAgent] Failed to get final response after maxTurns:', error);
      }

      if (!finalResult) {
        callback?.({ type: 'error', message: 'Max turns reached without generating output' });
      }
    }

    return {
      result: finalResult,
      toolCallsLog: this.toolCallsLog,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
      },
    };
  }

  getToolCallsLog(): ToolCallLog[] {
    return this.toolCallsLog;
  }
}
