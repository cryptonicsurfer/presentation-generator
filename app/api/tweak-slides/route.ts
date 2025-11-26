import { NextRequest } from 'next/server';
import { extractSlides, replaceSlides, type Slide } from '@/lib/presentation/slide-parser';
import { GeminiAgent } from '@/lib/agents/gemini-agent';
import { geminiTools } from '@/lib/agents/gemini-tools';
import { logosToUrls, urlsToLogos } from '@/lib/presentation/logos';
import { captureMultipleSlideScreenshots } from '@/lib/utils/screenshot';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

/**
 * API endpoint for tweaking specific slides in a presentation
 * Uses selected slide IDs to make targeted modifications
 */
export async function POST(request: NextRequest) {
  console.log('[tweak-slides] ===== ENDPOINT HIT =====');
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        console.log('[tweak-slides] Parsing request body...');
        const body = await request.json();
        console.log('[tweak-slides] Body received:', {
          messagesCount: body.messages?.length,
          hasCurrentHtml: !!body.currentHtml,
          selectedSlideIdsCount: body.selectedSlideIds?.length,
          model: body.model,
        });
        const {
          messages,
          currentHtml,
          selectedSlideIds,
          model = 'gemini-2.5-flash'
        }: {
          messages: Message[];
          currentHtml: string;
          selectedSlideIds: string[];
          model?: string;
        } = body;

        // Validate inputs
        if (!messages || messages.length === 0) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            message: 'No messages provided'
          })}\n\n`));
          controller.close();
          return;
        }

        if (!currentHtml) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            message: 'No current HTML provided'
          })}\n\n`));
          controller.close();
          return;
        }

        if (!selectedSlideIds || selectedSlideIds.length === 0) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            message: 'No slides selected'
          })}\n\n`));
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'status',
          message: `Extraherar ${selectedSlideIds.length} valda slides...`
        })}\n\n`));

        // Extract all slides from current HTML
        console.log('[tweak-slides] Extracting slides from HTML...');
        const allSlides = extractSlides(currentHtml);
        console.log('[tweak-slides] Total slides extracted:', allSlides.length);

        // Filter to only selected slides
        const selectedSlides = allSlides.filter(slide =>
          selectedSlideIds.includes(slide.id)
        );
        console.log('[tweak-slides] Selected slides:', selectedSlides.map(s => `${s.id} (${s.title})`));

        if (selectedSlides.length === 0) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            message: 'Selected slides not found in current HTML'
          })}\n\n`));
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'status',
          message: `Förbereder AI-prompt för ${selectedSlides.length} slides...`
        })}\n\n`));

        // Capture screenshots of selected slides for visual context
        let screenshots: Array<{ data: string; mimeType: string }> | undefined;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'status',
            message: `Tar screenshots av ${selectedSlides.length} slide(s) för visuell kontext...`
          })}\n\n`));

          const screenshotMap = await captureMultipleSlideScreenshots(
            currentHtml,
            selectedSlideIds,
            { width: 1920, height: 1080, format: 'png' }
          );

          screenshots = Object.values(screenshotMap).map(base64 => ({
            data: base64,
            mimeType: 'image/png',
          }));

          console.log(`[tweak-slides] Captured ${screenshots.length} screenshots for visual context`);
        } catch (error) {
          console.error('[tweak-slides] Failed to capture screenshots:', error);
          // Continue without screenshots
        }

        // Create focused system prompt for slide editing
        const slidesList = selectedSlides
          .map(s => `- ${s.id}: ${s.title || 'Untitled'}`)
          .join('\n');

        // Convert logos to URLs to save ~100k tokens per slide
        const slidesHtml = selectedSlides
          .map(s => logosToUrls(s.html))
          .join('\n\n');

        const hasVisualContext = screenshots && screenshots.length > 0;
        const visualContextNote = hasVisualContext
          ? `\n\n**IMPORTANT: You have been provided with SCREENSHOTS of these slides as visual context. Use these images to see exactly what the slides look like, including colors, layouts, charts, and visual elements. Reference the screenshots when making visual changes.**\n`
          : '';

        const systemPrompt = `You are a presentation slide editor. The user wants to modify specific slides in their presentation.${visualContextNote}

**Selected Slides to Modify:**
${slidesList}

