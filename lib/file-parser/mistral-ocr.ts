/**
 * Mistral OCR for PDF parsing
 *
 * Uses Mistral's OCR API to extract text from PDFs with high accuracy.
 * Returns markdown-formatted text.
 */

import { Mistral } from '@mistralai/mistralai';

let mistralClient: Mistral | null = null;

function getMistralClient(): Mistral {
  if (!mistralClient) {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) {
      throw new Error('MISTRAL_API_KEY environment variable is not set');
    }
    mistralClient = new Mistral({ apiKey });
  }
  return mistralClient;
}

/**
 * Extract text from PDF using Mistral OCR
 *
 * @param fileBuffer - PDF file as Buffer
 * @param filename - Original filename for reference
 * @returns Markdown-formatted text content
 */
export async function parsePdfWithMistral(
  fileBuffer: Buffer,
  filename: string
): Promise<string> {
  const client = getMistralClient();

  console.log(`[Mistral OCR] Processing PDF: ${filename} (${(fileBuffer.length / 1024).toFixed(1)} KB)`);
  const startTime = Date.now();

  try {
    // Upload file to Mistral
    // Convert Buffer to Uint8Array for Blob compatibility
    const uint8Array = new Uint8Array(fileBuffer);
    const blob = new Blob([uint8Array], { type: 'application/pdf' });
    const file = new File([blob], filename, { type: 'application/pdf' });

    const uploadedFile = await client.files.upload({
      file,
      purpose: 'ocr' as any, // Type issue in SDK
    });

    console.log(`[Mistral OCR] File uploaded, ID: ${uploadedFile.id}`);

    // Get signed URL for OCR processing
    const signedUrl = await client.files.getSignedUrl({
      fileId: uploadedFile.id,
    });

    // Process with OCR
    const ocrResponse = await client.ocr.process({
      model: 'mistral-ocr-latest',
      document: {
        type: 'document_url',
        documentUrl: signedUrl.url,
      },
    });

    // Collect text from all pages
    let fullText = '';
    for (const page of ocrResponse.pages || []) {
      if (page.markdown) {
        fullText += page.markdown + '\n\n';
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Mistral OCR] Complete in ${elapsed}s, extracted ${fullText.length} chars`);

    // Clean up uploaded file
    try {
      await client.files.delete({ fileId: uploadedFile.id });
    } catch (e) {
      // Ignore cleanup errors
    }

    return fullText.trim();
  } catch (error) {
    console.error('[Mistral OCR] Error:', error);
    throw new Error(
      `PDF-parsning misslyckades: ${error instanceof Error ? error.message : 'Okänt fel'}`
    );
  }
}

/**
 * Strip markdown formatting for cleaner text
 */
export function stripMarkdown(text: string): string {
  return text
    // Remove headers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold/italic
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Remove links but keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove images
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    // Clean up extra whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
