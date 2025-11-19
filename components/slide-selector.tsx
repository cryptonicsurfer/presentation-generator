'use client';

import { useState, useRef } from 'react';
import { SlideThumbnail } from './slide-thumbnail';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash2, Edit3, CheckSquare, Square, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Slide } from '@/lib/presentation/slide-parser';

interface SlideSelectorProps {
  slides: Slide[];
  fullHtml: string;
  selectedSlideIds: string[];
  onSelectionChange: (slideIds: string[]) => void;
  onDeleteSelected?: () => void;
  onModifySelected?: () => void;
}

/**
 * Component for selecting slides with thumbnail preview and checkboxes
 */
export function SlideSelector({
  slides,
  fullHtml,
  selectedSlideIds,
  onSelectionChange,
  onDeleteSelected,
  onModifySelected,
}: SlideSelectorProps) {
  const [hoveredSlide, setHoveredSlide] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const handleToggleSlide = (slideId: string) => {
    if (selectedSlideIds.includes(slideId)) {
      onSelectionChange(selectedSlideIds.filter(id => id !== slideId));
    } else {
      onSelectionChange([...selectedSlideIds, slideId]);
    }
  };

  const scroll = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const scrollAmount = 300;
      const newScroll = direction === 'left'
        ? scrollContainerRef.current.scrollLeft - scrollAmount
        : scrollContainerRef.current.scrollLeft + scrollAmount;

      scrollContainerRef.current.scrollTo({
        left: newScroll,
        behavior: 'smooth'
      });
    }
  };

  // Drag to scroll handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!scrollContainerRef.current) return;
    setIsDragging(true);
    setStartX(e.pageX - scrollContainerRef.current.offsetLeft);
    setScrollLeft(scrollContainerRef.current.scrollLeft);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !scrollContainerRef.current) return;
    e.preventDefault();
    const x = e.pageX - scrollContainerRef.current.offsetLeft;
    const walk = (x - startX) * 2;
    scrollContainerRef.current.scrollLeft = scrollLeft - walk;
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
  };

  // Show ALL slides (including title and thank you)
  const allSlides = slides;
  const selectedCount = selectedSlideIds.length;

  return (
    <div className="space-y-3">
      {/* Simplified header with slide count and action icons */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {selectedCount > 0 ? (
            <span className="font-medium text-foreground">
              {selectedCount} {selectedCount === 1 ? 'slide' : 'slides'} vald{selectedCount > 1 ? 'a' : ''}
            </span>
          ) : (
            <span>Välj slides att redigera eller ta bort</span>
          )}
        </div>

        {/* Action icons (only show when slides are selected) */}
        {selectedCount > 0 && (
          <div className="flex gap-1">
            {onModifySelected && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onModifySelected}
                className="h-8 w-8 p-0"
                title="Redigera valda slides"
              >
                <Edit3 className="w-4 h-4" />
              </Button>
            )}
            {onDeleteSelected && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onDeleteSelected}
                className="h-8 w-8 p-0 hover:bg-destructive/10 hover:text-destructive"
                title="Ta bort valda slides"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Horizontal carousel with navigation arrows */}
      <div className="relative group">
        {/* Left arrow */}
        <Button
          variant="ghost"
          size="sm"
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 h-24 w-10 rounded-r-lg bg-background/80 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
          onClick={() => scroll('left')}
        >
          <ChevronLeft className="w-6 h-6" />
        </Button>

        {/* Right arrow */}
        <Button
          variant="ghost"
          size="sm"
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 h-24 w-10 rounded-l-lg bg-background/80 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
          onClick={() => scroll('right')}
        >
          <ChevronRight className="w-6 h-6" />
        </Button>

        {/* Scrollable container with drag */}
        <div
          ref={scrollContainerRef}
          className="flex gap-3 overflow-x-auto pb-4 scroll-smooth snap-x snap-mandatory hide-scrollbar cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        >
          {allSlides.map((slide) => {
            const isSelected = selectedSlideIds.includes(slide.id);
            const isHovered = hoveredSlide === slide.id;

            return (
              <div
                key={slide.id}
                className="flex-shrink-0 snap-start"
                onMouseEnter={() => setHoveredSlide(slide.id)}
                onMouseLeave={() => setHoveredSlide(null)}
              >
                {/* Thumbnail with overlay */}
                <div
                  className={`relative cursor-pointer transition-all ${
                    isSelected ? 'ring-4 ring-primary ring-offset-2' : ''
                  } ${isHovered ? 'scale-105' : ''}`}
                  onClick={() => handleToggleSlide(slide.id)}
                >
                  {/* Real thumbnail using SlideThumbnail component */}
                  <SlideThumbnail
                    slide={slide}
                    fullHtml={fullHtml}
                    width={200}
                    height={113}
                  />

                  {/* Selection overlay */}
                  {isSelected && (
                    <div className="absolute inset-0 bg-primary/20 rounded-lg pointer-events-none flex items-center justify-center">
                      <div className="bg-primary text-primary-foreground rounded-full p-2">
                        <CheckSquare className="w-5 h-5" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Checkbox below thumbnail */}
                <div className="mt-2 flex items-center justify-center gap-2">
                  <Checkbox
                    id={`checkbox-${slide.id}`}
                    checked={isSelected}
                    onCheckedChange={() => handleToggleSlide(slide.id)}
                  />
                  <label
                    htmlFor={`checkbox-${slide.id}`}
                    className="text-xs font-medium cursor-pointer"
                  >
                    Slide {slide.index + 1}
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        {/* Custom scrollbar hide */}
        <style jsx>{`
          .hide-scrollbar {
            -ms-overflow-style: none;
            scrollbar-width: none;
          }
          .hide-scrollbar::-webkit-scrollbar {
            display: none;
          }
        `}</style>
      </div>

      {/* Empty state */}
      {allSlides.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p>Inga slides att visa. Generera en presentation först.</p>
        </div>
      )}

      {/* Info text */}
      <div className="text-xs text-muted-foreground text-center">
        Tip: Klicka på thumbnails eller checkboxes för att välja slides. Du kan välja flera slides samtidigt.
      </div>
    </div>
  );
}
