'use client';

import { useEffect, useRef, useState } from 'react';
import type { Slide } from '@/lib/presentation/slide-parser';

interface SlideThumbnailProps {
  slide: Slide;
  fullHtml: string; // Full HTML needed for styles/scripts
  width?: number;
  height?: number;
  onThumbnailGenerated?: (slideId: string, dataUrl: string) => void;
}

/**
 * Component that generates a thumbnail preview of a slide
 * Uses an invisible iframe to render the slide, then captures it to canvas
 */
export function SlideThumbnail({
  slide,
  fullHtml,
  width = 320,
  height = 180,
  onThumbnailGenerated,
}: SlideThumbnailProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(true);

  useEffect(() => {
    generateThumbnail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide.id, fullHtml]);

  const generateThumbnail = async () => {
    if (!iframeRef.current || !canvasRef.current) return;

    setIsGenerating(true);

    try {
      const iframe = iframeRef.current;
      const canvas = canvasRef.current;

      // Write full HTML to iframe (includes styles, scripts)
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) {
        console.error('Cannot access iframe document');
        return;
      }

      // Write the full presentation HTML
      doc.open();
      doc.write(fullHtml);
      doc.close();

      // Wait for iframe to load
      await new Promise<void>((resolve) => {
        iframe.onload = () => resolve();
        // Fallback timeout
        setTimeout(resolve, 1000);
      });

      // Find and show only the target slide
      const slideElement = doc.getElementById(slide.id);
      if (!slideElement) {
        console.error(`Slide ${slide.id} not found in iframe`);
        return;
      }

      // Hide all slides except the target one
      const allSlides = doc.querySelectorAll('.slide');
      allSlides.forEach((s) => {
        if (s.id === slide.id) {
          (s as HTMLElement).style.display = 'flex';
          (s as HTMLElement).classList.add('active');
        } else {
          (s as HTMLElement).style.display = 'none';
        }
      });

      // Hide navigation controls
      const navControls = doc.querySelectorAll('.navigation, .fixed, button');
      navControls.forEach((el) => {
        (el as HTMLElement).style.display = 'none';
      });

      // Wait a bit for rendering
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Capture to canvas
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Set canvas size
      canvas.width = width;
      canvas.height = height;

      // Get the slide dimensions (1920x1080 from presentation)
      const slideWidth = 1920;
      const slideHeight = 1080;

      // Calculate scale to fit canvas
      const scale = Math.min(width / slideWidth, height / slideHeight);

      // Draw white background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      // Use html2canvas-like approach: draw the iframe content
      // Note: This is simplified - in production you might want to use html2canvas library
      try {
        // For now, use a simple approach: render text content
        const dataUrl = await captureIframeToCanvas(iframe, canvas, scale);
        setThumbnailUrl(dataUrl);

        if (onThumbnailGenerated) {
          onThumbnailGenerated(slide.id, dataUrl);
        }
      } catch (error) {
        console.error('Error capturing slide:', error);
      }

    } catch (error) {
      console.error('Error generating thumbnail:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="relative">
      {/* Hidden iframe for rendering */}
      <iframe
        ref={iframeRef}
        className="absolute opacity-0 pointer-events-none"
        style={{
          width: '1920px',
          height: '1080px',
          left: '-9999px',
          border: 'none',
        }}
      />

      {/* Canvas for capturing */}
      <canvas
        ref={canvasRef}
        className="hidden"
        width={width}
        height={height}
      />

      {/* Display thumbnail or placeholder */}
      <div
        className="border-2 border-border/40 rounded-lg overflow-hidden bg-card shadow-sm hover:shadow-md transition-shadow"
        style={{ width: `${width}px`, height: `${height}px` }}
      >
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={slide.title || `Slide ${slide.index + 1}`}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted">
            {isGenerating ? (
              <div className="text-sm text-muted-foreground">
                Genererar thumbnail...
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                Slide {slide.index + 1}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Slide info */}
      <div className="mt-2 text-xs text-center">
        <div className="font-medium truncate">
          {slide.title || `Slide ${slide.index + 1}`}
        </div>
        <div className="text-muted-foreground">{slide.id}</div>
      </div>
    </div>
  );
}

/**
 * Capture iframe content to canvas
 * MVP approach: Use scaled-down iframe display
 * Future enhancement: Integrate html2canvas library for better screenshots
 */
async function captureIframeToCanvas(
  iframe: HTMLIFrameElement,
  canvas: HTMLCanvasElement,
  scale: number
): Promise<string> {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot get canvas context');

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) throw new Error('Cannot access iframe document');

  const slideElement = doc.querySelector('.slide.active') as HTMLElement;
  if (!slideElement) {
    throw new Error('No active slide found');
  }

  // Get computed styles for background
  const computedStyle = iframe.contentWindow!.getComputedStyle(slideElement);
  const bgColor = computedStyle.backgroundColor || '#ffffff';

  // Extract gradient background if present
  const bgImage = computedStyle.backgroundImage;

  // Draw background
  if (bgImage && bgImage !== 'none') {
    // Try to extract gradient colors
    const gradientMatch = bgImage.match(/rgb\([^)]+\)/g);
    if (gradientMatch && gradientMatch.length >= 2) {
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, gradientMatch[0]);
      gradient.addColorStop(1, gradientMatch[1]);
      ctx.fillStyle = gradient;
    } else {
      ctx.fillStyle = bgColor;
    }
  } else {
    ctx.fillStyle = bgColor;
  }
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Extract and render text content as a simple preview
  const textElements = slideElement.querySelectorAll('h1, h2, h3, p');
  let yOffset = 40;

  textElements.forEach((el, index) => {
    if (index > 3) return; // Limit to first few elements

    const text = el.textContent?.trim() || '';
    if (!text) return;

    const tagName = el.tagName.toLowerCase();
    if (tagName === 'h1') {
      ctx.font = 'bold 16px sans-serif';
      ctx.fillStyle = '#1f2937';
    } else if (tagName === 'h2') {
      ctx.font = 'bold 14px sans-serif';
      ctx.fillStyle = '#374151';
    } else {
      ctx.font = '12px sans-serif';
      ctx.fillStyle = '#6b7280';
    }

    // Truncate long text
    const maxLength = 40;
    const displayText = text.length > maxLength ? text.substring(0, maxLength) + '...' : text;

    ctx.fillText(displayText, 10, yOffset);
    yOffset += tagName === 'h1' ? 30 : 20;
  });

  // Add slide indicator
  ctx.font = '10px sans-serif';
  ctx.fillStyle = '#9ca3af';
  ctx.textAlign = 'right';
  ctx.fillText(`Preview`, canvas.width - 10, canvas.height - 10);

  return canvas.toDataURL('image/png');
}