**Current HTML for these slides:**
\`\`\`html
${slidesHtml}
\`\`\`

**Your task:**
1. Understand the user's modification request
2. Update ONLY the selected slides according to their instructions
3. Maintain the same HTML structure and styling
4. Keep the Falkenberg color palette and design
5. Return the updated slides as complete <section> elements

**Important:**
- DO NOT change slides that weren't selected
- Keep all existing classes, IDs, and structure
- Preserve the {{LOGO_SVART}} and {{LOGO_VIT}} placeholders
- Maintain Swedish language
- Return complete <section>...</section> HTML for each modified slide

**Output format:**
Return a JSON array of updated slides:
\`\`\`json
[
  {
    "id": "slide-2",
    "html": "<section id=\\"slide-2\\" class=\\"slide\\">...updated content...</section>"
  },
  {
    "id": "slide-5",
    "html": "<section id=\\"slide-5\\" class=\\"slide\\">...updated content...</section>"
  }
]
\`\`\``;

        // Create Gemini agent
        console.log('[tweak-slides] Creating Gemini agent with model:', model);
        const agent = new GeminiAgent({
          apiKey: process.env.GOOGLE_API_KEY!,
          model,
          systemInstruction: systemPrompt,
          maxTurns: 10,
        });

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'status',
          message: 'Skickar till AI för modifiering...'
        })}\n\n`));

        // Convert messages to Gemini format
        const geminiMessages = messages.map(msg => ({
          role: msg.role,
          content: msg.content
        }));
        console.log('[tweak-slides] Running Gemini agent with', geminiMessages.length, 'messages...');

        // Run agent with screenshots for visual context
        const { result: responseText, toolCallsLog, usage } = await agent.run(
          geminiMessages[geminiMessages.length - 1].content,
          (update) => {
            if (update.type === 'tool') {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'tool',
                message: update.message
              })}\n\n`));
            } else if (update.type === 'thinking') {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'thinking',
                message: update.message
              })}\n\n`));
            }
          },
          screenshots // Pass screenshots for visual context
        );

        console.log('[tweak-slides] Agent finished. Response length:', responseText.length);
        console.log('[tweak-slides] First 200 chars:', responseText.substring(0, 200));

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'status',
          message: 'Parsar AI-svar...'
        })}\n\n`));

        // Parse JSON response
        let updatedSlidesData: Array<{ id: string; html: string }>;
        try {
          // Extract JSON from response (might be wrapped in markdown code blocks)
          const jsonMatch = responseText.match(/\[[\s\S]*\]/);
          if (!jsonMatch) {
            throw new Error('No JSON array found in response');
          }
          updatedSlidesData = JSON.parse(jsonMatch[0]);
        } catch (error) {
          console.error('Failed to parse AI response:', error);
          console.error('Response text:', responseText.substring(0, 500));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            message: 'AI returnerade ogiltigt format. Försök igen.'
          })}\n\n`));
          controller.close();
          return;
        }

        // Convert to Slide objects and restore base64 logos
        const updatedSlides: Slide[] = updatedSlidesData.map(slideData => {
          const originalSlide = selectedSlides.find(s => s.id === slideData.id);
          if (!originalSlide) {
            throw new Error(`Slide ${slideData.id} not found in selected slides`);
          }

          // Convert URLs back to base64 for standalone HTML
          const htmlWithBase64 = urlsToLogos(slideData.html);

          return {
            ...originalSlide,
            html: htmlWithBase64,
            // Extract new content from HTML
            content: htmlWithBase64.replace(/<section[^>]*>([\s\S]*)<\/section>/, '$1')
          };
        });

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'status',
          message: 'Sammanfogar uppdaterade slides...'
        })}\n\n`));

        // Merge updated slides back into full HTML
        const updatedHtml = replaceSlides(currentHtml, updatedSlides);

        // Base64 encode for safe SSE transmission
        const htmlBase64 = Buffer.from(updatedHtml).toString('base64');

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'complete',
          htmlBase64,
          title: 'Updated Presentation',
          slideCount: allSlides.length,
          usage,
        })}\n\n`));

      } catch (error) {
        console.error('Error in tweak-slides endpoint:', error);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'error',
          message: error instanceof Error ? error.message : 'Ett okänt fel inträffade'
        })}\n\n`));
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
