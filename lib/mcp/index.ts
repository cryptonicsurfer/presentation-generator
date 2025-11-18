import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import {
  queryFbgAnalyticsTool,
} from './postgres-tools';
import {
  searchDirectusCompaniesTool,
  analyzeDirectusMeetingsTool,
  getDirectusContactsTool,
} from './directus-tools';

/**
 * Create the MCP server with all database and CRM tools
 */
export function createDataAccessMcpServer() {
  return createSdkMcpServer({
    name: 'fbg-data-access',
    version: '1.0.0',
    tools: [
      // PostgreSQL tool
      queryFbgAnalyticsTool,
      // Directus CRM tools
      searchDirectusCompaniesTool,
      analyzeDirectusMeetingsTool,  // Upgraded: was countDirectusMeetingsTool
      getDirectusContactsTool,
    ],
  });
}

// Export individual tools for testing
export * from './postgres-tools';
export * from './directus-tools';
