import { NextRequest } from 'next/server';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createDataAccessMcpServer } from '@/lib/mcp';
import { generateSystemPrompt } from '@/lib/presentation/skills-loader';
import { generatePresentationHTML, generateTitleSlide, generateThankYouSlide } from '@/lib/presentation/template';

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

        // Send initial message
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'status', message: 'Initierar presentation generator...' })}\n\n`));

        // Generate system prompt with skills
        const systemPrompt = await generateSystemPrompt(userPrompt);

        // Create MCP server with database tools
        const mcpServer = createDataAccessMcpServer();

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'status', message: 'Ansluter till databaser...' })}\n\n`));

        // Track sections
        let sections: string[] = [];
        
        // claude-sonnet-4-5-20250929 (more reliable with MCP tools)
        // claude-haiku-4-5-20251001 (faster but less reliable with tools)
        // Run the query with Claude
        const queryInstance = query({
          prompt: userPrompt,
          options: {
            systemPrompt,
            mcpServers: {
              'fbg-data-access': mcpServer,
            },
            model: 'claude-haiku-4-5-20251001',
            maxTurns: 50,
            // CRITICAL: Only allow our MCP tools, disable standard tools
            allowedTools: [
              'mcp__fbg-data-access__query_fbg_analytics',
              'mcp__fbg-data-access__search_directus_companies',
              'mcp__fbg-data-access__count_directus_meetings',
              'mcp__fbg-data-access__get_directus_contacts',
            ],
            // Don't load default tools from filesystem
            settingSources: [],
            // Bypass all permission prompts
            permissionMode: 'bypassPermissions',
          },
        });

        // Tool name to user-friendly message mapping
        const toolMessages: Record<string, string> = {
          'mcp__fbg-data-access__search_directus_companies': 'Söker efter företag i CRM-systemet...',
          'mcp__fbg-data-access__query_fbg_analytics': 'Hämtar finansiell data från databas...',
          'mcp__fbg-data-access__count_directus_meetings': 'Räknar antal möten med företaget...',
          'mcp__fbg-data-access__get_directus_contacts': 'Hämtar kontaktpersoner från CRM...',
        };

        // Stream messages from Claude
        let messageCount = 0;
        let allMessages: any[] = [];

        for await (const message of queryInstance) {
          messageCount++;
          allMessages.push(message);

          // Detect tool usage and send specific status updates
          if (message.type === 'assistant' && message.message) {
            const content = Array.isArray(message.message) ? message.message :
                           (message.message.content ? message.message.content : []);

            for (const block of content) {
              if (block.type === 'tool_use' && block.name) {
                const toolMessage = toolMessages[block.name] || 'Claude arbetar...';
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'tool',
                  message: toolMessage,
                  tool: block.name
                })}\n\n`));
              }
            }
          }

          // Send periodic status updates as fallback
          if (messageCount % 5 === 0) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'thinking',
              message: 'Claude analyserar data och skapar presentation...'
            })}\n\n`));
          }

          if (message.type === 'result') {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'status', message: 'Behandlar Claudes svar...' })}\n\n`));

            console.log('Result message:', JSON.stringify(message, null, 2));

            // Extract Claude's response from all messages
            let presentationData;
            let claudeResponse = '';

            // Extract result text directly from result object
            if (message.subtype === 'success' && 'result' in message && typeof message.result === 'string') {
              claudeResponse = message.result;
              console.log('Got result string directly:', claudeResponse.substring(0, 500));
            }

            // Collect all assistant messages
            for (const msg of allMessages) {
              console.log('Message type:', msg.type);

              if (msg.type === 'assistant') {
                console.log('Assistant message structure:', JSON.stringify(msg, null, 2).substring(0, 500));

                // Handle different possible structures
                if (msg.message && Array.isArray(msg.message)) {
                  for (const block of msg.message) {
                    if (block.type === 'text' && block.text) {
                      claudeResponse += block.text + '\n';
                    }
                  }
                } else if (msg.content && Array.isArray(msg.content)) {
                  for (const block of msg.content) {
                    if (block.type === 'text' && block.text) {
                      claudeResponse += block.text + '\n';
                    }
                  }
                } else if (typeof msg.message === 'string') {
                  claudeResponse += msg.message + '\n';
                } else if (typeof msg.content === 'string') {
                  claudeResponse += msg.content + '\n';
                }
              }
            }

            console.log('Claude response length:', claudeResponse.length);
            console.log('Claude response preview:', claudeResponse.substring(0, 1000));

            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'status',
              message: 'Parsar presentationsdata...'
            })}\n\n`));

            // Try to parse JSON from Claude's response
            try {
              // Look for JSON in various formats
              const jsonMatch = claudeResponse.match(/```json\s*([\s\S]*?)\s*```/) ||
                               claudeResponse.match(/\{[\s\S]*?"sections"[\s\S]*?\}/);

              if (jsonMatch) {
                const jsonStr = jsonMatch[1] || jsonMatch[0];
                presentationData = JSON.parse(jsonStr);

                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'status',
                  message: `Hittade ${presentationData.sections?.length || 0} slides från Claude!`
                })}\n\n`));
              } else {
                // Fallback: Create a slide with Claude's response
                console.log('No JSON found, using fallback. Response:', claudeResponse.substring(0, 500));

                presentationData = {
                  title: userPrompt,
                  sections: [
                    `<section class="slide bg-white items-center justify-center px-16">
                      <img src="/assets/Falkenbergskommun-logo_CMYK_POS_LIGG.png"
                           alt="Falkenbergs kommun" class="slide-logo">
                      <div class="max-w-6xl w-full">
                        <h2 class="text-5xl font-bold text-gray-900 mb-8">Claude's Svar</h2>
                        <div class="text-lg text-gray-700 whitespace-pre-wrap">${claudeResponse.substring(0, 1000)}</div>
                      </div>
                    </section>`
                  ]
                };

                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'status',
                  message: 'Ingen strukturerad data från Claude, skapar fallback-presentation'
                })}\n\n`));
              }
            } catch (error) {
              console.error('Error parsing presentation data:', error);

              // Error fallback
              presentationData = {
                title: userPrompt,
                sections: [
                  `<section class="slide bg-white items-center justify-center px-16">
                    <img src="/assets/Falkenbergskommun-logo_CMYK_POS_LIGG.png"
                         alt="Falkenbergs kommun" class="slide-logo">
                    <div class="max-w-6xl w-full">
                      <h2 class="text-5xl font-bold text-gray-900 mb-8">Fel vid parsning</h2>
                      <p class="text-lg text-gray-700">Claude svarade, men formatet kunde inte tolkas.</p>
                      <pre class="text-sm text-gray-600 mt-4 overflow-auto">${claudeResponse.substring(0, 500)}</pre>
                    </div>
                  </section>`
                ]
              };
            }

            // Add title and thank you slides
            sections = [
              generateTitleSlide(presentationData.title || userPrompt),
              ...(presentationData.sections || []),
              generateThankYouSlide(),
            ];

            // Generate final HTML
            const presentationHTML = generatePresentationHTML(presentationData.title || userPrompt, sections);

            // Send completion with HTML and presentation data
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'complete',
              html: presentationHTML,
              title: presentationData.title || userPrompt,
              slideCount: sections.length,
              presentationData: {
                title: presentationData.title || userPrompt,
                sections: presentationData.sections || []
              }
            })}\n\n`));
          }
        }

        controller.close();
      } catch (error) {
        console.error('Error generating presentation:', error);
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
