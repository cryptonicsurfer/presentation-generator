'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Download, Eye, Sparkles, Maximize2, FileJson, Moon, Sun } from 'lucide-react';

type StatusUpdate = {
  type: 'status' | 'tool' | 'thinking' | 'error' | 'complete';
  message?: string;
  html?: string;
  title?: string;
  slideCount?: number;
  toolCallsLogUrl?: string;
  presentationData?: {
    title: string;
    sections: string[];
  };
};

type ShimmerContainerProps = {
  active?: boolean;
  radius?: string;
  className?: string;
  children: ReactNode;
};

function ShimmerContainer({ active, radius = '1.5rem', className, children }: ShimmerContainerProps) {
  if (!active) {
    if (className) {
      return <div className={className}>{children}</div>;
    }
    return <>{children}</>;
  }

  return (
    <div className="shimmer-border-wrapper" style={{ '--shimmer-radius': radius, padding: '3px' } as CSSProperties}>
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
  const [backend, setBackend] = useState<'claude' | 'gemini'>('gemini');
  const [darkMode, setDarkMode] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusUpdates, setStatusUpdates] = useState<StatusUpdate[]>([]);
  const [generatedHTML, setGeneratedHTML] = useState<string | null>(null);
  const [presentationTitle, setPresentationTitle] = useState<string>('');
  const [presentationData, setPresentationData] = useState<{ title: string; sections: string[] } | null>(null);
  const [tweakPrompt, setTweakPrompt] = useState('');
  const [isTweaking, setIsTweaking] = useState(false);
  const [toolCallsLogUrl, setToolCallsLogUrl] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

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

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setIsGenerating(true);
    setStatusUpdates([]);
    setGeneratedHTML(null);
    setPresentationTitle('');
    setPresentationData(null);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt, backend }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate presentation');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader available');

      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

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
                }
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e);
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

  const handlePreview = () => {
    if (!generatedHTML || !iframeRef.current) return;

    const iframe = iframeRef.current;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(generatedHTML);
      doc.close();
    }
  };

  // Auto-update preview when HTML changes
  useEffect(() => {
    if (generatedHTML && iframeRef.current) {
      handlePreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatedHTML]);

  // Dark mode toggle
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const handleFullscreen = () => {
    if (!iframeRef.current) return;

    const iframe = iframeRef.current;

    // Try to request fullscreen on the iframe
    if (iframe.requestFullscreen) {
      iframe.requestFullscreen();
    } else if ((iframe as any).webkitRequestFullscreen) {
      (iframe as any).webkitRequestFullscreen();
    } else if ((iframe as any).msRequestFullscreen) {
      (iframe as any).msRequestFullscreen();
    }
  };

  const handleTweak = async () => {
    if (!tweakPrompt.trim() || !presentationData) return;

    setIsTweaking(true);
    setStatusUpdates([]);

    try {
      const response = await fetch('/api/tweak', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tweakPrompt,
          presentationData,
          backend,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to tweak presentation');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader available');

      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

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
                  } catch (decodeError) {
                    console.error('Failed to decode Base64 HTML:', decodeError);
                  }
                }
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error:', error);
      setStatusUpdates((prev) => [
        ...prev,
        { type: 'error', message: 'Ett fel inträffade vid justering av presentation' },
      ]);
    } finally {
      setIsTweaking(false);
      setTweakPrompt('');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 p-8">
      <div className="max-w-[1800px] mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-3 mb-2 relative">
            <Sparkles className="w-10 h-10 text-gray-600" />
            <h1 className="text-5xl font-bold text-gray-900">Presentation Generator</h1>

            {/* Dark Mode Toggle - Positioned absolutely to the right */}
            <Button
              variant="outline"
              size="icon"
              onClick={() => setDarkMode(!darkMode)}
              className="absolute right-0"
              title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {darkMode ? (
                <Sun className="w-5 h-5" />
              ) : (
                <Moon className="w-5 h-5" />
              )}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-5 gap-8">
          {/* Left Column: Input */}
          <div className="xl:col-span-2 space-y-6">
            <ShimmerContainer active={shouldHighlightPrompt}>
            <Card>
              <CardHeader>
                <CardTitle>Vad vill du skapa?</CardTitle>
                <CardDescription>
                  Beskriv vilken presentation du vill generera
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Backend Selector */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">
                    AI-modell
                  </label>
                  <Select
                    value={backend}
                    onValueChange={(value) => setBackend(value as 'claude' | 'gemini')}
                    disabled={isGenerating}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Välj AI-modell" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gemini">
                        <div className="flex flex-col items-start">
                          <span className="font-medium">Gemini 2.5 Flash</span>
                          <span className="text-xs text-gray-500">Snabbare, billigare</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="claude">
                        <div className="flex flex-col items-start">
                          <span className="font-medium">Claude Sonnet 4.5</span>
                          <span className="text-xs text-gray-500">Mer pålitlig, bättre resonemang</span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
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
                  <p className="text-sm text-gray-600">Exempel på prompts:</p>
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

            {/* Status Updates */}
            {statusUpdates.length > 0 && (
              <ShimmerContainer active={shouldHighlightStatus}>
              <Card>
                <CardHeader>
                  <CardTitle>Status</CardTitle>
                  <CardDescription>
                    {backend === 'claude' ? 'Claude Sonnet 4.5' : 'Gemini 2.5 Flash'} arbetar med din presentation
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 max-h-96 overflow-y-auto">
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
                        <p className="text-sm text-gray-700 flex-1">{update.message}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
              </ShimmerContainer>
            )}
          </div>

          {/* Right Column: Preview */}
          <div className="xl:col-span-3">
            <ShimmerContainer active={shouldHighlightPreview} radius="1.75rem">
            <Card className="h-full">
              <CardHeader>
                <CardTitle>Förhandsvisning</CardTitle>
                <CardDescription>
                  {generatedHTML
                    ? `${presentationTitle} (${statusUpdates.find((u) => u.type === 'complete')?.slideCount || 0} slides)`
                    : 'Din presentation kommer att visas här'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {generatedHTML ? (
                  <>
                    <div className="flex gap-2">
                      <Button onClick={handlePreview} variant="outline" className="flex-1">
                        <Eye className="w-4 h-4" />
                        Visa
                      </Button>
                      <Button onClick={handleFullscreen} variant="outline" className="flex-1">
                        <Maximize2 className="w-4 h-4" />
                        Fullscreen
                      </Button>
                      <Button onClick={handleDownload} className="flex-1">
                        <Download className="w-4 h-4" />
                        Ladda ner HTML
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

                    <div className="w-full aspect-[16/9] border-2 border-gray-200 rounded-lg overflow-hidden bg-white shadow-2xl">
                      <iframe
                        ref={iframeRef}
                        className="w-full h-full"
                        title="Presentation Preview"
                        style={{ transform: 'scale(1)', transformOrigin: 'top left' }}
                      />
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center w-full aspect-[16/9] border-2 border-dashed border-gray-300 rounded-lg">
                    <div className="text-center text-gray-500">
                      <Sparkles className="w-16 h-16 mx-auto mb-4 opacity-50" />
                      <p className="text-lg">Väntar på generering...</p>
                    </div>
                  </div>
                )}

                {/* Tweak Presentation - Always visible, disabled until presentation is ready */}
                <div className="mt-6">
                  <ShimmerContainer active={shouldHighlightTweakArea} radius="1.25rem">
                  <div className="pt-6 border-t border-gray-200">
                  <h3 className={`text-lg font-semibold mb-2 ${!generatedHTML ? 'text-gray-400' : 'text-gray-900'}`}>
                    Justera Presentation (efter generering är gjord)
                  </h3>
                  {/* <p className={`text-sm mb-4 ${!generatedHTML ? 'text-gray-400' : 'text-gray-600'}`}>
                    Beskriv ändringar du vill göra (använder diff editing för snabbare resultat)
                  </p> */}

                  <div className="space-y-2">
                    <Textarea
                      placeholder={generatedHTML ? "Exempel: Lägg till en slide med finansiell jämförelse mot föregående år..." : "Väntar på presentation..."}
                      value={tweakPrompt}
                      onChange={(e) => setTweakPrompt(e.target.value)}
                      rows={3}
                      className="resize-none"
                      disabled={!generatedHTML || isTweaking}
                    />

                    <div className="space-y-2">
                      {/* <p className={`text-sm ${!generatedHTML ? 'text-gray-400' : 'text-gray-600'}`}>
                        Exempel på justeringar:
                      </p> */}
                      <div className="flex flex-wrap gap-2">
                        {exampleTweakPrompts.map((example, i) => (
                          <Button
                            key={i}
                            variant="outline"
                            size="sm"
                            onClick={() => setTweakPrompt(example)}
                            disabled={!generatedHTML || isTweaking}
                          >
                            {example}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <Button
                      onClick={handleTweak}
                      disabled={!generatedHTML || isTweaking || !tweakPrompt.trim()}
                      className="w-full"
                      size="lg"
                    >
                      {isTweaking ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Justerar...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          Justera Presentation
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                  </ShimmerContainer>
                </div>
              </CardContent>
            </Card>
            </ShimmerContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
