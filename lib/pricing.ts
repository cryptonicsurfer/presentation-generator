/**
 * Price calculator for AI model usage
 * Prices are in USD per 1M tokens
 */

export type ModelPricing = {
  inputPer1M: number;
  outputPer1M: number;
};

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Claude models
  'claude-sonnet-4-5-20250929': {
    inputPer1M: 3.00,
    outputPer1M: 15.00,
  },
  'claude-haiku-4-5-20251001': {
    inputPer1M: 1.00,
    outputPer1M: 5.00,
  },

  // Gemini models
  'gemini-2.5-flash': {
    inputPer1M: 0.30,
    outputPer1M: 2.50,
  },
  'gemini-2.5-pro': {
    inputPer1M: 1.25,
    outputPer1M: 10.00,
  },
  'gemini-3-pro-preview': {
    inputPer1M: 2.00, // Tiered: $2 (<200k), $4 (>200k)
    outputPer1M: 12.00, // Tiered: $12 (<200k), $18 (>200k)
  },
  // Legacy naming (deprecated)
  'gemini-flash-latest': {
    inputPer1M: 0.30,
    outputPer1M: 2.50,
  },
};

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    console.warn(`No pricing found for model: ${model}`);
    return 0;
  }

  // Handle tiered pricing for Gemini 3 Pro Preview
  if (model === 'gemini-3-pro-preview') {
    const totalTokens = inputTokens + outputTokens;
    if (totalTokens > 200_000) {
      // High tier: $4 input, $18 output per 1M tokens
      const inputCost = (inputTokens / 1_000_000) * 4.00;
      const outputCost = (outputTokens / 1_000_000) * 18.00;
      return inputCost + outputCost;
    }
    // Low tier: $2 input, $12 output per 1M tokens
    const inputCost = (inputTokens / 1_000_000) * 2.00;
    const outputCost = (outputTokens / 1_000_000) * 12.00;
    return inputCost + outputCost;
  }

  // Standard pricing for other models
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;

  return inputCost + outputCost;
}

export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
}
