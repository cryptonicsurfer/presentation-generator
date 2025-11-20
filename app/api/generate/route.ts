import { NextRequest } from 'next/server';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { GeminiAgent } from '@/lib/agents/gemini-agent';
import { createDataAccessMcpServer } from '@/lib/mcp';
import { generateSystemPrompt } from '@/lib/presentation/skills-loader';
import { generateGeminiSystemPrompt } from '@/lib/presentation/gemini-skills-loader';
import { generatePresentationHTML, generateTitleSlide, generateThankYouSlide } from '@/lib/presentation/template';
import { calculateCost } from '@/lib/pricing';
import { getDefaultModel } from '@/lib/config/models';
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
        const { prompt: userPrompt, model = getDefaultModel(), thinkingLevel } = body;

        if (!userPrompt) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: 'Prompt is required' })}\n\n`));
          controller.close();
          return;
        }

        // Determine provider based on model ID
        const provider = model.startsWith('claude-') ? 'claude' :
                        model.startsWith('gemini-') ? 'gemini' : null;

        if (!provider) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            message: `Unknown model: ${model}. Use a valid Claude or Gemini model ID.`
          })}\n\n`));
          controller.close();
          return;
        }

        // Route to appropriate backend with specific model
        if (provider === 'claude') {
          await generateWithClaude(controller, encoder, userPrompt, model);
        } else if (provider === 'gemini') {
          await generateWithGemini(controller, encoder, userPrompt, model, thinkingLevel);
        }
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

/**
 * Generate presentation using Gemini
 */
