import { NextRequest } from 'next/server';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createDataAccessMcpServer } from '@/lib/mcp';
import { generatePresentationHTML, generateTitleSlide, generateThankYouSlide } from '@/lib/presentation/template';

export const runtime = 'nodejs';
export const maxDuration = 120; // 2 minutes for tweaks

function generateTweakSystemPrompt(originalData: { title: string; sections: string[] }, tweakPrompt: string): string {
  return `You are a presentation editing assistant. Your goal is to make MINIMAL changes to an existing presentation based on user feedback.

# Original Presentation

Title: ${originalData.title}

The presentation currently has ${originalData.sections.length} slides (excluding title and thank you slides).

# User's Requested Changes

"${tweakPrompt}"

# Available Tools (MCP)

You have access to the same MCP database tools as during initial generation:

1. **mcp__fbg-data-access__query_fbg_analytics** - Query company financials, employment stats
2. **mcp__fbg-data-access__search_directus_companies** - Search companies in CRM
3. **mcp__fbg-data-access__count_directus_meetings** - Count meetings with companies
4. **mcp__fbg-data-access__get_directus_contacts** - Get contact persons

Use these tools ONLY if the user explicitly asks for:
- Updated/corrected data (e.g., "use 2024 data instead of 2023")
- New data to add (e.g., "add a slide with latest financials")
- Different company information

# Your Task

Make ONLY the changes requested by the user. DO NOT:
- Regenerate the entire presentation unless explicitly asked
- Change slides that weren't mentioned
- Add unnecessary modifications

You should:
1. Understand what specific change the user wants
2. Modify ONLY the affected slides
3. Keep all other slides unchanged
4. Maintain the same visual style and structure

# Editing Approaches

Based on the user's request, choose ONE of these approaches:

## Approach 1: Modify Existing Slide(s)
If the user wants to change content, styling, or layout of existing slide(s):
- Identify which slide number(s) to modify
- Make ONLY the requested changes to those slides
- Return all sections with modified ones updated

## Approach 2: Add New Slide(s)
If the user wants to add new content:
- Create the new slide(s) following the existing template style
- Insert at the appropriate position
- Return all sections including the new one(s)

## Approach 3: Remove Slide(s)
If the user wants to remove content:
- Identify which slide(s) to remove
- Return all sections except the removed one(s)

## Approach 4: Reorder Slides
If the user wants to change the order:
- Rearrange the sections array
- Return all sections in the new order

# Important Guidelines

- Use the SAME Falkenberg color palette and styling
- Maintain the SAME slide structure (with slide-logo, etc.)
- Keep Swedish language for all text
- NO database queries needed - work with what's already in the presentation
- Be efficient - minimal token usage by changing only what's necessary

# Output Format

Return your response as a JSON object:

\`\`\`json
{
  "title": "Presentation Title (same or modified)",
  "sections": [
    "<section class=\\"slide\\">...</section>",
    "<section class=\\"slide\\">...</section>"
  ],
  "changesSummary": "Brief description of what was changed"
}
\`\`\`

# Original Presentation Sections

Here are the current slide HTML sections (for reference):

${originalData.sections.map((section, i) => `
## Slide ${i + 1}
\`\`\`html
${section.substring(0, 500)}... [truncated for brevity]
\`\`\`
`).join('\n')}

Now, please analyze the user's request and make the appropriate modifications. Be efficient and change only what's necessary!`;
}

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const body = await req.json();
        const { tweakPrompt, presentationData } = body;

        if (!tweakPrompt || !presentationData) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: 'Tweak prompt and presentation data are required' })}\n\n`));
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'status', message: 'Analyserar dina ändringar...' })}\n\n`));

        // Generate tweak-specific system prompt
        const systemPrompt = generateTweakSystemPrompt(presentationData, tweakPrompt);

        // Create MCP server with database tools (same as generate)
        const mcpServer = createDataAccessMcpServer();

        // Run query WITH MCP servers for data corrections/updates
        const queryInstance = query({
          prompt: `Please make the following changes to the presentation:\n\n${tweakPrompt}`,
          options: {
            systemPrompt,
            mcpServers: {
              'fbg-data-access': mcpServer,
            },
            model: 'claude-sonnet-4-5-20250929',
            maxTurns: 15, // Allow more turns if database queries needed
            // Allow MCP tools for data updates/corrections
            allowedTools: [
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
          'mcp__fbg-data-access__search_directus_companies': 'Söker efter företag i CRM...',
          'mcp__fbg-data-access__query_fbg_analytics': 'Hämtar uppdaterad data från databas...',
          'mcp__fbg-data-access__count_directus_meetings': 'Räknar antal möten...',
          'mcp__fbg-data-access__get_directus_contacts': 'Hämtar kontaktpersoner...',
        };

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
                const toolMessage = toolMessages[block.name] || 'Hämtar data...';
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'tool',
                  message: toolMessage,
                  tool: block.name
                })}\n\n`));
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
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'status', message: 'Behandlar ändringar...' })}\n\n`));

            let modifiedData;
            let claudeResponse = '';

            // Extract result
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
                } else if (typeof msg.message === 'string') {
                  claudeResponse += msg.message + '\n';
                } else if (typeof msg.content === 'string') {
                  claudeResponse += msg.content + '\n';
                }
              }
            }

            // Parse JSON response
            try {
              const jsonMatch = claudeResponse.match(/```json\s*([\s\S]*?)\s*```/) ||
                               claudeResponse.match(/\{[\s\S]*?"sections"[\s\S]*?\}/);

              if (jsonMatch) {
                const jsonStr = jsonMatch[1] || jsonMatch[0];
                modifiedData = JSON.parse(jsonStr);

                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'status',
                  message: `Ändringar: ${modifiedData.changesSummary || 'Uppdaterat'}`
                })}\n\n`));
              } else {
                // Fallback: Use original data if parsing fails
                modifiedData = {
                  ...presentationData,
                  sections: presentationData.sections,
                  changesSummary: 'Kunde inte tolka ändringar'
                };
              }
            } catch (error) {
              console.error('Error parsing tweak response:', error);
              modifiedData = {
                ...presentationData,
                changesSummary: 'Fel vid parsning'
              };
            }

            // Rebuild presentation with title and thank you slides
            const sections = [
              generateTitleSlide(modifiedData.title || presentationData.title),
              ...(modifiedData.sections || presentationData.sections),
              generateThankYouSlide(),
            ];

            const presentationHTML = generatePresentationHTML(
              modifiedData.title || presentationData.title,
              sections
            );

            // Base64 encode HTML to safely send via SSE
            const htmlBase64 = Buffer.from(presentationHTML).toString('base64');

            // Send completion
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'complete',
              htmlBase64,
              title: modifiedData.title || presentationData.title,
              slideCount: sections.length,
              presentationData: {
                title: modifiedData.title || presentationData.title,
                sections: modifiedData.sections || presentationData.sections
              }
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
