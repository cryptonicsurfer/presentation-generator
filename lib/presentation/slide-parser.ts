/**
 * Slide parsing and manipulation utilities for targeted slide editing
 */

export interface Slide {
  id: string;           // e.g., "slide-0", "slide-1"
  index: number;        // 0-based index
  html: string;         // Full <section>...</section> HTML
  content: string;      // Inner HTML content
  title?: string;       // Extracted title if available
  type?: 'title' | 'content' | 'thankyou';
}

/**
 * Extract individual slides from full presentation HTML
 */
export function extractSlides(fullHtml: string): Slide[] {
  const slides: Slide[] = [];

  // Match all <section> tags with their content
  // This regex captures: opening tag, content, closing tag
  const sectionRegex = /<section\s+([^>]*?)>([\s\S]*?)<\/section>/gi;

  let match;
  let index = 0;

  while ((match = sectionRegex.exec(fullHtml)) !== null) {
    const openingTag = match[1]; // attributes
    const content = match[2];    // inner HTML
    const fullSection = match[0]; // complete <section>...</section>

    // Extract id attribute
    const idMatch = openingTag.match(/id=["']([^"']+)["']/);
    const id = idMatch ? idMatch[1] : `slide-${index}`;

    // Determine slide type
    let type: 'title' | 'content' | 'thankyou' = 'content';
    if (id === 'slide-title') type = 'title';
    else if (id === 'slide-thankyou') type = 'thankyou';

    // Try to extract title from h1 or h2
    const titleMatch = content.match(/<h[12][^>]*>(.*?)<\/h[12]>/i);
    const title = titleMatch ? stripHtmlTags(titleMatch[1]) : undefined;

    slides.push({
      id,
      index,
      html: fullSection,
      content,
      title,
      type,
    });

    index++;
  }

  return slides;
}

/**
 * Replace specific slides in the full HTML with updated versions
 */
export function replaceSlides(fullHtml: string, updatedSlides: Slide[]): string {
  let result = fullHtml;

  for (const slide of updatedSlides) {
    // Create regex to match the specific slide by ID
    const slideRegex = new RegExp(
      `<section\\s+[^>]*id=["']${escapeRegex(slide.id)}["'][^>]*>[\\s\\S]*?<\\/section>`,
      'i'
    );

    // Replace the slide
    result = result.replace(slideRegex, slide.html);
  }

  return result;
}

/**
 * Delete specific slides from the HTML
 */
export function deleteSlides(fullHtml: string, slideIdsToDelete: string[]): string {
  let result = fullHtml;

  for (const slideId of slideIdsToDelete) {
    // Remove the entire <section> element with this ID
    const slideRegex = new RegExp(
      `<section\\s+[^>]*id=["']${escapeRegex(slideId)}["'][^>]*>[\\s\\S]*?<\\/section>\\s*`,
      'gi'
    );

    result = result.replace(slideRegex, '');
  }

  return result;
}

/**
 * Renumber slides after deletion to maintain sequential IDs
 */
export function renumberSlides(fullHtml: string): string {
  const slides = extractSlides(fullHtml);
  let result = fullHtml;
  let newIndex = 0;

  for (const slide of slides) {
    // Skip title and thank you slides - they keep their special IDs
    if (slide.type === 'title' || slide.type === 'thankyou') {
      continue;
    }

    // Replace old ID with new sequential ID
    const oldId = slide.id;
    const newId = `slide-${newIndex}`;

    if (oldId !== newId) {
      // Replace id attribute in the opening tag
      result = result.replace(
        new RegExp(`id=["']${escapeRegex(oldId)}["']`, 'g'),
        `id="${newId}"`
      );
    }

    newIndex++;
  }

  return result;
}

/**
 * Get slide by ID
 */
export function getSlideById(fullHtml: string, slideId: string): Slide | null {
  const slides = extractSlides(fullHtml);
  return slides.find(s => s.id === slideId) || null;
}

/**
 * Get slide count (excluding title and thank you slides)
 */
export function getContentSlideCount(fullHtml: string): number {
  const slides = extractSlides(fullHtml);
  return slides.filter(s => s.type === 'content').length;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strip HTML tags from a string
 */
function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

/**
 * Validate that HTML contains valid slide structure
 */
export function validateSlideStructure(fullHtml: string): { valid: boolean; error?: string } {
  const slides = extractSlides(fullHtml);

  if (slides.length === 0) {
    return { valid: false, error: 'No slides found in HTML' };
  }

  // Check for duplicate IDs
  const ids = slides.map(s => s.id);
  const uniqueIds = new Set(ids);
  if (ids.length !== uniqueIds.size) {
    return { valid: false, error: 'Duplicate slide IDs found' };
  }

  return { valid: true };
}
