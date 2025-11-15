import { NextRequest } from 'next/server';
import { GeminiAgent } from '@/lib/agents/gemini-agent';
import { generateGeminiSystemPrompt } from '@/lib/presentation/gemini-skills-loader';
import { generatePresentationHTML, generateTitleSlide, generateThankYouSlide } from '@/lib/presentation/template';
import { writeFileSync } from 'fs';
import { join } from 'path';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes for complex presentations

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const body = await req.json();
        const { prompt: userPrompt } = body;

        if (!userPrompt) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: 'Prompt is required' })}\n\n`));
          controller.close();
          return;
        }

        // Check for Google API key
        if (!process.env.GOOGLE_API_KEY) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            message: 'GOOGLE_API_KEY not configured. Add it to .env.local'
          })}\n\n`));
          controller.close();
          return;
        }

        // Send initial message
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'status',
          message: 'Initierar Gemini presentation generator...'
        })}\n\n`));

        // Generate system prompt
        const systemPrompt = await generateGeminiSystemPrompt(userPrompt);

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'status',
          message: 'Ansluter till Gemini med MCP tools...'
        })}\n\n`));

        // Create Gemini agent
        const agent = new GeminiAgent({
          apiKey: process.env.GOOGLE_API_KEY,
          model: 'gemini-2.5-flash',
          systemInstruction: systemPrompt,
          maxTurns: 50,
        });

        // Tool name to user-friendly message mapping
        const toolMessages: Record<string, string> = {
          'query_fbg_analytics': 'Hämtar finansiell data från databas...',
          'search_directus_companies': 'Söker efter företag i CRM-systemet...',
          'count_directus_meetings': 'Räknar antal möten med företaget...',
          'get_directus_contacts': 'Hämtar kontaktpersoner från CRM...',
        };

        // Run Gemini agent with callbacks for progress updates
        const { result, toolCallsLog } = await agent.run(userPrompt, (message) => {
          if (message.type === 'tool' && message.tool) {
            const toolMessage = toolMessages[message.tool] || `Kör verktyg: ${message.tool}`;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'tool',
              message: toolMessage,
              tool: message.tool
            })}\n\n`));
          } else if (message.type === 'status' || message.type === 'thinking') {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: message.type,
              message: message.message
            })}\n\n`));
          } else if (message.type === 'error') {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'error',
              message: message.message
            })}\n\n`));
          }
        });

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'status',
          message: 'Parsar Geminis svar...'
        })}\n\n`));

        // Parse Gemini's JSON response
        let presentationData;
        let presentationTitle = userPrompt;
        let sections: string[] = [];

        try {
          // Try to parse JSON from Gemini's response
          const jsonMatch = result.match(/```json\s*([\s\S]*?)\s*```/) ||
                           result.match(/\{[\s\S]*?"sections"[\s\S]*?\}/);

          if (jsonMatch) {
            const jsonStr = jsonMatch[1] || jsonMatch[0];
            presentationData = JSON.parse(jsonStr);

            presentationTitle = presentationData.title || userPrompt;
            sections = [
              generateTitleSlide(presentationTitle),
              ...(presentationData.sections || []),
              generateThankYouSlide(),
            ];

            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'status',
              message: `Skapade ${presentationData.sections?.length || 0} slides från Gemini!`
            })}\n\n`));
          } else {
            // Fallback: Create error slide
            console.log('No JSON found in Gemini response:', result.substring(0, 500));
            sections = [
              generateTitleSlide(userPrompt),
              `<section class="slide bg-white items-center justify-center px-16">
                <img src="/assets/Falkenbergskommun-logo_CMYK_POS_LIGG.png"
                     alt="Falkenbergs kommun" class="slide-logo">
                <div class="max-w-6xl w-full">
                  <h2 class="text-5xl font-bold text-gray-900 mb-8">Gemini's Svar</h2>
                  <div class="text-lg text-gray-700 whitespace-pre-wrap">${result.substring(0, 1000)}</div>
                </div>
              </section>`,
              generateThankYouSlide(),
            ];

            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'status',
              message: 'Ingen strukturerad data från Gemini, skapar fallback-presentation'
            })}\n\n`));
          }
        } catch (error) {
          console.error('Error parsing Gemini presentation data:', error);

          // Error fallback
          sections = [
            generateTitleSlide(userPrompt),
            `<section class="slide bg-white items-center justify-center px-16">
              <img src="/assets/Falkenbergskommun-logo_CMYK_POS_LIGG.png"
                   alt="Falkenbergs kommun" class="slide-logo">
              <div class="max-w-6xl w-full">
                <h2 class="text-5xl font-bold text-gray-900 mb-8">Fel vid parsning</h2>
                <p class="text-lg text-gray-700">Gemini svarade, men formatet kunde inte tolkas.</p>
                <pre class="text-sm text-gray-600 mt-4 overflow-auto">${result.substring(0, 500)}</pre>
              </div>
            </section>`,
            generateThankYouSlide(),
          ];
        }

        // Generate final HTML
        const presentationHTML = generatePresentationHTML(presentationTitle, sections);

        // Save tool calls log to public directory
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logFileName = `gemini-tool-calls-${timestamp}.json`;
        const logFilePath = join(process.cwd(), 'public', 'logs', logFileName);

        try {
          // Ensure logs directory exists
          const logsDir = join(process.cwd(), 'public', 'logs');
          const { mkdirSync } = await import('fs');
          try {
            mkdirSync(logsDir, { recursive: true });
          } catch (e) {
            // Directory might already exist
          }

          // Write log file
          writeFileSync(logFilePath, JSON.stringify({
            generatedAt: new Date().toISOString(),
            backend: 'gemini',
            prompt: userPrompt,
            model: 'gemini-2.5-flash',
            toolCalls: toolCallsLog,
            summary: {
              totalToolCalls: toolCallsLog.filter(t => t.type === 'tool_use').length,
              successfulResults: toolCallsLog.filter(t => t.type === 'tool_result' && !t.error).length,
              errors: toolCallsLog.filter(t => t.type === 'tool_result' && t.error).length,
              toolsUsed: [...new Set(toolCallsLog.filter(t => t.type === 'tool_use').map(t => t.toolName))]
            }
          }, null, 2));

          console.log(`Gemini tool calls log saved to: ${logFilePath}`);
        } catch (logError) {
          console.error('Failed to save Gemini tool calls log:', logError);
        }

        // Send completion with HTML
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'complete',
          html: presentationHTML,
          title: presentationTitle,
          slideCount: sections.length,
          presentationData: {
            title: presentationTitle,
            sections: presentationData?.sections || []
          },
          toolCallsLogUrl: `/logs/${logFileName}`,
          backend: 'gemini'
        })}\n\n`));

        controller.close();
      } catch (error) {
        console.error('Error generating presentation with Gemini:', error);
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
