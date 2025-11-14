'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Download, Eye, Sparkles } from 'lucide-react';

type StatusUpdate = {
  type: 'status' | 'tool' | 'thinking' | 'error' | 'complete';
  message?: string;
  html?: string;
  title?: string;
  slideCount?: number;
};

export default function PresentationGenerator() {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusUpdates, setStatusUpdates] = useState<StatusUpdate[]>([]);
  const [generatedHTML, setGeneratedHTML] = useState<string | null>(null);
  const [presentationTitle, setPresentationTitle] = useState<string>('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const examplePrompts = [
    'Skapa en företagsrapport för Randek AB',
    'KPI-översikt för Falkenberg Q4 2024',
    'Analys av matproduktion i Halland',
  ];

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setIsGenerating(true);
    setStatusUpdates([]);
    setGeneratedHTML(null);
    setPresentationTitle('');

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

              if (data.type === 'complete' && data.html) {
                setGeneratedHTML(data.html);
                setPresentationTitle(data.title || 'Presentation');
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Sparkles className="w-10 h-10 text-blue-600" />
            <h1 className="text-5xl font-bold text-gray-900">Presentation Generator</h1>
          </div>
          <p className="text-xl text-gray-600">
            Skapa datadrivna presentationer med AI och företagsdata
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column: Input */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Vad vill du skapa?</CardTitle>
                <CardDescription>
                  Beskriv vilken presentation du vill generera
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
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

            {/* Status Updates */}
            {statusUpdates.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Status</CardTitle>
                  <CardDescription>Claude arbetar med din presentation</CardDescription>
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
            )}
          </div>

          {/* Right Column: Preview */}
          <div>
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
                      <Button onClick={handleDownload} className="flex-1">
                        <Download className="w-4 h-4" />
                        Ladda ner HTML
                      </Button>
                    </div>

                    <div className="border-2 border-gray-200 rounded-lg overflow-hidden bg-white">
                      <iframe
                        ref={iframeRef}
                        className="w-full h-[600px]"
                        title="Presentation Preview"
                      />
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center h-[600px] border-2 border-dashed border-gray-300 rounded-lg">
                    <div className="text-center text-gray-500">
                      <Sparkles className="w-16 h-16 mx-auto mb-4 opacity-50" />
                      <p className="text-lg">Väntar på generering...</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
