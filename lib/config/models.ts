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
 * Get default model for any provider
 */
export function getDefaultModel(): string {
  // Prefer Gemini if available, otherwise Claude
  const geminiModels = getAvailableGeminiModels();
  if (geminiModels.length > 0) {
    return geminiModels[0];
  }
  return getDefaultClaudeModel();
}
