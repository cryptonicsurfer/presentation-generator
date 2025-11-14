import { NextRequest } from 'next/server';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createDataAccessMcpServer } from '@/lib/mcp';
import { generateSystemPrompt } from '@/lib/presentation/skills-loader';
import { generatePresentationHTML, generateTitleSlide, generateThankYouSlide } from '@/lib/presentation/template';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { createWorkspace, readHtml, saveMetadata } from '@/lib/workspace';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes for complex presentations

// Type for tool call logging
type ToolCallLog = {
  timestamp: string;
  type: 'tool_use' | 'tool_result';
  toolName: string;
  input?: any;
  output?: any;
  error?: string;
};

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

        // Create workspace for this generation session
        const workspace = await createWorkspace();
        console.log(`Created workspace: ${workspace.workspaceDir}`);

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'status', message: 'Skapar arbetsyta...' })}\n\n`));

        // Generate system prompt with skills AND workspace path
        const systemPrompt = await generateSystemPrompt(userPrompt, workspace.workspaceDir);

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
            // Set working directory to workspace
            cwd: workspace.workspaceDir,
            mcpServers: {
              'fbg-data-access': mcpServer,
            },
            model: 'claude-haiku-4-5-20251001',
            maxTurns: 50,
            // CRITICAL: Allow Write tool for file-based output + MCP tools
            allowedTools: [
              'Write', // Enable Write tool to save HTML to workspace
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
          'Write': 'Sparar presentation till arbetsyta...',
          'mcp__fbg-data-access__search_directus_companies': 'Söker efter företag i CRM-systemet...',
          'mcp__fbg-data-access__query_fbg_analytics': 'Hämtar finansiell data från databas...',
          'mcp__fbg-data-access__count_directus_meetings': 'Räknar antal möten med företaget...',
          'mcp__fbg-data-access__get_directus_contacts': 'Hämtar kontaktpersoner från CRM...',
        };

        // Stream messages from Claude
        let messageCount = 0;
        let allMessages: any[] = [];
        let toolCallsLog: ToolCallLog[] = [];

        for await (const message of queryInstance) {
          messageCount++;
          allMessages.push(message);

          // Detect tool usage and send specific status updates
          if (message.type === 'assistant' && message.message) {
            const content = Array.isArray(message.message) ? message.message :
                           (message.message.content ? message.message.content : []);

            for (const block of content) {
              if (block.type === 'tool_use' && block.name) {
                // Log tool call
                toolCallsLog.push({
                  timestamp: new Date().toISOString(),
                  type: 'tool_use',
                  toolName: block.name,
                  input: block.input || {}
                });

                const toolMessage = toolMessages[block.name] || 'Claude arbetar...';
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'tool',
                  message: toolMessage,
                  tool: block.name
                })}\n\n`));
              }
            }
          }

          // Detect tool results from user messages (containing tool_result blocks)
          if (message.type === 'user' && message.message) {
            const content = Array.isArray(message.message) ? message.message :
                           (message.message.content ? message.message.content : []);

            for (const block of content) {
              if (block.type === 'tool_result') {
                const toolUseId = (block as any).tool_use_id || 'unknown';
                const isError = (block as any).is_error || false;
                const resultContent = (block as any).content;

                // Try to extract text from content
                let textContent = resultContent;
                if (Array.isArray(resultContent)) {
                  textContent = resultContent.find((c: any) => c.type === 'text')?.text || resultContent;
                }

                toolCallsLog.push({
                  timestamp: new Date().toISOString(),
                  type: 'tool_result',
                  toolName: toolUseId,
                  output: isError ? undefined : textContent,
                  error: isError ? textContent : undefined
                });
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
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'status', message: 'Läser HTML från arbetsyta...' })}\n\n`));

            console.log('Result message:', JSON.stringify(message, null, 2));

            // Try to read HTML file from workspace (Claude should have written it)
            let presentationHTML = await readHtml(workspace);
            let presentationTitle = userPrompt; // Default to prompt

            if (presentationHTML) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'status',
                message: 'HTML-fil hittad i arbetsyta!'
              })}\n\n`));

              // Try to extract title from HTML
              const titleMatch = presentationHTML.match(/<title>(.*?)<\/title>/);
              if (titleMatch) {
                presentationTitle = titleMatch[1];
              }
            } else {
              // FALLBACK: If no file was written, try old method
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'status',
                message: 'Ingen fil funnen, försöker parse från text...'
              })}\n\n`));

              let claudeResponse = '';

              // Extract result text
              if (message.subtype === 'success' && 'result' in message && typeof message.result === 'string') {
                claudeResponse = message.result;
              }

              // Collect all assistant messages
              for (const msg of allMessages) {
                if (msg.type === 'assistant') {
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
                  }
                }
              }

              // Try to parse JSON
              try {
                const jsonMatch = claudeResponse.match(/```json\s*([\s\S]*?)\s*```/) ||
                                 claudeResponse.match(/\{[\s\S]*?"sections"[\s\S]*?\}/);

                if (jsonMatch) {
                  const jsonStr = jsonMatch[1] || jsonMatch[0];
                  const presentationData = JSON.parse(jsonStr);

                  sections = [
                    generateTitleSlide(presentationData.title || userPrompt),
                    ...(presentationData.sections || []),
                    generateThankYouSlide(),
                  ];

                  presentationHTML = generatePresentationHTML(presentationData.title || userPrompt, sections);
                  presentationTitle = presentationData.title || userPrompt;
                } else {
                  // Ultimate fallback
                  sections = [
                    generateTitleSlide(userPrompt),
                    `<section class="slide bg-white items-center justify-center px-16">
                      <img src="/assets/Falkenbergskommun-logo_CMYK_POS_LIGG.png"
                           alt="Falkenbergs kommun" class="slide-logo">
                      <div class="max-w-6xl w-full">
                        <h2 class="text-5xl font-bold text-gray-900 mb-8">Fel: Ingen HTML skapad</h2>
                        <p class="text-lg text-gray-700">Claude skapade ingen presentation.</p>
                      </div>
                    </section>`,
                    generateThankYouSlide(),
                  ];
                  presentationHTML = generatePresentationHTML(userPrompt, sections);
                }
              } catch (error) {
                console.error('Fallback parsing error:', error);
                sections = [
                  generateTitleSlide(userPrompt),
                  `<section class="slide bg-white items-center justify-center px-16">
                    <img src="/assets/Falkenbergskommun-logo_CMYK_POS_LIGG.png"
                         alt="Falkenbergs kommun" class="slide-logo">
                    <div class="max-w-6xl w-full">
                      <h2 class="text-5xl font-bold text-gray-900 mb-8">Fel vid skapande</h2>
                      <p class="text-lg text-gray-700">Ett fel inträffade.</p>
                    </div>
                  </section>`,
                  generateThankYouSlide(),
                ];
                presentationHTML = generatePresentationHTML(userPrompt, sections);
              }
            }

            // Count slides
            const slideCount = (presentationHTML.match(/<section class="slide/g) || []).length;

            // Save tool calls log to public directory
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const logFileName = `tool-calls-${timestamp}.json`;
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
                prompt: userPrompt,
                model: 'claude-haiku-4-5-20251001',
                toolCalls: toolCallsLog,
                summary: {
                  totalToolCalls: toolCallsLog.filter(t => t.type === 'tool_use').length,
                  successfulResults: toolCallsLog.filter(t => t.type === 'tool_result' && !t.error).length,
                  errors: toolCallsLog.filter(t => t.type === 'tool_result' && t.error).length,
                  toolsUsed: [...new Set(toolCallsLog.filter(t => t.type === 'tool_use').map(t => t.toolName))]
                }
              }, null, 2));

              console.log(`Tool calls log saved to: ${logFilePath}`);
            } catch (logError) {
              console.error('Failed to save tool calls log:', logError);
            }

            // Save metadata for tweak operations
            await saveMetadata(workspace, {
              title: presentationTitle,
              slideCount,
              createdAt: new Date().toISOString(),
            });

            // Send completion with HTML and session ID
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'complete',
              html: presentationHTML,
              title: presentationTitle,
              slideCount,
              sessionId: workspace.sessionId, // IMPORTANT: Include session ID for tweaks
              workspaceUrl: `/workspaces/${workspace.sessionId}`,
              toolCallsLogUrl: `/logs/${logFileName}`
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
