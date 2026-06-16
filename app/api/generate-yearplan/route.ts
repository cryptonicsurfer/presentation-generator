/**
 * API endpoint for generating Year Plan presentations
 *
 * Uses Gemini 3 Flash for fast, cost-effective generation
 * with specialized year plan database tools.
 *
 * Supports file uploads (PDF, DOCX) for additional context.
 */

import { NextRequest } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { yearPlanGeminiTools, executeYearPlanTool } from '@/lib/agents/yearplan-gemini-tools';
import { MistralAgent } from '@/lib/agents/mistral-agent';
import { providerForModel } from '@/lib/agents/agent-factory';
import { generateYearPlanSystemPrompt } from '@/lib/presentation/yearplan-skills-loader';
import { generatePresentationHTML, generateTitleSlide, generateThankYouSlide } from '@/lib/presentation/template';
import { calculateCost } from '@/lib/pricing';
import { parseFile, truncateContent, MAX_FILE_SIZE } from '@/lib/file-parser';
import { getDefaultGeminiModel } from '@/lib/config/models';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { jsonrepair } from 'jsonrepair';

export const runtime = 'nodejs';
export const maxDuration = 180; // 3 minutes to allow for file parsing

// Use first Gemini model from GEMINI_MODELS env (allows Google to rename without code changes)
const YEARPLAN_MODEL = getDefaultGeminiModel();

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Parse request - support both JSON and FormData
        let userPrompt: string;
        let uploadedFileContent: string | null = null;
        let uploadedFileName: string | null = null;
        let requestedModel: string | null = null;

        const contentType = req.headers.get('content-type') || '';

        if (contentType.includes('multipart/form-data')) {
          // FormData with potential file upload
          const formData = await req.formData();
          userPrompt = formData.get('prompt') as string;
          requestedModel = (formData.get('model') as string) || null;

          const file = formData.get('file') as File | null;
          if (file && file.size > 0) {
            // Validate file size
            if (file.size > MAX_FILE_SIZE) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'error',
                message: `Filen är för stor (${(file.size / 1024 / 1024).toFixed(1)} MB). Max storlek är 10 MB.`
              })}\n\n`));
              controller.close();
              return;
            }

            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'status',
              message: `Parsar ${file.name}...`
            })}\n\n`));

            try {
              const fileBuffer = Buffer.from(await file.arrayBuffer());
              const parsed = await parseFile(fileBuffer, file.name, file.type);

              uploadedFileContent = truncateContent(parsed.content, 50000);
              uploadedFileName = file.name;

              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'status',
                message: `Fil parsad: ${(parsed.content.length / 1000).toFixed(0)}k tecken på ${(parsed.parseTime / 1000).toFixed(1)}s`
              })}\n\n`));
            } catch (parseError) {
              console.error('File parse error:', parseError);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'warning',
                message: `Kunde inte parsa filen: ${parseError instanceof Error ? parseError.message : 'Okänt fel'}`
              })}\n\n`));
              // Continue without file content
            }
          }
        } else {
          // Regular JSON request
          const body = await req.json();
          userPrompt = body.prompt;
          requestedModel = body.model || null;
        }

        if (!userPrompt) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: 'Prompt saknas' })}\n\n`));
          controller.close();
          return;
        }

        // Resolve model + provider (request may pick Mistral; default stays Gemini)
        const model = requestedModel || YEARPLAN_MODEL;
        const provider = providerForModel(model);
        const requiredKey = provider === 'mistral' ? 'MISTRAL_API_KEY' : 'GOOGLE_API_KEY';
        if (!process.env[requiredKey]) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            message: `${requiredKey} not configured`
          })}\n\n`));
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'status',
          message: `Initierar ${provider === 'mistral' ? 'Mistral' : 'Gemini'}...`
        })}\n\n`));

        // Generate year plan specific system prompt (with optional file context)
        const systemPrompt = await generateYearPlanSystemPrompt(userPrompt, uploadedFileContent, uploadedFileName);

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'status',
          message: 'Ansluter till verksamhetsplaneringsdatabasen...'
        })}\n\n`));

        // Tool name to user-friendly message mapping
        const toolMessages: Record<string, string> = {
          'query_year_plan': 'Hämtar aktiviteter från verksamhetsplanen...',
          'get_year_plan_summary': 'Hämtar sammanfattande statistik...',
          'get_focus_areas': 'Hämtar fokusområden...',
        };

        // Shared accumulators (filled by whichever provider runs below)
        let toolCallsLog: any[] = [];
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let finalResult = '';

        if (provider === 'mistral') {
          // Mistral path: reuse the same year-plan toolset/executor via MistralAgent
          const agent = new MistralAgent({
            apiKey: process.env.MISTRAL_API_KEY!,
            model,
            systemInstruction: systemPrompt,
            maxTurns: 15,
            tools: yearPlanGeminiTools,
            executeTool: executeYearPlanTool,
          });
          const r = await agent.run(userPrompt, (m) => {
            if (m.type === 'tool' && m.tool) {
              const toolMessage = toolMessages[m.tool] || `Kör verktyg: ${m.tool}`;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'tool', message: toolMessage, tool: m.tool })}\n\n`));
            } else if (m.type === 'status' || m.type === 'thinking') {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: m.type, message: m.message })}\n\n`));
            } else if (m.type === 'error') {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: m.message })}\n\n`));
            }
          });
          finalResult = r.result;
          toolCallsLog = r.toolCallsLog;
          totalInputTokens = r.usage?.inputTokens || 0;
          totalOutputTokens = r.usage?.outputTokens || 0;
        } else {
        // Gemini path: inline agent loop with year plan tools
        const genAI = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
        const history: any[] = [];
        const maxTurns = 15;

        for (let turn = 0; turn < maxTurns; turn++) {
          const contents = turn === 0
            ? [{ role: 'user' as const, parts: [{ text: userPrompt }] }]
            : history;

          const response = await genAI.models.generateContent({
            model: model,
            contents,
            config: {
              systemInstruction: systemPrompt,
              tools: [{ functionDeclarations: yearPlanGeminiTools }],
            },
          });

          // Track tokens
          if (response.usageMetadata) {
            totalInputTokens += response.usageMetadata.promptTokenCount || 0;
            totalOutputTokens += response.usageMetadata.candidatesTokenCount || 0;
          }

          const candidates = response.candidates || [];
          if (candidates.length === 0) break;

          const parts = candidates[0].content?.parts || [];
          const functionCalls = parts.filter((part: any) => part.functionCall);

          if (functionCalls.length > 0) {
            // Execute function calls
            if (turn === 0) {
              history.push({ role: 'user', parts: [{ text: userPrompt }] });
            }
            history.push({ role: 'model', parts });

            const functionResponses: any[] = [];

            for (const part of functionCalls) {
              const fc = part.functionCall;
              if (!fc) continue;

              const toolMessage = toolMessages[fc.name || ''] || `Kör verktyg: ${fc.name}`;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'tool',
                message: toolMessage,
                tool: fc.name
              })}\n\n`));

              toolCallsLog.push({
                timestamp: new Date().toISOString(),
                type: 'tool_use',
                toolName: fc.name || 'unknown',
                input: fc.args || {},
              });

              try {
                const toolResult = await executeYearPlanTool(fc.name || '', fc.args || {});

                toolCallsLog.push({
                  timestamp: new Date().toISOString(),
                  type: 'tool_result',
                  toolName: fc.name || 'unknown',
                  output: toolResult,
                });

                functionResponses.push({
                  functionResponse: {
                    name: fc.name,
                    response: toolResult,
                  },
                });
              } catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                toolCallsLog.push({
                  timestamp: new Date().toISOString(),
                  type: 'tool_result',
                  toolName: fc.name || 'unknown',
                  error: errorMsg,
                });
                functionResponses.push({
                  functionResponse: {
                    name: fc.name,
                    response: { success: false, error: errorMsg },
                  },
                });
              }
            }

            history.push({ role: 'user', parts: functionResponses });

            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'thinking',
              message: 'Analyserar data...'
            })}\n\n`));
          } else {
            // No function calls - extract final text
            const textParts = parts.filter((part: any) => part.text);
            if (textParts.length > 0) {
              finalResult = textParts.map((part: any) => part.text).join('');
            }
            break;
          }
        }
        } // end Gemini path

        const result = finalResult;
        const usage = {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          totalTokens: totalInputTokens + totalOutputTokens,
        };

        // DEBUG: Save raw Gemini response to file
        const debugPath = join(process.cwd(), 'public', 'logs', `yearplan-raw-response-${Date.now()}.txt`);
        try {
          writeFileSync(debugPath, `=== GEMINI RAW RESPONSE ===\nLength: ${result.length}\n\n${result}`);
          console.log(`[DEBUG] Saved raw response to: ${debugPath}`);
        } catch (e) {
          console.error('[DEBUG] Failed to save raw response:', e);
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'status',
          message: 'Parsar presentationsdata...'
        })}\n\n`));

        // Parse Gemini's JSON response
        let presentationData;
        let presentationTitle = userPrompt;
        let sections: string[] = [];

        try {
          let jsonMatch = result.match(/```json\s*([\s\S]*?)\s*```/);
          if (!jsonMatch) {
            jsonMatch = result.match(/\{[\s\S]*?"sections"[\s\S]*?\}/);
          }

          if (jsonMatch) {
            let jsonStr = jsonMatch[1] || jsonMatch[0];

            try {
              presentationData = JSON.parse(jsonStr);
            } catch (parseError) {
              console.log('Initial JSON parse failed, using jsonrepair...');
              try {
                const repairedJson = jsonrepair(jsonStr);
                presentationData = JSON.parse(repairedJson);
              } catch (repairError) {
                const objMatch = jsonStr.match(/(\{[\s\S]*\})/);
                if (objMatch) {
                  const repairedObj = jsonrepair(objMatch[1]);
                  presentationData = JSON.parse(repairedObj);
                } else {
                  throw parseError;
                }
              }
            }

            presentationTitle = presentationData.title || userPrompt;

            const validSections = (presentationData.sections || [])
              .map((section: any) => {
                if (typeof section === 'string') return section;
                if (typeof section === 'object' && section.slide) return section.slide;
                return null;
              })
              .filter((section: any) => section !== null);

            sections = [
              generateTitleSlide(presentationTitle),
              ...validSections,
              generateThankYouSlide(),
            ];

            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'status',
              message: `Skapade ${validSections.length} slides!`
            })}\n\n`));
          } else {
            // Fallback
            sections = [
              generateTitleSlide(userPrompt),
              `<section class="slide bg-white flex items-center justify-center px-16">
                <div class="max-w-6xl w-full text-center">
                  <h2 class="text-5xl font-bold text-gray-900 mb-8">Ingen data hittades</h2>
                  <p class="text-lg text-gray-700">Gemini kunde inte generera presentationen. Försök igen med en tydligare prompt.</p>
                </div>
              </section>`,
              generateThankYouSlide(),
            ];
          }
        } catch (error) {
          console.error('Error parsing year plan presentation data:', error);
          sections = [
            generateTitleSlide(userPrompt),
            `<section class="slide bg-white flex items-center justify-center px-16">
              <div class="max-w-6xl w-full text-center">
                <h2 class="text-5xl font-bold text-gray-900 mb-8">Fel vid parsning</h2>
                <p class="text-lg text-gray-700">Ett fel uppstod vid tolkning av svaret.</p>
              </div>
            </section>`,
            generateThankYouSlide(),
          ];
        }

        // Generate final HTML
        const presentationHTML = generatePresentationHTML(presentationTitle, sections);

        // Save tool calls log
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logFileName = `yearplan-tool-calls-${timestamp}.json`;
        const logFilePath = join(process.cwd(), 'public', 'logs', logFileName);

        try {
          const logsDir = join(process.cwd(), 'public', 'logs');
          const { mkdirSync } = await import('fs');
          try { mkdirSync(logsDir, { recursive: true }); } catch (e) { }

          writeFileSync(logFilePath, JSON.stringify({
            generatedAt: new Date().toISOString(),
            backend: `${provider}-yearplan`,
            prompt: userPrompt,
            model: model,
            uploadedFile: uploadedFileName || null,
            toolCalls: toolCallsLog,
            summary: {
              totalToolCalls: toolCallsLog.filter(t => t.type === 'tool_use').length,
              successfulResults: toolCallsLog.filter(t => t.type === 'tool_result' && !t.error).length,
              errors: toolCallsLog.filter(t => t.type === 'tool_result' && t.error).length,
              toolsUsed: [...new Set(toolCallsLog.filter(t => t.type === 'tool_use').map(t => t.toolName))]
            }
          }, null, 2));
        } catch (logError) {
          console.error('Failed to save tool calls log:', logError);
        }

        // Base64 encode HTML
        const htmlBase64 = Buffer.from(presentationHTML).toString('base64');

        // Calculate cost
        const cost = usage ? calculateCost(model, usage.inputTokens, usage.outputTokens) : 0;

        // Send completion
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'complete',
          htmlBase64,
          title: presentationTitle,
          slideCount: sections.length,
          presentationData: {
            title: presentationTitle,
            sections: presentationData?.sections || []
          },
          toolCallsLogUrl: `/logs/${logFileName}`,
          backend: `${provider}-yearplan`,
          model: model,
          uploadedFile: uploadedFileName,
          usage: usage ? {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
            cost: cost,
          } : undefined,
        })}\n\n`));

        controller.close();
      } catch (error) {
        console.error('Error generating year plan presentation:', error);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'error',
          message: error instanceof Error ? error.message : 'Ett okänt fel inträffade'
        })}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
