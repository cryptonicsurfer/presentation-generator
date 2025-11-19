/**
 * Logo base64 encodings for embedded HTML presentations
 * These are injected AFTER AI generation to keep prompts token-efficient
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// Lazy-load and cache logos
let LOGO_SVART_LIGG_CACHE: string | null = null;
let LOGO_VIT_LIGG_CACHE: string | null = null;

/**
 * Get black logo as base64 data URI (for light backgrounds)
 */
export function getLogoSvartLigg(): string {
  if (!LOGO_SVART_LIGG_CACHE) {
    const logoPath = join(process.cwd(), 'public/assets/Falkenbergskommun-logo_SVART_LIGG.png');
    const buffer = readFileSync(logoPath);
    LOGO_SVART_LIGG_CACHE = `data:image/png;base64,${buffer.toString('base64')}`;
  }
  return LOGO_SVART_LIGG_CACHE;
}

/**
 * Get white logo as base64 data URI (for dark backgrounds)
 * Uses CMYK_NEG_LIGG which is white on transparent
 */
export function getLogoVitLigg(): string {
  if (!LOGO_VIT_LIGG_CACHE) {
    const logoPath = join(process.cwd(), 'public/assets/Falkenbergskommun-logo_CMYK_NEG_LIGG.png');
    const buffer = readFileSync(logoPath);
    LOGO_VIT_LIGG_CACHE = `data:image/png;base64,${buffer.toString('base64')}`;
  }
  return LOGO_VIT_LIGG_CACHE;
}

/**
 * Replace logo placeholders in HTML with actual base64 data URIs
 */
export function injectLogos(html: string): string {
  return html
    .replace(/{{LOGO_SVART}}/g, getLogoSvartLigg())
    .replace(/{{LOGO_VIT}}/g, getLogoVitLigg());
}
