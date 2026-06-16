import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export type ModelInfo = {
  id: string;
  name: string;
  provider: 'claude' | 'gemini' | 'mistral';
  description: string;
};

export async function GET() {
  try {
    const claudeModels = (process.env.CLAUDE_MODELS || '').split(',').filter(Boolean);
    const geminiModels = (process.env.GEMINI_MODELS || '').split(',').filter(Boolean);
    const mistralModels = (process.env.MISTRAL_MODELS || '').split(',').filter(Boolean);

    const models: ModelInfo[] = [];

    // Map Mistral models first → first entry is the default selection
    for (const modelId of mistralModels) {
      const info = getMistralModelInfo(modelId.trim());
      if (info) models.push(info);
    }

    // Map Gemini models
    for (const modelId of geminiModels) {
      const info = getGeminiModelInfo(modelId.trim());
      if (info) models.push(info);
    }

    // Map Claude models
    for (const modelId of claudeModels) {
      const info = getClaudeModelInfo(modelId.trim());
      if (info) models.push(info);
    }

    return NextResponse.json({ models });
  } catch (error) {
    console.error('Error fetching models:', error);
    return NextResponse.json({ error: 'Failed to fetch models' }, { status: 500 });
  }
}

function getClaudeModelInfo(modelId: string): ModelInfo | null {
  const modelMap: Record<string, { name: string; description: string }> = {
    'claude-sonnet-4-5-20250929': {
      name: 'Claude Sonnet 4.5',
      description: 'Bästa balans mellan kvalitet och hastighet'
    },
    'claude-haiku-4-5-20251001': {
      name: 'Claude Haiku 4.5',
      description: 'Snabbast och billigast från Claude'
    }
  };

  const info = modelMap[modelId];
  if (!info) return null;

  return {
    id: modelId,
    name: info.name,
    provider: 'claude',
    description: info.description
  };
}

function getMistralModelInfo(modelId: string): ModelInfo | null {
  const modelMap: Record<string, { name: string; description: string }> = {
    'mistral-medium-3.5': {
      name: 'Mistral Medium 3.5',
      description: 'EU-modell, pålitlig verktygsanrop (Recommended)'
    },
    'mistral-large-latest': {
      name: 'Mistral Large',
      description: 'Större Mistral-modell'
    },
    'mistral-small-latest': {
      name: 'Mistral Small',
      description: 'Snabbast och billigast från Mistral'
    },
  };

  const info = modelMap[modelId];
  if (!info) return null;

  return {
    id: modelId,
    name: info.name,
    provider: 'mistral',
    description: info.description
  };
}

function getGeminiModelInfo(modelId: string): ModelInfo | null {
  const modelMap: Record<string, { name: string; description: string }> = {
    'gemini-3-flash-preview': {
      name: 'Gemini 3.0 Flash Preview',
      description: 'Snabb och kostnadseffektiv (Recommended)'
    },
    'gemini-2.5-flash': {
      name: 'Gemini 2.5 Flash',
      description: 'Snabbast och billigast'
    },
    'gemini-2.5-pro': {
      name: 'Gemini 2.5 Pro',
      description: 'Mer avancerad resonemang'
    },
    'gemini-3-pro-preview': {
      name: 'Gemini 3.0 Pro Preview',
      description: 'Mest kraftfull men långsammare'
    },
    // Legacy naming (deprecated)
    'gemini-flash-latest': {
      name: 'Gemini Flash (Legacy)',
      description: 'Gammalt namn - använd gemini-2.5-flash'
    }
  };

  const info = modelMap[modelId];
  if (!info) return null;

  return {
    id: modelId,
    name: info.name,
    provider: 'gemini',
    description: info.description
  };
}
