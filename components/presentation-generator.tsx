'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Download, Eye, Maximize2, FileJson, Sparkles, Upload, X, FileText } from 'lucide-react';
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

// Presentation mode types
type PresentationMode = 'company' | 'yearplan' | null;

export default function PresentationGenerator() {
  const [mode, setMode] = useState<PresentationMode>(null);
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
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const statusScrollRef = useRef<HTMLDivElement>(null);

  // Mode-specific example prompts
  const companyExamplePrompts = [
    'Skapa en företagsrapport för Randek AB',
    'KPI-översikt för Falkenberg Q4 2024',
    'Gör en presentation med finansiell data från vår databas och kontakter och möten från crm-systemet om företaget:',
  ];

  const yearplanExamplePrompts = [
    'Skapa en presentation för verksamhetsplanen H1 2026',
    'Visa alla aktiviteter för Q2 2026',
    'Sammanfatta statusen på alla planerade aktiviteter 2026',
    'Vilka aktiviteter är beslutade men inte genomförda?',
  ];

  const examplePrompts = mode === 'yearplan' ? yearplanExamplePrompts : companyExamplePrompts;

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

    // Choose endpoint based on mode
    const endpoint = mode === 'yearplan' ? '/api/generate-yearplan' : '/api/generate';

    try {
      let response: Response;

      // Use FormData for yearplan mode with file, otherwise JSON
      if (mode === 'yearplan' && uploadedFile) {
        const formData = new FormData();
        formData.append('prompt', prompt);
        formData.append('file', uploadedFile);

        response = await fetch(endpoint, {
          method: 'POST',
          body: formData,
        });
      } else {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt,
            // Only send model for company mode
            ...(mode === 'company' && { model: selectedModel }),
            ...(mode === 'company' && thinkingLevel !== 'off' && { thinkingLevel }),
          }),
        });
      }

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
      console.log('[PresentationGenerator] Extracted slides:', extractedSlides.map(s => ({ id: s.id, index: s.index, title: s.title?.substring(0, 30) })));
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
              /* STEP 1: Mode Selection or Prompt Input */
              <ShimmerContainer active={shouldHighlightPrompt}>
                <Card>
                  {!mode ? (
                    /* MODE SELECTION */
                    <>
                      <CardHeader>
                        <CardTitle>Vad vill du skapa?</CardTitle>
                        <CardDescription>
                          Välj typ av presentation
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 gap-4">
                          {/* Company Presentation Button */}
                          <button
                            onClick={() => setMode('company')}
                            className="group relative flex flex-col items-start p-6 rounded-xl border-2 border-border/50 hover:border-[#1f4e99] hover:bg-[#1f4e99]/5 transition-all duration-200"
                          >
                            <div className="flex items-center gap-3 mb-2">
                              <div className="p-2 rounded-lg bg-[#1f4e99]/10 text-[#1f4e99]">
                                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                </svg>
                              </div>
                              <span className="text-xl font-semibold text-foreground">Företagspresentation</span>
                            </div>
                            <p className="text-sm text-muted-foreground text-left">
                              Skapa rapporter om företag med finansiell data, CRM-information och möteshistorik
                            </p>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              <Badge variant="secondary" className="text-xs">Finansdata</Badge>
                              <Badge variant="secondary" className="text-xs">CRM</Badge>
                              <Badge variant="secondary" className="text-xs">Bokslut</Badge>
                            </div>
                          </button>

                          {/* Year Plan Presentation Button */}
                          <button
                            onClick={() => setMode('yearplan')}
                            className="group relative flex flex-col items-start p-6 rounded-xl border-2 border-border/50 hover:border-[#52ae32] hover:bg-[#52ae32]/5 transition-all duration-200"
                          >
                            <div className="flex items-center gap-3 mb-2">
                              <div className="p-2 rounded-lg bg-[#52ae32]/10 text-[#52ae32]">
                                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                              </div>
                              <span className="text-xl font-semibold text-foreground">Verksamhetsplan</span>
                            </div>
                            <p className="text-sm text-muted-foreground text-left">
                              Visualisera verksamhetsplanen med aktiviteter, tidslinjer och statusöversikter
                            </p>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              <Badge variant="secondary" className="text-xs">Aktiviteter</Badge>
                              <Badge variant="secondary" className="text-xs">Tidslinje</Badge>
                              <Badge variant="secondary" className="text-xs">Fokusområden</Badge>
                            </div>
                          </button>
                        </div>
                      </CardContent>
                    </>
                  ) : (
                    /* PROMPT INPUT (after mode is selected) */
                    <>
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <div>
                            <CardTitle className="flex items-center gap-2">
                              {mode === 'company' ? (
                                <>
                                  <div className="p-1.5 rounded-md bg-[#1f4e99]/10 text-[#1f4e99]">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                    </svg>
                                  </div>
                                  Företagspresentation
                                </>
                              ) : (
                                <>
                                  <div className="p-1.5 rounded-md bg-[#52ae32]/10 text-[#52ae32]">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                  </div>
                                  Verksamhetsplan
                                </>
                              )}
                            </CardTitle>
                            <CardDescription>
                              {mode === 'company'
                                ? 'Beskriv vilken företagsrapport du vill generera'
                                : 'Beskriv vilken verksamhetsplan du vill visualisera'
                              }
                            </CardDescription>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => { setMode(null); setPrompt(''); setUploadedFile(null); }}
                            disabled={isGenerating}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            ← Tillbaka
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <Textarea
                          placeholder={mode === 'company'
                            ? "Exempel: Skapa en företagsrapport för Randek AB med senaste finansiella data och möteshistorik..."
                            : "Exempel: Skapa en presentation för verksamhetsplanen H1 2026..."
                          }
                          value={prompt}
                          onChange={(e) => setPrompt(e.target.value)}
                          rows={6}
                          className="resize-none"
                          disabled={isGenerating}
                        />

                        {/* File Upload for Year Plan mode */}
                        {mode === 'yearplan' && (
                          <div className="space-y-2">
                            <p className="text-sm text-muted-foreground">
                              Ladda upp verksamhetsplan (valfritt):
                            </p>
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept=".pdf,.docx,.doc"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  // Validate file size (10MB max)
                                  if (file.size > 10 * 1024 * 1024) {
                                    alert('Filen är för stor. Max storlek är 10 MB.');
                                    return;
                                  }
                                  setUploadedFile(file);
                                }
                              }}
                              className="hidden"
                              disabled={isGenerating}
                            />

                            {uploadedFile ? (
                              <div className="flex items-center gap-3 p-3 bg-[#52ae32]/10 border border-[#52ae32]/30 rounded-lg">
                                <FileText className="w-5 h-5 text-[#52ae32]" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">{uploadedFile.name}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {(uploadedFile.size / 1024).toFixed(0)} KB
                                  </p>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setUploadedFile(null);
                                    if (fileInputRef.current) {
                                      fileInputRef.current.value = '';
                                    }
                                  }}
                                  disabled={isGenerating}
                                  className="shrink-0"
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                              </div>
                            ) : (
                              <div
                                onClick={() => !isGenerating && fileInputRef.current?.click()}
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  setIsDragOver(true);
                                }}
                                onDragLeave={() => setIsDragOver(false)}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  setIsDragOver(false);
                                  const file = e.dataTransfer.files[0];
                                  if (file) {
                                    const ext = file.name.toLowerCase().split('.').pop();
                                    if (!['pdf', 'docx', 'doc'].includes(ext || '')) {
                                      alert('Endast PDF och DOCX-filer stöds.');
                                      return;
                                    }
                                    if (file.size > 10 * 1024 * 1024) {
                                      alert('Filen är för stor. Max storlek är 10 MB.');
                                      return;
                                    }
                                    setUploadedFile(file);
                                  }
                                }}
                                className={`
                                  flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-lg cursor-pointer transition-colors
                                  ${isDragOver
                                    ? 'border-[#52ae32] bg-[#52ae32]/10'
                                    : 'border-border/50 hover:border-[#52ae32]/50 hover:bg-[#52ae32]/5'
                                  }
                                  ${isGenerating ? 'opacity-50 cursor-not-allowed' : ''}
                                `}
                              >
                                <Upload className="w-6 h-6 text-muted-foreground mb-2" />
                                <p className="text-sm text-muted-foreground text-center">
                                  Dra och släpp eller klicka för att välja fil
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  PDF, DOCX (max 10 MB)
                                </p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Model selector for company mode */}
                        {mode === 'company' && availableModels.length > 0 && (
                          <div className="space-y-2">
                            <label className="text-sm text-muted-foreground">Välj AI-modell:</label>
                            <Select value={selectedModel} onValueChange={setSelectedModel} disabled={isGenerating}>
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Välj modell" />
                              </SelectTrigger>
                              <SelectContent>
                                {availableModels.map((model) => (
                                  <SelectItem key={model.id} value={model.id}>
                                    <div className="flex flex-col">
                                      <span>{model.name}</span>
                                      <span className="text-xs text-muted-foreground">{model.description}</span>
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}

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
                                className="line-clamp-2 text-left h-auto py-2"
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
                          style={{
                            backgroundColor: mode === 'yearplan' ? '#52ae32' : undefined,
                          }}
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
                    </>
                  )}
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
