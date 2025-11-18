import { GoogleGenAI } from '@google/genai';
import { geminiTools, executeGeminiTool } from './gemini-tools';
import { getDefaultGeminiModel } from '@/lib/config/models';

/**
 * Gemini Agent Wrapper
 * Handles conversation loop with tool calling and workspace management
 */

export interface GeminiAgentConfig {
  apiKey: string;
  model?: string;
  systemInstruction?: string;
  maxTurns?: number;
}

export interface GeminiAgentMessage {
  type: 'status' | 'tool' | 'thinking' | 'error' | 'complete';
  message?: string;
  tool?: string;
  data?: any;
}

export type GeminiAgentCallback = (message: GeminiAgentMessage) => void;

/**
 * Tool call logging type
 */
export type ToolCallLog = {
  timestamp: string;
  type: 'tool_use' | 'tool_result';
  toolName: string;
  input?: any;
  output?: any;
  error?: string;
};

export class GeminiAgent {
  private genAI: GoogleGenAI;
  private config: GeminiAgentConfig;
  private toolCallsLog: ToolCallLog[] = [];

  constructor(config: GeminiAgentConfig) {
    this.config = {
      model: getDefaultGeminiModel(),
      maxTurns: 50,
      ...config,
    };
    this.genAI = new GoogleGenAI({ apiKey: this.config.apiKey });
  }

