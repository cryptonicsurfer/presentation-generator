/**
 * File Parser Module
 *
 * Handles parsing of different file types for context injection.
 * Supports: PDF (via Mistral OCR), DOCX (via mammoth)
 */

import { parsePdfWithMistral, stripMarkdown } from './mistral-ocr';
import { parseDocx } from './docx-parser';

export interface ParsedFile {
  content: string;
  filename: string;
  mimeType: string;
  size: number;
  parseTime: number;
}

// Max file size: 10MB
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Supported MIME types
export const SUPPORTED_TYPES = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc', // Old .doc format - we'll try with mammoth
} as const;

/**
 * Parse an uploaded file and extract text content
 *
 * @param fileBuffer - File as Buffer
 * @param filename - Original filename
 * @param mimeType - File MIME type
 * @returns Parsed file with content
 */
export async function parseFile(
  fileBuffer: Buffer,
  filename: string,
  mimeType: string
): Promise<ParsedFile> {
  const startTime = Date.now();

  // Validate file size
  if (fileBuffer.length > MAX_FILE_SIZE) {
    throw new Error(
      `Filen är för stor (${(fileBuffer.length / 1024 / 1024).toFixed(1)} MB). ` +
        `Max storlek är ${MAX_FILE_SIZE / 1024 / 1024} MB.`
    );
  }

  // Determine file type
  const fileType = SUPPORTED_TYPES[mimeType as keyof typeof SUPPORTED_TYPES];

  if (!fileType) {
    // Try to infer from filename
    const ext = filename.toLowerCase().split('.').pop();
    if (ext === 'pdf') {
      return parseFile(fileBuffer, filename, 'application/pdf');
    } else if (ext === 'docx') {
      return parseFile(
        fileBuffer,
        filename,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
    } else if (ext === 'doc') {
      return parseFile(fileBuffer, filename, 'application/msword');
    }

    throw new Error(
      `Filtypen stöds inte: ${mimeType || 'okänd'}. ` +
        `Använd PDF eller DOCX.`
    );
  }

  let content: string;

  switch (fileType) {
    case 'pdf':
      content = await parsePdfWithMistral(fileBuffer, filename);
      // Strip markdown for cleaner text
      content = stripMarkdown(content);
      break;

    case 'docx':
    case 'doc':
      content = await parseDocx(fileBuffer, filename);
      break;

    default:
      throw new Error(`Filtypen ${fileType} stöds inte än.`);
  }

  const parseTime = Date.now() - startTime;

  return {
    content,
    filename,
    mimeType,
    size: fileBuffer.length,
    parseTime,
  };
}

/**
 * Truncate content if too long for context window
 * Keeps beginning and end, truncates middle
 */
export function truncateContent(content: string, maxChars: number = 50000): string {
  if (content.length <= maxChars) {
    return content;
  }

  const halfMax = Math.floor(maxChars / 2);
  const start = content.slice(0, halfMax);
  const end = content.slice(-halfMax);

  return `${start}\n\n[... ${content.length - maxChars} tecken utelämnade ...]\n\n${end}`;
}

// Re-export individual parsers
export { parsePdfWithMistral, stripMarkdown } from './mistral-ocr';
export { parseDocx, parseDocxToHtml } from './docx-parser';
