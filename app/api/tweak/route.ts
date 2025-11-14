import { NextRequest } from 'next/server';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createDataAccessMcpServer } from '@/lib/mcp';
import { generateTweakSystemPrompt } from '@/lib/presentation/skills-loader';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { getWorkspace, readHtml, readMetadata } from '@/lib/workspace';

export const runtime = 'nodejs';
export const maxDuration = 120; // 2 minutes for tweaks

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

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const body = await req.json();
        const { tweakPrompt, sessionId } = body;

        if (!tweakPrompt || !sessionId) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: 'Tweak prompt and session ID are required' })}\n\n`));
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'status', message: 'Analyserar dina ändringar...' })}\n\n`));

        // Get workspace from session ID
        const workspace = getWorkspace(sessionId);

        // Read metadata to get original title
        const metadata = await readMetadata(workspace);
        if (!metadata) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: 'Session not found or expired' })}\n\n`));
          controller.close();
          return;
        }

        // Verify HTML file exists
        const currentHtml = await readHtml(workspace);
        if (!currentHtml) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: 'Presentation file not found' })}\n\n`));
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'status', message: 'Presentation hittad, förbereder ändringar...' })}\n\n`));

        // Generate tweak-specific system prompt with file-based editing
        const systemPrompt = await generateTweakSystemPrompt(
          tweakPrompt,
          workspace.workspaceDir,
          metadata.title
        );

        // Create MCP server with database tools (same as generate)
        const mcpServer = createDataAccessMcpServer();

        // Run query WITH Read/Edit tools for file-based editing
        const queryInstance = query({
          prompt: `Please make the following changes to the presentation:\n\n${tweakPrompt}`,
          options: {
            systemPrompt,
            // Set working directory to workspace
            cwd: workspace.workspaceDir,
            mcpServers: {
              'fbg-data-access': mcpServer,
            },
            model: 'claude-sonnet-4-5-20250929',
            maxTurns: 20, // Allow more turns for Read + Edit cycles
            // CRITICAL: Enable Read/Edit tools for file-based diff-editing
            allowedTools: [
              'Read',  // Read current HTML file
              'Edit',  // Make precise string replacements
              'mcp__fbg-data-access__query_fbg_analytics',
              'mcp__fbg-data-access__search_directus_companies',
              'mcp__fbg-data-access__count_directus_meetings',
              'mcp__fbg-data-access__get_directus_contacts',
            ],
            settingSources: [],
            permissionMode: 'bypassPermissions',
          },
        });

        // Tool name to user-friendly message mapping
        const toolMessages: Record<string, string> = {
          'Read': 'Läser presentationsfil...',
          'Edit': 'Gör ändringar i presentationen...',
          'mcp__fbg-data-access__search_directus_companies': 'Söker efter företag i CRM...',
          'mcp__fbg-data-access__query_fbg_analytics': 'Hämtar uppdaterad data från databas...',
          'mcp__fbg-data-access__count_directus_meetings': 'Räknar antal möten...',
          'mcp__fbg-data-access__get_directus_contacts': 'Hämtar kontaktpersoner...',
        };

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

                const toolMessage = toolMessages[block.name] || 'Hämtar data...';
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

          if (messageCount % 3 === 0) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'thinking',
              message: 'Claude justerar presentationen...'
            })}\n\n`));
          }

          if (message.type === 'result') {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'status', message: 'Läser uppdaterad presentation...' })}\n\n`));

            // Read the updated HTML file (Claude edited it with Edit tool)
            const updatedHTML = await readHtml(workspace);

            if (!updatedHTML) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'error',
                message: 'Kunde inte läsa uppdaterad presentation'
              })}\n\n`));
              controller.close();
              return;
            }

            // Extract title from HTML
            let updatedTitle = metadata.title; // Default to original
            const titleMatch = updatedHTML.match(/<title>(.*?)<\/title>/);
            if (titleMatch) {
              updatedTitle = titleMatch[1];
            }

            // Count slides
            const slideCount = (updatedHTML.match(/<section class="slide/g) || []).length;

            // Extract changes summary from Claude's response (if provided)
            let changesSummary = 'Ändringar genomförda';
            for (const msg of allMessages) {
              if (msg.type === 'assistant') {
                let text = '';
                if (msg.message && Array.isArray(msg.message)) {
                  for (const block of msg.message) {
                    if (block.type === 'text' && block.text) {
                      text += block.text;
                    }
                  }
                }

                // Try to extract changesSummary from JSON if Claude provided it
                const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
                if (jsonMatch) {
                  try {
                    const data = JSON.parse(jsonMatch[1]);
                    if (data.changesSummary) {
                      changesSummary = data.changesSummary;
                    }
                  } catch (e) {
                    // Ignore parsing errors
                  }
                }
              }
            }

            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'status',
              message: `Ändringar: ${changesSummary}`
            })}\n\n`));

            const presentationHTML = updatedHTML;

            // Save tool calls log to public directory
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const logFileName = `tweak-tool-calls-${timestamp}.json`;
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
                type: 'tweak',
                tweakPrompt,
                sessionId,
                originalTitle: metadata.title,
                model: 'claude-sonnet-4-5-20250929',
                toolCalls: toolCallsLog,
                summary: {
                  totalToolCalls: toolCallsLog.filter(t => t.type === 'tool_use').length,
                  successfulResults: toolCallsLog.filter(t => t.type === 'tool_result' && !t.error).length,
                  errors: toolCallsLog.filter(t => t.type === 'tool_result' && t.error).length,
                  toolsUsed: [...new Set(toolCallsLog.filter(t => t.type === 'tool_use').map(t => t.toolName))]
                }
              }, null, 2));

              console.log(`Tweak tool calls log saved to: ${logFilePath}`);
            } catch (logError) {
              console.error('Failed to save tweak tool calls log:', logError);
            }

            // Base64 encode HTML to safely send via SSE
            const htmlBase64 = Buffer.from(presentationHTML).toString('base64');

            // Send completion
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'complete',
              htmlBase64,
              title: updatedTitle,
              slideCount,
              sessionId, // Return session ID for future tweaks
              toolCallsLogUrl: `/logs/${logFileName}`
            })}\n\n`));
          }
        }

        controller.close();
      } catch (error) {
        console.error('Error tweaking presentation:', error);
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
