'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Download, Eye, Maximize2, FileJson, Sparkles } from 'lucide-react';
import type { ModelInfo } from '@/app/api/models/route';
import { formatCost, calculateCost } from '@/lib/pricing';
import { ChatInterface, type Message } from './chat-interface';
import { SlideSelector } from './slide-selector';
import { FalconSpinner } from './falcon-spinner';
import { extractSlides, deleteSlides, renumberSlides, type Slide } from '@/lib/presentation/slide-parser';

type StatusUpdate = {
  type: 'status' | 'tool' | 'thinking' | 'error' | 'complete';
  message?: string;
  html?: string;
  title?: string;
  slideCount?: number;
  toolCallsLogUrl?: string;
  model?: string;
  presentationData?: {
    title: string;
    sections: string[];
  };
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
  };
};

type ShimmerContainerProps = {
  active?: boolean;
  radius?: string;
  className?: string;
  wrapperClassName?: string;
  children: ReactNode;
};

function ShimmerContainer({ active, radius = '1.5rem', className, wrapperClassName, children }: ShimmerContainerProps) {
  if (!active) {
    if (className || wrapperClassName) {
      return <div className={`${wrapperClassName || ''} ${className || ''}`.trim()}>{children}</div>;
    }
    return <>{children}</>;
  }

  return (
    <div className={`shimmer-border-wrapper ${wrapperClassName || ''}`.trim()} style={{ '--shimmer-radius': radius, padding: '3px' } as CSSProperties}>
      <div className="shimmer-border-bg">
        <div className="shimmer-gradient-rotate" />
      </div>
      <div className={className} style={{ position: 'relative', zIndex: 1, borderRadius: `calc(${radius} - 3px)` }}>
        {children}
      </div>
    </div>
  );
}