  /**
   * Run Gemini agent with tool calling loop
   */
  async run(
    userPrompt: string,
    callback?: GeminiAgentCallback
  ): Promise<{
    result: string;
    toolCallsLog: ToolCallLog[];
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
  }> {
    callback?.({ type: 'status', message: 'Startar Gemini agent...' });

    console.log('[GeminiAgent] Starting with config:', {
      model: this.config.model,
      maxTurns: this.config.maxTurns,
      systemInstructionLength: this.config.systemInstruction?.length
    });

    let turnCount = 0;
    let finalResult = '';
    const history: any[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    while (turnCount < this.config.maxTurns!) {
      turnCount++;

      try {
        console.log(`[GeminiAgent] Turn ${turnCount}, history length: ${history.length}`);

        // Prune history if it gets too large (prevents 500 errors from Gemini API)
        const MAX_HISTORY_SIZE = 15;
        if (history.length > MAX_HISTORY_SIZE) {
          const itemsToRemove = history.length - MAX_HISTORY_SIZE;
          history.splice(1, itemsToRemove); // Keep first user message, remove oldest
          console.log(`[GeminiAgent] Pruned ${itemsToRemove} old messages, new length: ${history.length}`);
        }

        // Build contents for this request
        const contents = turnCount === 1
          ? [{ role: 'user' as const, parts: [{ text: userPrompt }] }]
          : history;

        // Call Gemini with current history
        const response = await this.genAI.models.generateContent({
          model: this.config.model!,
          contents,
          config: {
            systemInstruction: this.config.systemInstruction,
            tools: [{ functionDeclarations: geminiTools }],
          },
        });

        // Track token usage
        if (response.usageMetadata) {
          totalInputTokens += response.usageMetadata.promptTokenCount || 0;
          totalOutputTokens += response.usageMetadata.candidatesTokenCount || 0;
        }

        // Check for function calls in response
        const candidates = response.candidates || [];
        if (candidates.length === 0) {
          callback?.({ type: 'error', message: 'No response from Gemini' });
          break;
        }

        const candidate = candidates[0];
        const parts = candidate.content?.parts || [];

        // Check if there are function calls
        const functionCalls = parts.filter((part: any) => part.functionCall);

        if (functionCalls.length > 0) {
          // Execute function calls
          callback?.({ type: 'thinking', message: 'Gemini kör verktyg...' });

          console.log(`[GeminiAgent] Found ${functionCalls.length} function calls`);

          // On first turn, add user message to history first
          if (turnCount === 1) {
            history.push({
              role: 'user',
              parts: [{ text: userPrompt }],
            });
          }

          // Add model's function call to history
          history.push({
            role: 'model',
            parts: parts,
          });

          console.log(`[GeminiAgent] Added model response to history, new length: ${history.length}`);

          const functionResponses: any[] = [];

          for (const part of functionCalls) {
            const fc = part.functionCall;
            if (!fc) continue;

            callback?.({
              type: 'tool',
              message: `Kör verktyg: ${fc.name}`,
              tool: fc.name,
            });

            // Log tool call
            this.toolCallsLog.push({
              timestamp: new Date().toISOString(),
              type: 'tool_use',
              toolName: fc.name || 'unknown',
              input: fc.args || {},
            });

            try {
              const toolName = fc.name || 'unknown';
              const toolResult = await executeGeminiTool(toolName, fc.args || {});

              // Log tool result
              this.toolCallsLog.push({
                timestamp: new Date().toISOString(),
                type: 'tool_result',
                toolName,
                output: toolResult,
              });

              functionResponses.push({
                functionResponse: {
                  name: toolName,
                  response: toolResult,
                },
              });
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : 'Unknown error';
              const toolName = fc.name || 'unknown';

              // Log error
              this.toolCallsLog.push({
                timestamp: new Date().toISOString(),
                type: 'tool_result',
                toolName,
                error: errorMsg,
              });

              functionResponses.push({
                functionResponse: {
                  name: toolName,
                  response: {
                    success: false,
                    error: errorMsg,
                  },
                },
              });
            }
          }

          // Add function responses to history
          console.log(`[GeminiAgent] Adding ${functionResponses.length} function responses to history`);
          history.push({
            role: 'user',
            parts: functionResponses,
          });
          console.log(`[GeminiAgent] History after function responses: ${history.length} messages`);
          console.log(`[GeminiAgent] Last message role: ${history[history.length - 1].role}`);

          callback?.({ type: 'thinking', message: 'Gemini analyserar resultat...' });
        } else {
          // No function calls, extract final text response
          const textParts = parts.filter((part: any) => part.text);
          if (textParts.length > 0) {
            finalResult = textParts.map((part: any) => part.text).join('');
            console.log(`[GeminiAgent] Got final text response, length: ${finalResult.length}`);
          } else {
            console.log(`[GeminiAgent] No text in response. Parts:`, JSON.stringify(parts));
            console.log(`[GeminiAgent] Candidate finish reason:`, candidate.finishReason);

            // If no text but we have tool results in history, prompt Gemini one more time
            if (turnCount > 1) {
              console.log(`[GeminiAgent] No text response after tools - prompting for final output`);
              history.push({
                role: 'user',
                parts: [{ text: 'Please provide the final JSON output with the presentation structure as instructed.' }],
              });
              continue; // Go to next turn
            }
          }

          // Add to history for record keeping (optional, not used for next request)
          if (turnCount === 1) {
            history.push({
              role: 'user',
              parts: [{ text: userPrompt }],
            });
          }
          history.push({
            role: 'model',
            parts: parts,
          });

          callback?.({ type: 'status', message: 'Gemini klar!' });
          break;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[GeminiAgent] Error on turn ${turnCount}:`, error);
        console.error(`[GeminiAgent] History length at error: ${history.length}`);
        console.error(`[GeminiAgent] Last history item:`, JSON.stringify(history[history.length - 1], null, 2).substring(0, 500));

        callback?.({ type: 'error', message: errorMsg });
        throw error;
      }
    }

    if (turnCount >= this.config.maxTurns!) {
      console.log(`[GeminiAgent] Max turns reached without final response. Making final attempt...`);

      // If we reached max turns without a final result, make one last attempt
      if (!finalResult) {
        try {
          callback?.({ type: 'thinking', message: 'Max turns reached, requesting final output...' });

          // Add a strong prompt to generate final response
          history.push({
            role: 'user',
            parts: [{
              text: 'You have reached the maximum number of tool calls. Based on all the data you have collected, please NOW generate the final JSON presentation structure. Do not call any more tools.'
            }],
          });

          const response = await this.genAI.models.generateContent({
            model: this.config.model!,
            contents: history,
            config: {
              systemInstruction: this.config.systemInstruction,
              // Disable tools for final response
            },
          });

          // Track final token usage
          if (response.usageMetadata) {
            totalInputTokens += response.usageMetadata.promptTokenCount || 0;
            totalOutputTokens += response.usageMetadata.candidatesTokenCount || 0;
          }

          const candidates = response.candidates || [];
          if (candidates.length > 0) {
            const parts = candidates[0].content?.parts || [];
            const textParts = parts.filter((part: any) => part.text);
            if (textParts.length > 0) {
              finalResult = textParts.map((part: any) => part.text).join('');
              console.log(`[GeminiAgent] Got final response after maxTurns, length: ${finalResult.length}`);
            }
          }
        } catch (error) {
          console.error(`[GeminiAgent] Failed to get final response after maxTurns:`, error);
        }
      }

      if (!finalResult) {
        callback?.({ type: 'error', message: 'Max turns reached without generating presentation' });
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

  /**
   * Get tool calls log
   */
  getToolCallsLog(): ToolCallLog[] {
    return this.toolCallsLog;
  }
}
