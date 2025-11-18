
'use client';

import { useState, useEffect } from 'react';
import PresentationGenerator from '@/components/presentation-generator';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sparkles, Loader2 } from 'lucide-react';

export default function Home() {
  const [modalIsOpen, setModalIsOpen] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [initialPrompt, setInitialPrompt] = useState('');
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const handleGenerate = () => {
    if (!prompt.trim()) return;
    setInitialPrompt(prompt);
    setIsGenerating(true);
    setModalIsOpen(false);
  };

  const examplePrompts = [
    'Skapa en företagsrapport för Randek AB',
    'KPI-översikt för Falkenberg Q4 2024',
    'Gör en presentation med finansiell data från vår databas och kontakter och möten från crm-systemet om företaget:',
  ];

  if (!isClient) {
    return null;
  }

  return (
    <div>
      <Modal isOpen={modalIsOpen} onClose={() => setModalIsOpen(false)}>
        <Card className="w-[600px]">
          <CardHeader>
            <div className="flex items-center gap-3 mb-2">
              <Sparkles className="w-8 h-8 text-gray-600" />
              <h1 className="text-4xl font-bold text-gray-900">
                Presentation Generator
              </h1>
            </div>
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
      </Modal>
      {initialPrompt && <PresentationGenerator initialPrompt={initialPrompt} />}
    </div>
  );
}
