
'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Download, Eye, Sparkles, Maximize2, User } from 'lucide-react';

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

type PresentationGeneratorProps = {
  initialPrompt: string;
};

export default function PresentationGenerator({ initialPrompt }: PresentationGeneratorProps) {
  const [isGenerating, setIsGenerating] = useState(true);
  const [statusUpdates, setStatusUpdates] = useState<StatusUpdate[]>([]);
  const [generatedHTML, setGeneratedHTML] = useState<string | null>(null);
  const [presentationTitle, setPresentationTitle] = useState<string>('');
  const [presentationData, setPresentationData] = useState<{ title: string; sections: string[] } | null>(null);
  const [tweakPrompt, setTweakPrompt] = useState('');
  const [isTweaking, setIsTweaking] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const exampleTweakPrompts = [
    'Byt ut till bokslut 2024 istället för 2023',
    'Lägg till en slide med finansiell jämförelse mot föregående år',
    'Gör texten större och mer lättläst',
  ];

  const shouldHighlightStatus = isGenerating || isTweaking;
  const shouldHighlightPreview = isTweaking;
  const shouldHighlightTweakArea = isTweaking;

  const handleGenerate = async (prompt: string) => {
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
        body: JSON.stringify({ prompt }),
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
                let html = data.html;
                if (!html && (data as any).htmlBase64) {
                  try {
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

  useEffect(() => {
    if (initialPrompt) {
      handleGenerate(initialPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

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

  useEffect(() => {
    if (generatedHTML && iframeRef.current) {
      handlePreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatedHTML]);

  const handleFullscreen = () => {
    if (!iframeRef.current) return;
    const iframe = iframeRef.current;
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tweakPrompt, presentationData }),
      });
      if (!response.ok) throw new Error('Failed to tweak presentation');
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
                const htmlBase64 = (data as any).htmlBase64;
                if (htmlBase64) {
                  try {
                    const binaryString = atob(htmlBase64);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                      bytes[i] = binaryString.charCodeAt(i);
                    }
                    const html = new TextDecoder('utf-8').decode(bytes);
                    setGeneratedHTML(html);
                    setPresentationTitle(data.title || presentationTitle);
                    if (data.presentationData) {
                      setPresentationData(data.presentationData);
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
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-8">
          <div className="xl:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="w-5 h-5" />
                  Din förfrågan
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700">{initialPrompt}</p>
              </CardContent>
            </Card>

            {(isGenerating || statusUpdates.length > 0) && (
              <Card>
                <CardHeader>
                  <CardTitle>Status</CardTitle>
                  <CardDescription>Claude arbetar med din presentation</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {isGenerating && statusUpdates.length === 0 && (
                      <div className="flex items-center gap-3">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <p className="text-sm text-gray-700">Startar generering...</p>
                      </div>
                    )}
                    {statusUpdates.map((update, i) => (
                      <div key={i} className="flex items-start gap-3">
                        {update.type === 'status' && <Badge variant="secondary">Status</Badge>}
                        {update.type === 'tool' && <Badge className="bg-blue-500">Verktyg</Badge>}
                        {update.type === 'thinking' && <Badge className="bg-purple-500">Tänker</Badge>}
                        {update.type === 'complete' && <Badge className="bg-green-500">Klar</Badge>}
                        {update.type === 'error' && <Badge variant="destructive">Fel</Badge>}
                        <p className="text-sm text-gray-700 flex-1">{update.message}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="xl:col-span-3">
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
                        <Eye className="w-4 h-4" /> Visa
                      </Button>
                      <Button onClick={handleFullscreen} variant="outline" className="flex-1">
                        <Maximize2 className="w-4 h-4" /> Fullscreen
                      </Button>
                      <Button onClick={handleDownload} className="flex-1">
                        <Download className="w-4 h-4" /> Ladda ner HTML
                      </Button>
                    </div>
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
                      {isGenerating ? (
                        <>
                          <Loader2 className="w-16 h-16 mx-auto mb-4 opacity-50 animate-spin" />
                          <p className="text-lg">Genererar presentation...</p>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-16 h-16 mx-auto mb-4 opacity-50" />
                          <p className="text-lg">Väntar på generering...</p>
                        </>
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-6">
                  <div className="pt-6 border-t border-gray-200">
                    <h3 className={`text-lg font-semibold mb-2 ${!generatedHTML ? 'text-gray-400' : 'text-gray-900'}`}>
                      Justera Presentation
                    </h3>
                    <div className="space-y-2">
                      <Textarea
                        placeholder={generatedHTML ? "Exempel: Lägg till en slide med finansiell jämförelse mot föregående år..." : "Väntar på presentation..."}
                        value={tweakPrompt}
                        onChange={(e) => setTweakPrompt(e.target.value)}
                        rows={3}
                        className="resize-none"
                        disabled={!generatedHTML || isTweaking}
                      />
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
                      <Button
                        onClick={handleTweak}
                        disabled={!generatedHTML || isTweaking || !tweakPrompt.trim()}
                        className="w-full"
                        size="lg"
                      >
                        {isTweaking ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" /> Justerar...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4" /> Justera Presentation
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
