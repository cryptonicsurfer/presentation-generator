import { NextRequest } from 'next/server';
import { GeminiAgent } from '@/lib/agents/gemini-agent';
import { generateGeminiTweakPrompt } from '@/lib/presentation/gemini-skills-loader';
import { generatePresentationHTML, generateTitleSlide, generateThankYouSlide } from '@/lib/presentation/template';
import { writeFileSync } from 'fs';
import { join } from 'path';

export const runtime = 'nodejs';
export const maxDuration = 120; // 2 minutes for tweaks

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const body = await req.json();
        const { tweakPrompt, presentationData: originalPresentationData } = body;

        if (!tweakPrompt || !originalPresentationData) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: 'Tweak prompt and presentation data are required' })}\n\n`));
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

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'status', message: 'Analyserar dina ändringar med Gemini...' })}\n\n`));

        // Reconstruct current HTML from presentation data
        const currentTitle = originalPresentationData.title || '';
        const currentSections = originalPresentationData.sections || [];
        const fullSections = [
          generateTitleSlide(currentTitle),
          ...currentSections,
          generateThankYouSlide(),
        ];
        const currentHTML = generatePresentationHTML(currentTitle, fullSections);

        // Generate tweak-specific system prompt
        const systemPrompt = await generateGeminiTweakPrompt(tweakPrompt, currentHTML, currentTitle);

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'status', message: 'Ansluter till Gemini...' })}\n\n`));

        // Create Gemini agent
        const agent = new GeminiAgent({
          apiKey: process.env.GOOGLE_API_KEY,
          model: 'gemini-2.5-flash',
          systemInstruction: systemPrompt,
          maxTurns: 15, // Allow more turns if database queries needed
        });

        // Tool name to user-friendly message mapping
        const toolMessages: Record<string, string> = {
          'query_fbg_analytics': 'Hämtar uppdaterad data från databas...',
          'search_directus_companies': 'Söker efter företag i CRM...',
          'count_directus_meetings': 'Räknar antal möten...',
          'get_directus_contacts': 'Hämtar kontaktpersoner...',
        };

        // Run Gemini agent with callbacks
        const { result, toolCallsLog } = await agent.run(tweakPrompt, (message) => {
          if (message.type === 'tool' && message.tool) {
            const toolMessage = toolMessages[message.tool] || 'Hämtar data...';
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'tool',
              message: toolMessage,
              tool: message.tool
            })}\n\n`));
          } else if (message.type === 'thinking') {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'thinking',
              message: 'Gemini justerar presentationen...'
            })}\n\n`));
          }
        });

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'status', message: 'Behandlar ändringar...' })}\n\n`));

        // Parse Gemini's diff-edit response
        let updatedHTML = currentHTML;
        let changesSummary = 'Uppdaterat';

        try {
          // Try to parse JSON response with edits
          const jsonMatch = result.match(/```json\s*([\s\S]*?)\s*```/) ||
                           result.match(/\{[\s\S]*?"edits"[\s\S]*?\}/);

          if (jsonMatch) {
            const jsonStr = jsonMatch[1] || jsonMatch[0];
            const tweakData = JSON.parse(jsonStr);

            if (tweakData.edits && Array.isArray(tweakData.edits)) {
              // Apply all edits
              updatedHTML = currentHTML;
              for (const edit of tweakData.edits) {
                if (edit.old_string && edit.new_string) {
                  updatedHTML = updatedHTML.replace(edit.old_string, edit.new_string);
                }
              }

              changesSummary = tweakData.changesSummary || 'Ändringar tillämpade';

              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'status',
                message: `Ändringar: ${changesSummary}`
              })}\n\n`));
            }
          } else {
            // Fallback: no edits found, keep original
            console.log('No edits found in Gemini response:', result.substring(0, 500));
            changesSummary = 'Inga ändringar gjordes';
          }
        } catch (error) {
          console.error('Error parsing tweak response:', error);
          changesSummary = 'Fel vid tolkning av ändringar';
        }

        // Extract sections from updated HTML
        const sectionMatches = updatedHTML.matchAll(/<section class="slide[^>]*>([\s\S]*?)<\/section>/g);
        const allSections = Array.from(sectionMatches).map(match => match[0]);

        // Remove title and thank you slides (first and last)
        const updatedSections = allSections.slice(1, -1);

        // Extract title from updated HTML
        const titleMatch = updatedHTML.match(/<title>(.*?)<\/title>/);
        const updatedTitle = titleMatch ? titleMatch[1].replace(' - Falkenberg Kommun', '') : currentTitle;

        // Save tool calls log to public directory
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logFileName = `gemini-tweak-tool-calls-${timestamp}.json`;
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
            type: 'tweak',
            tweakPrompt,
            originalTitle: currentTitle,
            model: 'gemini-2.5-flash',
            toolCalls: toolCallsLog,
            summary: {
              totalToolCalls: toolCallsLog.filter(t => t.type === 'tool_use').length,
              successfulResults: toolCallsLog.filter(t => t.type === 'tool_result' && !t.error).length,
              errors: toolCallsLog.filter(t => t.type === 'tool_result' && t.error).length,
              toolsUsed: [...new Set(toolCallsLog.filter(t => t.type === 'tool_use').map(t => t.toolName))]
            }
          }, null, 2));

          console.log(`Gemini tweak tool calls log saved to: ${logFilePath}`);
        } catch (logError) {
          console.error('Failed to save Gemini tweak tool calls log:', logError);
        }

        // Base64 encode HTML to safely send via SSE
        const htmlBase64 = Buffer.from(updatedHTML).toString('base64');

        // Send completion
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'complete',
          htmlBase64,
          title: updatedTitle,
          slideCount: allSections.length,
          presentationData: {
            title: updatedTitle,
            sections: updatedSections
          },
          toolCallsLogUrl: `/logs/${logFileName}`,
          backend: 'gemini'
        })}\n\n`));

        controller.close();
      } catch (error) {
        console.error('Error tweaking presentation with Gemini:', error);
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
