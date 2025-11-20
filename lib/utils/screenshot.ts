import { chromium } from 'playwright';

/**
 * Capture a screenshot of a specific slide from HTML content
 * Uses Playwright to render the HTML and capture the slide
 */
export async function captureSlideScreenshot(
  fullHtml: string,
  slideId: string,
  options: {
    width?: number;
    height?: number;
    format?: 'png' | 'jpeg';
  } = {}
): Promise<string> {
  const {
    width = 1920,
    height = 1080,
    format = 'png',
  } = options;

  let browser;
  try {
    // Launch headless browser
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage({
      viewport: { width, height },
    });

    // Set content
    await page.setContent(fullHtml, {
      waitUntil: 'networkidle',
    });

    // Wait for Lucide icons to initialize (if present)
    await page.waitForTimeout(300);

    // Hide all slides except target
    await page.evaluate((targetId) => {
      const allSlides = document.querySelectorAll('.slide');
      allSlides.forEach((slide) => {
        if (slide.id === targetId) {
          (slide as HTMLElement).style.display = 'flex';
          slide.classList.add('active');
        } else {
          (slide as HTMLElement).style.display = 'none';
        }
      });

      // Hide navigation controls
      const navControls = document.querySelectorAll('.navigation, .fixed, button');
      navControls.forEach((el) => {
        (el as HTMLElement).style.display = 'none';
      });

      // Initialize Lucide icons if available
      if ((window as any).lucide) {
        (window as any).lucide.createIcons();
      }
    }, slideId);

    // Wait for rendering to stabilize
    await page.waitForTimeout(200);

    // Take screenshot of the slide element
    const slideElement = await page.$(`#${slideId}`);
    if (!slideElement) {
      throw new Error(`Slide ${slideId} not found`);
    }

    const screenshotBuffer = await slideElement.screenshot({
      type: format,
    });

    // Convert to base64
    const base64 = screenshotBuffer.toString('base64');

    await browser.close();

    return base64;
  } catch (error) {
    if (browser) {
      await browser.close();
    }
    console.error('Error capturing slide screenshot:', error);
    throw error;
  }
}

/**
 * Capture screenshots of multiple slides
 */
export async function captureMultipleSlideScreenshots(
  fullHtml: string,
  slideIds: string[],
  options?: {
    width?: number;
    height?: number;
    format?: 'png' | 'jpeg';
  }
): Promise<Record<string, string>> {
  const screenshots: Record<string, string> = {};

  // Use a single browser instance for all screenshots (more efficient)
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const { width = 1920, height = 1080, format = 'png' } = options || {};

    for (const slideId of slideIds) {
      const page = await browser.newPage({
        viewport: { width, height },
      });

      await page.setContent(fullHtml, {
        waitUntil: 'networkidle',
      });

      await page.waitForTimeout(300);

      await page.evaluate((targetId) => {
        const allSlides = document.querySelectorAll('.slide');
        allSlides.forEach((slide) => {
          if (slide.id === targetId) {
            (slide as HTMLElement).style.display = 'flex';
            slide.classList.add('active');
          } else {
            (slide as HTMLElement).style.display = 'none';
          }
        });

        const navControls = document.querySelectorAll('.navigation, .fixed, button');
        navControls.forEach((el) => {
          (el as HTMLElement).style.display = 'none';
        });

        if ((window as any).lucide) {
          (window as any).lucide.createIcons();
        }
      }, slideId);

      await page.waitForTimeout(200);

      const slideElement = await page.$(`#${slideId}`);
      if (slideElement) {
        const screenshotBuffer = await slideElement.screenshot({
          type: format,
        });
        screenshots[slideId] = screenshotBuffer.toString('base64');
      }

      await page.close();
    }

    await browser.close();
  } catch (error) {
    await browser.close();
    throw error;
  }

  return screenshots;
}