export default function PresentationGenerator() {
  const [prompt, setPrompt] = useState('');
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusUpdates, setStatusUpdates] = useState<StatusUpdate[]>([]);
  const [generatedHTML, setGeneratedHTML] = useState<string | null>(null);
  const [presentationTitle, setPresentationTitle] = useState<string>('');
  const [presentationData, setPresentationData] = useState<{ title: string; sections: string[] } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTweaking, setIsTweaking] = useState(false);
  const [toolCallsLogUrl, setToolCallsLogUrl] = useState<string | null>(null);
  const [usageData, setUsageData] = useState<{ inputTokens: number; outputTokens: number; totalTokens: number; cost: number } | null>(null);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [selectedSlideIds, setSelectedSlideIds] = useState<string[]>([]);
  const [thinkingLevel, setThinkingLevel] = useState<'low' | 'high' | 'off'>('off');
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [pdfProgress, setPdfProgress] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const statusScrollRef = useRef<HTMLDivElement>(null);

  const examplePrompts = [
    'Skapa en företagsrapport för Randek AB',
    'KPI-översikt för Falkenberg Q4 2024',
    'Gör en presentation med finansiell data från vår databas och kontakter och möten från crm-systemet om företaget:',
  ];

  const exampleTweakPrompts = [
    'Byt ut till bokslut 2024 istället för 2023',
    'Lägg till en slide med finansiell jämförelse mot föregående år',
    'Gör texten större och mer lättläst',
  ];

  const shouldHighlightPrompt = isGenerating && !isTweaking;
  const shouldHighlightStatus = isGenerating || isTweaking;
  const shouldHighlightPreview = isTweaking;
  const shouldHighlightTweakArea = isTweaking;

  // Fetch available models on mount
  useEffect(() => {
    async function fetchModels() {
      try {
        const response = await fetch('/api/models');
        if (!response.ok) throw new Error('Failed to fetch models');
        const data = await response.json();
        setAvailableModels(data.models);

        // Set default model to first available model
        if (data.models.length > 0) {
          setSelectedModel(data.models[0].id);
        }
      } catch (error) {
        console.error('Error fetching models:', error);
      }
    }
    fetchModels();
  }, []);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setIsGenerating(true);
    setStatusUpdates([]);
    setGeneratedHTML(null);
    setPresentationTitle('');
    setPresentationData(null);
    setMessages([]); // Reset chat history on new generation

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          model: selectedModel,
          thinkingLevel: thinkingLevel !== 'off' ? thinkingLevel : undefined
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate presentation');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader available');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Accumulate chunks
        buffer += decoder.decode(value, { stream: true });

        // Split by double newline to get complete SSE messages
        const messages = buffer.split('\n\n');

        // Keep the last incomplete message in the buffer
        buffer = messages.pop() || '';

        // Process each complete message
        for (const message of messages) {
          const lines = message.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6)) as StatusUpdate;
                setStatusUpdates((prev) => [...prev, data]);

                if (data.type === 'complete') {
                  // Support both html (direct) and htmlBase64 (encoded)
                  let html = data.html;
                  if (!html && (data as any).htmlBase64) {
                    try {
                      // Decode base64 with proper UTF-8 handling
                      const binaryString = atob((data as any).htmlBase64);
                      const bytes = new Uint8Array(binaryString.length);
                      for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                      }
                      html = new TextDecoder('utf-8').decode(bytes);
                    } catch (e) {
                      console.error('Failed to decode base64 HTML:', e);
                    }
                  }

                  if (html) {
                    setGeneratedHTML(html);
                    setPresentationTitle(data.title || 'Presentation');
                    if (data.presentationData) {
                      setPresentationData(data.presentationData);
                    }
                    if (data.toolCallsLogUrl) {
                      setToolCallsLogUrl(data.toolCallsLogUrl);
                    }
                    // Capture usage data and calculate cost
                    if (data.usage) {
                      const cost = calculateCost(
                        selectedModel,
                        data.usage.inputTokens,
                        data.usage.outputTokens
                      );
                      setUsageData({
                        inputTokens: data.usage.inputTokens,
                        outputTokens: data.usage.outputTokens,
                        totalTokens: data.usage.totalTokens,
                        cost
                      });
                    }
                  }
                }
              } catch (e) {
                console.error('Error parsing SSE data:', e, 'Line:', line);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error:', error);
      setStatusUpdates((prev) => [
        ...prev,
        { type: 'error', message: 'Ett fel inträffade vid generering av presentation' },
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = () => {
    if (!generatedHTML) return;

    const blob = new Blob([generatedHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${presentationTitle.toLowerCase().replace(/\s+/g, '-')}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadPDF = async () => {
    if (!generatedHTML) return;

    setIsGeneratingPDF(true);
    setPdfProgress(0);

    // Start progress animation (10 seconds total)
    const duration = 10000; // 10 seconds
    const steps = 100;
    const stepDuration = duration / steps;

    progressIntervalRef.current = setInterval(() => {
      setPdfProgress((prev) => {
        if (prev >= 100) {
          if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
          }
          return 100;
        }
        return prev + 1;
      });
    }, stepDuration);

    try {
      console.log('[PDF Export] Starting PDF generation...');

      const filename = `${presentationTitle.toLowerCase().replace(/\s+/g, '-')}.pdf`;

      // Call API endpoint
      const response = await fetch('/api/export-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          html: generatedHTML,
          filename,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate PDF');
      }

      // Get PDF blob
      const pdfBlob = await response.blob();
      console.log('[PDF Export] PDF received, size:', pdfBlob.size, 'bytes');

      // Trigger download
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      console.log('[PDF Export] PDF download triggered successfully');
    } catch (error) {
      console.error('[PDF Export] Error:', error);
      alert(`PDF-generering misslyckades: ${error instanceof Error ? error.message : 'Okänt fel'}`);
    } finally {
      // Clear progress interval
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      setIsGeneratingPDF(false);
      setPdfProgress(0);
    }
  };

  const handlePreview = () => {
    if (!generatedHTML || !iframeRef.current) return;

    const iframe = iframeRef.current;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (doc) {
      doc.open();

      // Inject scaling wrapper and CSS
      // We use 'zoom' for better visual quality than transform: scale
      // We force scrollbars to prevent jitter/resize loops with Chart.js
      const scalingCSS = `
        <style>
          body {
            margin: 0;
            padding: 0;
            width: 100%;
            min-height: 100vh;
          }
          
          /* The wrapper that handles the scaling */
          #presentation-wrapper {
            width: 100%;
            min-height: 100vh;
            
            /* Default Preview Mode: Zoom 0.75 */
            zoom: 0.75;
          }

          /* Fullscreen Mode Override */
          body.is-fullscreen #presentation-wrapper {
            zoom: 1.25;
          }
          
          /* Ensure charts don't expand infinitely or shrink to zero */
          canvas {
            width: 100% !important;
            height: 100% !important;
            min-height: 300px; /* Prevent collapse to 0 height */
            max-width: 100% !important;
          }
          
          /* Container for charts to maintain aspect ratio/size */
          .chart-container {
            position: relative;
            width: 100%;
            height: 400px; /* Default height */
            overflow: hidden;
          }
        </style>
      `;

      // Wrap the content
      let htmlWithWrapper = generatedHTML;

      // Inject CSS before </head>
      if (htmlWithWrapper.includes('</head>')) {
        htmlWithWrapper = htmlWithWrapper.replace('</head>', scalingCSS + '</head>');
      } else {
        htmlWithWrapper = scalingCSS + htmlWithWrapper;
      }

      /* Script to force Chart.js resize on fullscreen toggle */
      const resizeScript = `
        <script>
          (function() {
            function forceChartResize() {
              if (window.Chart && window.Chart.instances) {
                Object.values(window.Chart.instances).forEach(chart => {
                  chart.resize();
                });
              }
            }

            // Resize on window resize
            window.addEventListener('resize', () => {
              clearTimeout(window.resizeTimer);
              window.resizeTimer = setTimeout(forceChartResize, 100);
            });

            // Resize on fullscreen toggle (body class change)
            const observer = new MutationObserver((mutations) => {
              mutations.forEach((mutation) => {
                if (mutation.attributeName === 'class') {
                  // Trigger resize immediately and after transition
                  forceChartResize();
                  setTimeout(forceChartResize, 300);
                }
              });
            });

            observer.observe(document.body, { attributes: true });
          })();
        </script>
      `;

      // Wrap body content in #presentation-wrapper and inject script
      if (htmlWithWrapper.includes('<body')) {
        htmlWithWrapper = htmlWithWrapper.replace(/<body([^>]*)>/i, '<body$1><div id="presentation-wrapper">');
        htmlWithWrapper = htmlWithWrapper.replace('</body>', '</div>' + resizeScript + '</body>');
      } else {
        htmlWithWrapper = `<div id="presentation-wrapper">${htmlWithWrapper}</div>${resizeScript}`;
      }

      doc.write(htmlWithWrapper);
      doc.close();
    }
  };

  // Auto-update preview when HTML changes
  useEffect(() => {
    if (generatedHTML && iframeRef.current) {
      handlePreview();

      // Extract slides for selection
      const extractedSlides = extractSlides(generatedHTML);
      setSlides(extractedSlides);
      // Reset selection when new presentation is generated
      setSelectedSlideIds([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatedHTML]);

  // Auto-scroll status updates to bottom when new updates arrive
  useEffect(() => {
    if (statusScrollRef.current) {
      statusScrollRef.current.scrollTop = statusScrollRef.current.scrollHeight;
    }
  }, [statusUpdates]);

  const handleFullscreen = () => {
    if (!iframeRef.current) return;

    const iframe = iframeRef.current;

    // Helper to toggle class on iframe body
    const toggleFullscreenClass = (isFullscreen: boolean) => {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc && doc.body) {
        if (isFullscreen) {
          doc.body.classList.add('is-fullscreen');
        } else {
          doc.body.classList.remove('is-fullscreen');
        }
      }
    };

    // Add event listener to detect fullscreen change
    const onFullscreenChange = () => {
      const isFullscreen = !!document.fullscreenElement ||
        !!(document as any).webkitFullscreenElement ||
        !!(document as any).msFullscreenElement;

      toggleFullscreenClass(isFullscreen);

      // Cleanup listener if we exited fullscreen
      if (!isFullscreen) {
        document.removeEventListener('fullscreenchange', onFullscreenChange);
        document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
        document.removeEventListener('mozfullscreenchange', onFullscreenChange);
        document.removeEventListener('MSFullscreenChange', onFullscreenChange);
      }
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    document.addEventListener('mozfullscreenchange', onFullscreenChange);
    document.addEventListener('MSFullscreenChange', onFullscreenChange);

    // Try to request fullscreen on the iframe
    if (iframe.requestFullscreen) {
      iframe.requestFullscreen();
    } else if ((iframe as any).webkitRequestFullscreen) {
      (iframe as any).webkitRequestFullscreen();
    } else if ((iframe as any).msRequestFullscreen) {
      (iframe as any).msRequestFullscreen();
    }
  };

  const handleDeleteSlides = () => {
    if (!generatedHTML || selectedSlideIds.length === 0) return;

    // Confirmation dialog
    const slideNums = selectedSlideIds.map(id => {
      const match = id.match(/\d+/);
      return match ? parseInt(match[0]) + 1 : '?';
    }).join(', ');

    const confirmed = window.confirm(
      `Är du säker på att du vill ta bort ${selectedSlideIds.length} slide${selectedSlideIds.length > 1 ? 's' : ''}?\n\nSlides: ${slideNums}\n\nDenna åtgärd kan inte ångras.`
    );

    if (!confirmed) return;

    try {
      // Delete selected slides
      let updatedHtml = deleteSlides(generatedHTML, selectedSlideIds);

      // Renumber remaining slides
      updatedHtml = renumberSlides(updatedHtml);

      // Update state
      setGeneratedHTML(updatedHtml);

      // Extract updated slides
      const updatedSlidesList = extractSlides(updatedHtml);
      setSlides(updatedSlidesList);

      // Clear selection
      setSelectedSlideIds([]);

      // Show success message
      alert(`${selectedSlideIds.length} slide${selectedSlideIds.length > 1 ? 's' : ''} har tagits bort.`);
    } catch (error) {
      console.error('Error deleting slides:', error);
      alert('Ett fel uppstod när slides skulle tas bort. Försök igen.');
    }
  };

  const handleTweak = async (messageContent: string) => {
    if (!messageContent.trim() || !presentationData || !generatedHTML) return;

    // Add user message to history
    const newMessages: Message[] = [
      ...messages,
      { role: 'user', content: messageContent, timestamp: Date.now() }
    ];
    setMessages(newMessages);
    setIsTweaking(true);
    setStatusUpdates([]);

    try {
      // Use different endpoint based on whether slides are selected
      const endpoint = selectedSlideIds.length > 0 ? '/api/tweak-slides' : '/api/tweak';
      console.log('[handleTweak] Using endpoint:', endpoint);
      console.log('[handleTweak] Selected slide IDs:', selectedSlideIds);
      console.log('[handleTweak] Messages count:', newMessages.length);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          presentationData,
          currentHtml: generatedHTML, // Send current HTML for slide extraction
          selectedSlideIds: selectedSlideIds.length > 0 ? selectedSlideIds : undefined,
          model: selectedModel,
        }),
      });

      console.log('[handleTweak] Response received:', response.status, response.ok);

      if (!response.ok) {
        throw new Error('Failed to tweak presentation');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader available');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Accumulate chunks
        buffer += decoder.decode(value, { stream: true });

        // Split by double newline to get complete SSE messages
        const messages = buffer.split('\n\n');

        // Keep the last incomplete message in the buffer
        buffer = messages.pop() || '';

        // Process each complete message
        for (const message of messages) {
          const lines = message.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6)) as StatusUpdate;
                setStatusUpdates((prev) => [...prev, data]);

                if (data.type === 'complete') {
                  // Decode Base64 HTML with proper UTF-8 handling
                  const htmlBase64 = (data as any).htmlBase64;
                  if (htmlBase64) {
                    try {
                      // Decode base64 to binary string
                      const binaryString = atob(htmlBase64);
                      // Convert binary string to Uint8Array
                      const bytes = new Uint8Array(binaryString.length);
                      for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                      }
                      // Decode UTF-8 bytes to string
                      const html = new TextDecoder('utf-8').decode(bytes);
                      setGeneratedHTML(html);
                      setPresentationTitle(data.title || presentationTitle);
                      if (data.presentationData) {
                        setPresentationData(data.presentationData);
                      }
                      if (data.toolCallsLogUrl) {
                        setToolCallsLogUrl(data.toolCallsLogUrl);
                      }
                      // Accumulate usage data and calculate total cost
                      if (data.usage) {
                        const usage = data.usage;
                        const newCost = calculateCost(
                          selectedModel,
                          usage.inputTokens,
                          usage.outputTokens
                        );
                        setUsageData(prev => ({
                          inputTokens: (prev?.inputTokens || 0) + usage.inputTokens,
                          outputTokens: (prev?.outputTokens || 0) + usage.outputTokens,
                          totalTokens: (prev?.totalTokens || 0) + usage.totalTokens,
                          cost: (prev?.cost || 0) + newCost
                        }));
                      }
                    } catch (decodeError) {
                      console.error('Failed to decode Base64 HTML:', decodeError);
                    }
                  }
                }
              } catch (e) {
                console.error('Error parsing SSE data:', e, 'Line:', line);
              }
            }
          }
        }
      }

      // Add assistant completion message
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Presentation updated successfully!', timestamp: Date.now() }
      ]);

    } catch (error) {
      console.error('Error:', error);
      setStatusUpdates((prev) => [
        ...prev,
        { type: 'error', message: 'Ett fel inträffade vid justering av presentation' },
      ]);
      // Add error message to chat
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Sorry, I encountered an error while updating the presentation.', timestamp: Date.now() }
      ]);
    } finally {
      setIsTweaking(false);
    }
  };

  return (
    <>
      {/* Falcon Spinner Overlay */}
      {isGenerating && <FalconSpinner />}

      <div className="h-[calc(100vh-4rem)] p-4 md:p-6 lg:p-8 transition-colors bg-gradient-to-br from-blue-50 via-white to-green-50 dark:from-slate-950 dark:via-[#050b18] dark:to-[#041022] overflow-hidden">
      <div className="max-w-[1800px] mx-auto h-full">
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-8 h-full">
          {/* Left Column: Input/Chat + Status */}
          <div className="xl:col-span-2 flex flex-col gap-6 h-full overflow-hidden">
            {/* Top-left: Prompt Input OR Chat Interface */}
            {!generatedHTML ? (
              /* STEP 1: Initial Prompt Input */
              <ShimmerContainer active={shouldHighlightPrompt}>
                <Card>
                  <CardHeader>
                    <CardTitle>Vad vill du skapa?</CardTitle>
                    <CardDescription>
                      Beskriv vilken presentation du vill generera
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Model Selector */}
                    <div className="flex gap-4">
                      {/* AI Model Selector */}
                      <div className="space-y-2 flex-1">
                        <label className="text-sm font-medium text-foreground/80 dark:text-foreground">
                          AI-modell
                        </label>
                        <Select
                          value={selectedModel}
                          onValueChange={setSelectedModel}
                          disabled={isGenerating || availableModels.length === 0}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Välj AI-modell" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableModels.map((model) => (
                              <SelectItem key={model.id} value={model.id}>
                                <div className="flex flex-col items-start">
                                  <span className="font-medium">{model.name}</span>
                                  <span className="text-xs text-muted-foreground">{model.description}</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Thinking Level Selector - only for Gemini 3 Pro Preview */}
                      {selectedModel === 'gemini-3-pro-preview' && (
                        <div className="space-y-2 flex-1">
                          <label className="text-sm font-medium text-foreground/80 dark:text-foreground flex items-center gap-2">
                            <Sparkles className="w-4 h-4" />
                            Thinking Mode
                          </label>
                          <Select
                            value={thinkingLevel}
                            onValueChange={(value) => setThinkingLevel(value as 'low' | 'high' | 'off')}
                            disabled={isGenerating}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Välj thinking level" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="off">
                                <div className="flex flex-col items-start">
                                  <span className="font-medium">Off</span>
                                  <span className="text-xs text-muted-foreground">Standard generation (no thinking)</span>
                                </div>
                              </SelectItem>
                              <SelectItem value="low">
                                <div className="flex flex-col items-start">
                                  <span className="font-medium">Low</span>
                                  <span className="text-xs text-muted-foreground">Basic reasoning steps</span>
                                </div>
                              </SelectItem>
                              <SelectItem value="high">
                                <div className="flex flex-col items-start">
                                  <span className="font-medium">High</span>
                                  <span className="text-xs text-muted-foreground">Detailed thought process</span>
                                </div>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>

                    <Textarea
                      placeholder="Exempel: Skapa en företagsrapport för Randek AB med senaste finansiella data och möteshistorik..."
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      rows={6}
                      className="resize-none"
                      disabled={isGenerating}
                    />

                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">Exempel på prompts:</p>
                      <div className="flex flex-wrap gap-2">
                        {examplePrompts.map((example, i) => (
                          <Button
                            key={i}
                            variant="outline"
                            size="sm"
                            onClick={() => setPrompt(example)}
                            disabled={isGenerating}
                            className="line-clamp-2"
                          >
                            {example}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <Button
                      onClick={handleGenerate}
                      disabled={isGenerating || !prompt.trim()}
                      className="w-full"
                      size="lg"
                    >
                      {isGenerating ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Genererar...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          Generera Presentation
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              </ShimmerContainer>
            ) : (
              /* STEP 2: Chat Interface (after generation) */
              <ShimmerContainer active={shouldHighlightTweakArea} radius="1.25rem">
                <Card>
                  <CardHeader>
                    <CardTitle>Justera Presentation</CardTitle>
                    <CardDescription>
                      Beskriv ändringar du vill göra i presentationen
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ChatInterface
                      messages={messages}
                      onSendMessage={handleTweak}
                      isTweaking={isTweaking}
                      disabled={!generatedHTML}
                      selectedSlideIds={selectedSlideIds}
                      onClearSelection={() => setSelectedSlideIds([])}
                    />
                  </CardContent>
                </Card>
              </ShimmerContainer>
            )}

            {/* Status Updates */}
            {statusUpdates.length > 0 && (
              <ShimmerContainer active={shouldHighlightStatus} wrapperClassName="flex-1 min-h-0 flex flex-col" className="h-full">
                <Card className="h-full flex flex-col">
                  <CardHeader>
                    <CardTitle>Status</CardTitle>
                    <CardDescription>
                      {availableModels.find(m => m.id === selectedModel)?.name || 'AI-modellen'} arbetar med din presentation
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-hidden p-0">
                    <div ref={statusScrollRef} className="h-full overflow-y-auto p-6 space-y-3">
                      {statusUpdates.map((update, i) => (
                        <div key={i} className="flex items-start gap-3">
                          {update.type === 'status' && (
                            <Badge variant="secondary">Status</Badge>
                          )}
                          {update.type === 'tool' && (
                            <Badge className="bg-blue-500">Verktyg</Badge>
                          )}
                          {update.type === 'thinking' && (
                            <Badge className="bg-purple-500">Tänker</Badge>
                          )}
                          {update.type === 'complete' && (
                            <Badge className="bg-green-500">Klar</Badge>
                          )}
                          {update.type === 'error' && (
                            <Badge variant="destructive">Fel</Badge>
                          )}
                          <p className="text-sm text-foreground/80 flex-1">{update.message}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </ShimmerContainer>
            )}
          </div>

          {/* Right Column: Preview */}
          <div className="xl:col-span-3 h-full overflow-hidden">
            <ShimmerContainer active={shouldHighlightPreview} radius="1.75rem" className="h-full">
              <Card className="h-full flex flex-col">
                <CardHeader className="shrink-0">
                  <CardTitle>Förhandsvisning</CardTitle>
                  <CardDescription>
                    {generatedHTML ? (
                      <>
                        <div>{presentationTitle} ({statusUpdates.find((u) => u.type === 'complete')?.slideCount || 0} slides)</div>
                        {usageData && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {usageData.inputTokens.toLocaleString()} in · {usageData.outputTokens.toLocaleString()} out · {usageData.totalTokens.toLocaleString()} total{usageData.cost !== undefined ? ` · ${formatCost(usageData.cost)}` : ''}
                          </div>
                        )}
                      </>
                    ) : (
                      'Din presentation kommer att visas här'
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 flex-1 overflow-y-auto min-h-0">
                  {generatedHTML ? (
                    <>
                      <div className="flex gap-2">
                        <Button onClick={handleFullscreen} variant="outline" className="flex-1">
                          <Maximize2 className="w-4 h-4" />
                          Fullscreen
                        </Button>
                        <Button onClick={handleDownload} variant="outline" className="flex-1">
                          <Download className="w-4 h-4" />
                          HTML
                        </Button>
                        <Button
                          onClick={handleDownloadPDF}
                          className="flex-1 relative overflow-hidden hover:bg-primary/70"
                          disabled={isGeneratingPDF}
                          style={isGeneratingPDF ? {
                            background: `linear-gradient(to right, #16a34a ${pdfProgress}%, #1f2937 ${pdfProgress}%)`,
                            transition: 'background 0.1s linear'
                          } : undefined}
                        >
                          <span className="relative z-10 flex items-center gap-2">
                            {isGeneratingPDF ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Genererar PDF... {pdfProgress}%
                              </>
                            ) : (
                              <>
                                <Download className="w-4 h-4" />
                                Ladda ner PDF
                              </>
                            )}
                          </span>
                        </Button>
                      </div>
                      {/* 
                    {toolCallsLogUrl && (
                      <div className="mt-2">
                        <Button
                          onClick={() => window.open(toolCallsLogUrl, '_blank')}
                          variant="outline"
                          size="sm"
                          className="w-full"
                        >
                          <FileJson className="w-4 h-4" />
                          Visa Tool Calls Log (JSON)
                        </Button>
                        <p className="text-xs text-gray-500 mt-1 text-center">
                          Verifiera vilken data Claude faktiskt hämtade från CRM/databaser
                        </p>
                      </div>
                    )} */}

                      <div className="w-full aspect-[16/9] border-2 border-border/40 dark:border-border/60 rounded-lg overflow-hidden bg-card shadow-2xl transition-colors">
                        <iframe
                          ref={iframeRef}
                          className="w-full h-full"
                          title="Presentation Preview"
                          style={{ transform: 'scale(1)', transformOrigin: 'top left' }}
                        />
                      </div>

                      {/* Slide Selector */}
                      {slides.length > 0 && (
                        <div className="mt-6 pt-6 border-t border-border/40">
                          <SlideSelector
                            slides={slides}
                            fullHtml={generatedHTML}
                            selectedSlideIds={selectedSlideIds}
                            onSelectionChange={setSelectedSlideIds}
                            onModifySelected={() => {
                              // Focus chat input when modify is clicked
                              // The selected slides are already shown in the chat interface
                              const chatInput = document.querySelector('textarea[placeholder*="Beskriv"]') as HTMLTextAreaElement;
                              if (chatInput) {
                                chatInput.focus();
                                chatInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              }
                            }}
                            onDeleteSelected={handleDeleteSlides}
                          />
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center justify-center w-full aspect-[16/9] border-2 border-dashed border-border/40 dark:border-border/60 rounded-lg transition-colors">
                      <div className="text-center text-muted-foreground">
                        <Sparkles className="w-16 h-16 mx-auto mb-4 opacity-50" />
                        <p className="text-lg">Väntar på generering...</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </ShimmerContainer>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
