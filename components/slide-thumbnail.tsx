'use client';

import { useEffect, useRef } from 'react';
import type { Slide } from '@/lib/presentation/slide-parser';

interface SlideThumbnailProps {
  slide: Slide;
  fullHtml: string; // Need full HTML for styles
  width?: number;
  height?: number;
}

/**
 * Component that displays a scaled-down preview of a slide using CSS transform
 * Uses an iframe to ensure styles are isolated and properly rendered
 */
export function SlideThumbnail({
  slide,
  fullHtml,
  width = 288,
  height = 162,
}: SlideThumbnailProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Original slide dimensions (16:9 aspect ratio)
  const originalWidth = 1920;
  const originalHeight = 1080;

  // Calculate scale factor to fit in thumbnail
  const scale = Math.min(width / originalWidth, height / originalHeight);

  useEffect(() => {
    if (!iframeRef.current) return;

    const iframe = iframeRef.current;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;

    // Write full HTML to iframe
    doc.open();
    doc.write(fullHtml);
    doc.close();

    // Wait for iframe to load
    iframe.onload = () => {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) return;

      // Hide all slides except the target one
      const allSlides = iframeDoc.querySelectorAll('.slide');
      allSlides.forEach((s) => {
        if (s.id === slide.id) {
          (s as HTMLElement).style.display = 'flex';
          (s as HTMLElement).classList.add('active');
        } else {
          (s as HTMLElement).style.display = 'none';
        }
      });

      // Hide navigation controls
      const navControls = iframeDoc.querySelectorAll('.navigation, .fixed, button');
      navControls.forEach((el) => {
        (el as HTMLElement).style.display = 'none';
      });

      // Initialize Lucide icons if available
      if (iframe.contentWindow && (iframe.contentWindow as any).lucide) {
        (iframe.contentWindow as any).lucide.createIcons();
      }
    };
  }, [slide.id, fullHtml]);

  return (
    <div
      className="relative overflow-hidden border-2 border-border/40 rounded-lg bg-white shadow-sm hover:shadow-md transition-shadow cursor-pointer"
      style={{
        width: `${width}px`,
        height: `${height}px`,
      }}
    >
      {/* Prevent clicks inside the thumbnail from triggering slide actions */}
      <div className="absolute inset-0 z-10" />

      {/* Iframe with scaled-down slide content */}
      <iframe
        ref={iframeRef}
        className="border-none pointer-events-none"
        style={{
          width: `${originalWidth}px`,
          height: `${originalHeight}px`,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      />
    </div>
  );
}
