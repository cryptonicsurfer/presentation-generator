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
    await page.waitForTimeout(1500);

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

    // Clean up temp file
    if (tempHtmlPath) {
      await unlink(tempHtmlPath);
      console.log('[export-pdf] Temp file cleaned up');
    }

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
    if (tempHtmlPath) {
      try {
        await unlink(tempHtmlPath);
      } catch (unlinkError) {
        console.error('[export-pdf] Failed to clean up temp file:', unlinkError);
      }
    }

    return NextResponse.json(
      { error: 'Failed to generate PDF', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
