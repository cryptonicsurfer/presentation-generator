/**
 * DOCX Parser using mammoth
 *
 * Extracts text from Word documents (.docx) with good formatting preservation.
 */

import mammoth from 'mammoth';

/**
 * Extract text from DOCX file
 *
 * @param fileBuffer - DOCX file as Buffer
 * @param filename - Original filename for logging
 * @returns Plain text content
 */
export async function parseDocx(
  fileBuffer: Buffer,
  filename: string
): Promise<string> {
  console.log(`[DOCX Parser] Processing: ${filename} (${(fileBuffer.length / 1024).toFixed(1)} KB)`);
  const startTime = Date.now();

  try {
    // Extract text (not HTML) for cleaner output
    const result = await mammoth.extractRawText({ buffer: fileBuffer });

    if (result.messages.length > 0) {
      console.log('[DOCX Parser] Warnings:', result.messages);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[DOCX Parser] Complete in ${elapsed}s, extracted ${result.value.length} chars`);

    return result.value.trim();
  } catch (error) {
    console.error('[DOCX Parser] Error:', error);
    throw new Error(
      `DOCX-parsning misslyckades: ${error instanceof Error ? error.message : 'Okänt fel'}`
    );
  }
}

/**
 * Extract text from DOCX with HTML formatting preserved
 * Useful if you need to preserve some structure
 *
 * @param fileBuffer - DOCX file as Buffer
 * @param filename - Original filename for logging
 * @returns HTML content
 */
export async function parseDocxToHtml(
  fileBuffer: Buffer,
  filename: string
): Promise<string> {
  console.log(`[DOCX Parser] Processing to HTML: ${filename}`);

  try {
    const result = await mammoth.convertToHtml({ buffer: fileBuffer });

    if (result.messages.length > 0) {
      console.log('[DOCX Parser] Warnings:', result.messages);
    }

    return result.value;
  } catch (error) {
    console.error('[DOCX Parser] Error:', error);
    throw new Error(
      `DOCX-parsning misslyckades: ${error instanceof Error ? error.message : 'Okänt fel'}`
    );
  }
}
