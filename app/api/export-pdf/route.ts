import { NextRequest, NextResponse } from 'next/server';
import { chromium } from 'playwright';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { randomBytes } from 'crypto';

/**
 * Export presentation HTML to PDF using Playwright
 *
 * POST /api/export-pdf
 * Body: { html: string, filename?: string }
 * Returns: PDF file as download
 */
export async function POST(request: NextRequest) {
  let tempHtmlPath: string | null = null;
  let browser;

  try {
    const body = await request.json();
    const { html, filename = 'presentation.pdf' } = body;

    if (!html || typeof html !== 'string') {
      return NextResponse.json(
        { error: 'HTML content is required' },
        { status: 400 }
      );
    }

    console.log('[export-pdf] Starting PDF generation...');
    console.log('[export-pdf] HTML length:', html.length);

    // Create temporary HTML file
    const tempId = randomBytes(16).toString('hex');
    tempHtmlPath = join(process.cwd(), 'public', 'temp', `${tempId}.html`);

    // Ensure temp directory exists
    const { mkdir } = await import('fs/promises');
    await mkdir(join(process.cwd(), 'public', 'temp'), { recursive: true });

    // Write HTML to temp file
    await writeFile(tempHtmlPath, html, 'utf-8');
    console.log('[export-pdf] Temp HTML created:', tempHtmlPath);

    // Launch Playwright browser
    console.log('[export-pdf] Launching Chromium...');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'] // For VPS compatibility
    });

    const page = await browser.newPage();

    // Set viewport to 1920x1080 (16:9 presentation format)
    await page.setViewportSize({ width: 1920, height: 1080 });

    // Navigate to temp HTML file
    const fileUrl = `file://${tempHtmlPath}`;
    console.log('[export-pdf] Loading HTML from:', fileUrl);
    await page.goto(fileUrl, { waitUntil: 'networkidle' });

    // Wait for slides to load
    await page.waitForFunction(() => {
      const slides = document.querySelectorAll('.slide');
      return slides.length > 0;
    });

    // Wait for fonts and images to load
    await page.waitForTimeout(1000);

    // Wait for Chart.js to initialize and disable animations for PDF
    const chartInfo = await page.evaluate(() => {
      return new Promise<{ hasChartJS: boolean; canvasCount: number; chartsUpdated: number }>((resolve) => {
        // Check if Chart.js is loaded
        const hasChartJS = typeof (window as any).Chart !== 'undefined';

        if (!hasChartJS) {
          resolve({ hasChartJS: false, canvasCount: 0, chartsUpdated: 0 });
          return;
        }

        // Disable animations globally for all charts
        (window as any).Chart.defaults.animation = false;

        // Find all canvas elements with Chart.js instances
        const canvases = document.querySelectorAll('canvas');
        const canvasCount = canvases.length;

        if (canvasCount === 0) {
          resolve({ hasChartJS: true, canvasCount: 0, chartsUpdated: 0 });
          return;
        }

        // Wait for charts to initialize and then disable animations
        setTimeout(() => {
          let chartsUpdated = 0;

          canvases.forEach((canvas) => {
            try {
              const chart = (window as any).Chart.getChart(canvas);
              if (chart) {
                // Update chart with animations disabled
                chart.options.animation = false;
                chart.update('none'); // 'none' mode = no animation
                chartsUpdated++;
              }
            } catch (error) {
              // Silently continue if chart update fails
            }
          });

          resolve({ hasChartJS: true, canvasCount, chartsUpdated });
        }, 4000); // Wait 4s for charts to initialize (INCREASED for testing)
      });
    });

    console.log('[export-pdf] Chart.js status:', chartInfo);

    // Additional wait to ensure charts are fully rendered without animation
    await page.waitForTimeout(2000); // INCREASED to 2s for testing

    // Prepare for PDF export - show all slides and remove navigation
    await page.evaluate(() => {
      // Remove navigation elements
      document.querySelectorAll('.fixed').forEach(el => el.remove());
      document.querySelectorAll('button').forEach(el => el.remove());

      // Make all slides visible for PDF
      document.querySelectorAll('.slide').forEach(slide => {
        slide.classList.add('active');
      });
    });

    console.log('[export-pdf] All slides visible, waiting for final render...');
    await page.waitForTimeout(1000); // Extra wait after showing all slides

    console.log('[export-pdf] Generating PDF...');

    // Generate PDF with Playwright
    const pdfBuffer = await page.pdf({
      width: '1920px',
      height: '1080px',
      printBackground: true, // CRITICAL - preserve colors/gradients
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      displayHeaderFooter: false,
      preferCSSPageSize: true, // CRITICAL - respect @page CSS
    });

    console.log('[export-pdf] PDF generated successfully! Size:', pdfBuffer.length, 'bytes');

    // Close browser
    await browser.close();

    // Clean up temp file - DISABLED for debugging
    // TODO: Re-enable this after chart debugging
    // if (tempHtmlPath) {
    //   await unlink(tempHtmlPath);
    //   console.log('[export-pdf] Temp file cleaned up');
    // }
    console.log('[export-pdf] Temp HTML saved for debugging:', tempHtmlPath);

    // Return PDF as download
    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': pdfBuffer.length.toString(),
      },
    });

  } catch (error) {
    console.error('[export-pdf] Error:', error);

    // Clean up on error
    if (browser) {
      await browser.close();
    }
    // Keep temp file for debugging - DISABLED cleanup
    // TODO: Re-enable this after chart debugging
    // if (tempHtmlPath) {
    //   try {
    //     await unlink(tempHtmlPath);
    //   } catch (unlinkError) {
    //     console.error('[export-pdf] Failed to clean up temp file:', unlinkError);
    //   }
    // }
    if (tempHtmlPath) {
      console.error('[export-pdf] Temp HTML saved for debugging:', tempHtmlPath);
    }

    return NextResponse.json(
      { error: 'Failed to generate PDF', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
