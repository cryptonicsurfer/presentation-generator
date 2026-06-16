/**
 * Central model configuration
 * Reads from environment variables to get available models and defaults
 */

/**
 * Get available Claude models from environment
 */
export function getAvailableClaudeModels(): string[] {
  return (process.env.CLAUDE_MODELS || '').split(',').filter(Boolean).map(m => m.trim());
}

/**
 * Get available Gemini models from environment
 */
export function getAvailableGeminiModels(): string[] {
  return (process.env.GEMINI_MODELS || '').split(',').filter(Boolean).map(m => m.trim());
}

/**
 * Get available Mistral models from environment
 */
export function getAvailableMistralModels(): string[] {
  return (process.env.MISTRAL_MODELS || '').split(',').filter(Boolean).map(m => m.trim());
}

/**
 * Get default Mistral model (first in the list)
 */
export function getDefaultMistralModel(): string {
  const models = getAvailableMistralModels();
  return models[0] || 'mistral-medium-3.5';
}

/**
 * Get default Claude model (first in the list)
 */
export function getDefaultClaudeModel(): string {
  const models = getAvailableClaudeModels();
  return models[0] || 'claude-sonnet-4-5-20250929';
}

/**
 * Get default Gemini model (first in the list)
 */
export function getDefaultGeminiModel(): string {
  const models = getAvailableGeminiModels();
  return models[0] || 'gemini-flash-latest';
}

/**
 * Get default model for any provider.
 * Prefer Mistral (EU, reliable while Google's tier is flaky), then Gemini,
 * then Claude. The frontend dropdown order mirrors this.
 */
export function getDefaultModel(): string {
  const mistralModels = getAvailableMistralModels();
  if (mistralModels.length > 0) {
    return mistralModels[0];
  }
  const geminiModels = getAvailableGeminiModels();
  if (geminiModels.length > 0) {
    return geminiModels[0];
  }
  return getDefaultClaudeModel();
}
