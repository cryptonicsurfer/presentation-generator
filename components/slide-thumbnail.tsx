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

    // Create a CSS rule that specifically shows only the target slide
    // This uses high specificity and !important to override all other rules
    const escapedId = CSS.escape(slide.id);
    console.log(`[Thumbnail] CSS selector for slide "${slide.id}" → "#${escapedId}"`);

    const thumbnailStyles = `
      <style id="thumbnail-override">
        /* Hide ALL slides by default */
        .slide { display: none !important; }
        .slide.active { display: none !important; }

        /* Only show the target slide */
        #${escapedId} { display: flex !important; }

        /* Hide navigation UI */
        .navigation, .fixed, button, #prev-btn, #next-btn { display: none !important; }
        .fixed.bottom-8, .fixed.top-8 { display: none !important; }
      </style>
    `;

    // Remove the navigation script that interferes with slide visibility
    // and inject our custom styles before </head>
    let cleanedHtml = fullHtml
      // Remove the main navigation script block
      .replace(/<script>\s*\(function\s*\(\)\s*\{[\s\S]*?\}\)\(\);\s*<\/script>/g, '')
      // Inject our thumbnail-specific styles right before </head>
      .replace('</head>', `${thumbnailStyles}</head>`);

    // Write cleaned HTML to iframe
    doc.open();
    doc.write(cleanedHtml);
    doc.close();

    // Also apply via JavaScript as a fallback (some browsers need this)
    const applyStyles = () => {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) return;

      // Debug: log what we're looking for
      const allSlides = iframeDoc.querySelectorAll('.slide');
      const slideIds = Array.from(allSlides).map(s => s.id);
      console.log(`[Thumbnail] Looking for slide: "${slide.id}", found slides:`, slideIds);

      // Double-check: apply inline styles to be absolutely sure
      let foundTarget = false;
      allSlides.forEach((s) => {
        const el = s as HTMLElement;
        if (s.id === slide.id) {
          el.style.setProperty('display', 'flex', 'important');
          foundTarget = true;
        } else {
          el.style.setProperty('display', 'none', 'important');
        }
      });

      if (!foundTarget) {
        console.warn(`[Thumbnail] WARNING: Target slide "${slide.id}" not found in iframe!`);
      }

      // Initialize Lucide icons if available
      if (iframe.contentWindow && (iframe.contentWindow as any).lucide) {
        (iframe.contentWindow as any).lucide.createIcons();
      }
    };

    // Apply styles after a delay to ensure DOM and external resources are ready
    // 200ms gives time for doc.write() to complete and DOM to be parsed
    setTimeout(applyStyles, 200);
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