async function generateWithGemini(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  userPrompt: string,
  model: string,
  thinkingLevel?: 'low' | 'high'
) {
  // Check for Google API key
  if (!process.env.GOOGLE_API_KEY) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
      type: 'error',
      message: 'GOOGLE_API_KEY not configured. Add it to .env.local'
    })}\n\n`));
    controller.close();
    return;
  }

  // Get model display name
  const modelDisplayName = model.replace('gemini-', 'Gemini ').replace('-', ' ');

  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
    type: 'status',
    message: `Initierar ${modelDisplayName}...`
  })}\n\n`));

  // Generate system prompt
  const systemPrompt = await generateGeminiSystemPrompt(userPrompt);

  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
    type: 'status',
    message: 'Ansluter till Gemini med MCP tools...'
  })}\n\n`));

  // Create Gemini agent with specified model
  const agent = new GeminiAgent({
    apiKey: process.env.GOOGLE_API_KEY,
    model: model,
    systemInstruction: systemPrompt,
    maxTurns: 25, // Balanced: enough for complex prompts, not too many to cause issues
    thinkingLevel: thinkingLevel, // Enable thinking mode for Gemini 3 Pro Preview
  });

  // Tool name to user-friendly message mapping
  const toolMessages: Record<string, string> = {
    'query_fbg_analytics': 'Hämtar finansiell data från databas...',
    'search_directus_companies': 'Söker efter företag i CRM-systemet...',
    'analyze_meetings': 'Analyserar möten från CRM...',
    'get_directus_contacts': 'Hämtar kontaktpersoner från CRM...',
  };

  // Run Gemini agent with callbacks for progress updates
  const { result, toolCallsLog, usage } = await agent.run(userPrompt, (message) => {
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

  // Log what Gemini returned for debugging
  console.log('[Gemini Response] First 1000 chars:', result.substring(0, 1000));
  console.log('[Gemini Response] Last 500 chars:', result.substring(Math.max(0, result.length - 500)));
  console.log('[Gemini Response] Total length:', result.length);

  // Parse Gemini's JSON response
  let presentationData;
  let presentationTitle = userPrompt;
  let sections: string[] = [];

  try {
    // Try to parse JSON from Gemini's response
    // First try: Match ```json code blocks
    let jsonMatch = result.match(/```json\s*([\s\S]*?)\s*```/);

    if (!jsonMatch) {
      // Second try: Find JSON object containing "sections"
      jsonMatch = result.match(/\{[\s\S]*?"sections"[\s\S]*?\}/);
    }

    if (jsonMatch) {
      let jsonStr = jsonMatch[1] || jsonMatch[0];

      // Try to parse - if it fails, we'll catch it below
      try {
        presentationData = JSON.parse(jsonStr);
      } catch (parseError) {
        // JSON parse failed - try cleaning approach as fallback
        console.log('Initial JSON parse failed, trying to extract and fix...', parseError);

        // Try to find just the object part more carefully
        const objMatch = jsonStr.match(/(\{[\s\S]*\})/);
        if (objMatch) {
          presentationData = JSON.parse(objMatch[1]);
        } else {
          throw parseError; // Re-throw if we can't fix it
        }
      }

      presentationTitle = presentationData.title || userPrompt;

      // Extract and validate sections - handle both string format and object format
      const validSections = (presentationData.sections || [])
        .map((section: any, index: number) => {
          // If section is already a string, use it
          if (typeof section === 'string') {
            return section;
          }
          // If section is an object with 'slide' property, extract it
          if (typeof section === 'object' && section.slide && typeof section.slide === 'string') {
            console.log(`[Generate] Section ${index} is object with slide property, extracting...`);
            return section.slide;
          }
          // Invalid format
          console.error(`[Generate] Section ${index} has invalid format! Type: ${typeof section}`, section);
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
        message: `Skapade ${validSections.length} slides från Gemini!`
      })}\n\n`));
    } else {
      // No JSON pattern found
      console.log('No JSON pattern found in Gemini response');
      console.log('Response starts with:', result.substring(0, 200));

      sections = [
        generateTitleSlide(userPrompt),
        `<section class="slide bg-white items-center justify-center px-16">
          <img src="https://kommun.falkenberg.se/document/om-kommunen/grafisk-profil/kommunens-logotyper/liggande-logotyper-foer-tryck/1609-falkenbergskommun-logo-svart-ligg"
               alt="Falkenbergs kommun" class="slide-logo">
          <div class="max-w-6xl w-full">
            <h2 class="text-5xl font-bold text-gray-900 mb-8">Ingen JSON hittades</h2>
            <p class="text-lg text-gray-700 mb-4">Gemini returnerade inte förväntad JSON-format.</p>
            <div class="text-sm text-gray-600 mt-4 p-4 bg-gray-50 rounded overflow-auto max-h-96">
              <pre>${result.substring(0, 2000)}</pre>
            </div>
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
    console.error('Error details:', (error as Error).message);
    console.error('Error stack:', (error as Error).stack);

    // Error fallback with more details
    sections = [
      generateTitleSlide(userPrompt),
      `<section class="slide bg-white items-center justify-center px-16">
        <img src="https://kommun.falkenberg.se/document/om-kommunen/grafisk-profil/kommunens-logotyper/liggande-logotyper-foer-tryck/1609-falkenbergskommun-logo-svart-ligg"
             alt="Falkenbergs kommun" class="slide-logo">
        <div class="max-w-6xl w-full">
          <h2 class="text-5xl font-bold text-gray-900 mb-8">Fel vid parsning</h2>
          <p class="text-lg text-gray-700 mb-4">Gemini svarade, men formatet kunde inte tolkas.</p>
          <p class="text-sm text-red-600 mb-4">Fel: ${(error as Error).message}</p>
          <div class="text-sm text-gray-600 mt-4 p-4 bg-gray-50 rounded overflow-auto max-h-96">
            <pre>${result.substring(0, 1000)}</pre>
          </div>
        </div>
      </section>`,
      generateThankYouSlide(),
    ];
  }

  // Generate final HTML
  const presentationHTML = generatePresentationHTML(presentationTitle, sections);

  // Save tool calls log
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFileName = `gemini-tool-calls-${timestamp}.json`;
  const logFilePath = join(process.cwd(), 'public', 'logs', logFileName);

  try {
    const logsDir = join(process.cwd(), 'public', 'logs');
    const { mkdirSync } = await import('fs');
    try {
      mkdirSync(logsDir, { recursive: true });
    } catch (e) {
      // Directory might already exist
    }

    writeFileSync(logFilePath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      backend: 'gemini',
      prompt: userPrompt,
      model: model,
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

  // Base64 encode HTML to safely send via SSE
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
    backend: 'gemini',
    model: model,
    usage: usage ? {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      cost: cost,
    } : undefined,
  })}\n\n`));

  controller.close();
}

/**
 * Generate presentation using Claude
 */
async function generateWithClaude(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  userPrompt: string,
  model: string
) {
  // Get model display name
  const modelDisplayName = model
    .replace('claude-sonnet-4-5-20250929', 'Claude Sonnet 4.5')
    .replace('claude-haiku-4-5-20251001', 'Claude Haiku 4.5')
    .replace('claude-opus-4-20250514', 'Claude Opus 4');

  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
    type: 'status',
    message: `Initierar ${modelDisplayName}...`
  })}\n\n`));

  // Create workspace for this generation session
  const workspace = await createWorkspace();
  console.log(`Created workspace: ${workspace.workspaceDir}`);

  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
    type: 'status',
    message: 'Skapar arbetsyta...'
  })}\n\n`));

  // Generate system prompt with skills AND workspace path
  const systemPrompt = await generateSystemPrompt(userPrompt, workspace.workspaceDir);

  // Create MCP server with database tools
  const mcpServer = createDataAccessMcpServer();

  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
    type: 'status',
    message: 'Ansluter till databaser...'
  })}\n\n`));

  // Run the query with Claude using specified model
  const queryInstance = query({
    prompt: userPrompt,
    options: {
      systemPrompt,
      cwd: workspace.workspaceDir,
      mcpServers: {
        'fbg-data-access': mcpServer,
      },
      model: model,
      maxTurns: 50,
      allowedTools: [
        'Write',
        'mcp__fbg-data-access__query_fbg_analytics',
        'mcp__fbg-data-access__search_directus_companies',
        'mcp__fbg-data-access__analyze_meetings',  // Upgraded: was count_directus_meetings
        'mcp__fbg-data-access__get_directus_contacts',
      ],
      settingSources: [],
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

  let messageCount = 0;
  let allMessages: any[] = [];
  let toolCallsLog: ToolCallLog[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for await (const message of queryInstance) {
    messageCount++;
    allMessages.push(message);

    // Capture token usage from result message
    if (message.type === 'result' && 'usage' in message) {
      const usage = (message as any).usage;
      if (usage) {
        totalInputTokens = usage.input_tokens || 0;
        totalOutputTokens = usage.output_tokens || 0;
      }
    }

    // Detect tool usage
    if (message.type === 'assistant' && message.message) {
      const content = Array.isArray(message.message) ? message.message :
                     (message.message.content ? message.message.content : []);

      for (const block of content) {
        if (block.type === 'tool_use' && block.name) {
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

    // Detect tool results
    if (message.type === 'user' && message.message) {
      const content = Array.isArray(message.message) ? message.message :
                     (message.message.content ? message.message.content : []);

      for (const block of content) {
        if (block.type === 'tool_result') {
          const toolUseId = (block as any).tool_use_id || 'unknown';
          const isError = (block as any).is_error || false;
          const resultContent = (block as any).content;

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

    // Periodic status updates
    if (messageCount % 5 === 0) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
        type: 'thinking',
        message: 'Claude analyserar data och skapar presentation...'
      })}\n\n`));
    }

    if (message.type === 'result') {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
        type: 'status',
        message: 'Läser HTML från arbetsyta...'
      })}\n\n`));

      let presentationHTML = await readHtml(workspace);
      let presentationTitle = userPrompt;

      if (presentationHTML) {
        const titleMatch = presentationHTML.match(/<title>(.*?)<\/title>/);
        if (titleMatch) {
          presentationTitle = titleMatch[1];
        }
      } else {
        // Fallback parsing
        let claudeResponse = '';
        if (message.subtype === 'success' && 'result' in message && typeof message.result === 'string') {
          claudeResponse = message.result;
        }

        for (const msg of allMessages) {
          if (msg.type === 'assistant') {
            if (msg.message && Array.isArray(msg.message)) {
              for (const block of msg.message) {
                if (block.type === 'text' && block.text) {
                  claudeResponse += block.text + '\n';
                }
              }
            }
          }
        }

        try {
          const jsonMatch = claudeResponse.match(/```json\s*([\s\S]*?)\s*```/) ||
                           claudeResponse.match(/\{[\s\S]*?"sections"[\s\S]*?\}/);

          if (jsonMatch) {
            const jsonStr = jsonMatch[1] || jsonMatch[0];
            const presentationData = JSON.parse(jsonStr);

            const sections = [
              generateTitleSlide(presentationData.title || userPrompt),
              ...(presentationData.sections || []),
              generateThankYouSlide(),
            ];

            presentationHTML = generatePresentationHTML(presentationData.title || userPrompt, sections);
            presentationTitle = presentationData.title || userPrompt;
          } else {
            const sections = [
              generateTitleSlide(userPrompt),
              `<section class="slide bg-white items-center justify-center px-16">
                <img src="https://kommun.falkenberg.se/document/om-kommunen/grafisk-profil/kommunens-logotyper/liggande-logotyper-foer-tryck/1609-falkenbergskommun-logo-svart-ligg"
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
          const sections = [
            generateTitleSlide(userPrompt),
            `<section class="slide bg-white items-center justify-center px-16">
              <img src="https://kommun.falkenberg.se/document/om-kommunen/grafisk-profil/kommunens-logotyper/liggande-logotyper-foer-tryck/1609-falkenbergskommun-logo-svart-ligg"
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

      const slideCount = (presentationHTML.match(/<section class="slide/g) || []).length;

      // Save tool calls log
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logFileName = `claude-tool-calls-${timestamp}.json`;
      const logFilePath = join(process.cwd(), 'public', 'logs', logFileName);

      try {
        const logsDir = join(process.cwd(), 'public', 'logs');
        const { mkdirSync } = await import('fs');
        try {
          mkdirSync(logsDir, { recursive: true });
        } catch (e) {
          // Directory might already exist
        }

        writeFileSync(logFilePath, JSON.stringify({
          generatedAt: new Date().toISOString(),
          backend: 'claude',
          prompt: userPrompt,
          model: model,
          toolCalls: toolCallsLog,
          summary: {
            totalToolCalls: toolCallsLog.filter(t => t.type === 'tool_use').length,
            successfulResults: toolCallsLog.filter(t => t.type === 'tool_result' && !t.error).length,
            errors: toolCallsLog.filter(t => t.type === 'tool_result' && t.error).length,
            toolsUsed: [...new Set(toolCallsLog.filter(t => t.type === 'tool_use').map(t => t.toolName))]
          }
        }, null, 2));

        console.log(`Claude tool calls log saved to: ${logFilePath}`);
      } catch (logError) {
        console.error('Failed to save Claude tool calls log:', logError);
      }

      // Save metadata
      await saveMetadata(workspace, {
        title: presentationTitle,
        slideCount,
        createdAt: new Date().toISOString(),
      });

      // Base64 encode HTML to safely send via SSE
      const htmlBase64 = Buffer.from(presentationHTML).toString('base64');

      // Calculate cost
      const cost = totalInputTokens > 0 || totalOutputTokens > 0
        ? calculateCost(model, totalInputTokens, totalOutputTokens)
        : 0;

      // Send completion
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
        type: 'complete',
        htmlBase64,
        title: presentationTitle,
        slideCount,
        sessionId: workspace.sessionId,
        workspaceUrl: `/workspaces/${workspace.sessionId}`,
        toolCallsLogUrl: `/logs/${logFileName}`,
        backend: 'claude',
        model: model,
        usage: (totalInputTokens > 0 || totalOutputTokens > 0) ? {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          totalTokens: totalInputTokens + totalOutputTokens,
          cost: cost,
        } : undefined,
      })}\n\n`));
    }
  }

  controller.close();
}
