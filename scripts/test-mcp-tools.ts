/**
 * Test script to inspect MCP tool definitions
 * This shows exactly what schemas Claude receives from our MCP tools
 */

import { createDataAccessMcpServer } from '../lib/mcp';

async function testMcpTools() {
  console.log('🔍 Testing MCP Tool Schemas\n');
  console.log('Creating MCP server...\n');

  const mcpServer = createDataAccessMcpServer();

  console.log('✅ MCP Server created:', mcpServer.type, mcpServer.name);
  console.log('\n📋 Inspecting MCP Server instance...\n');

  // Access the internal tools registry
  const server = mcpServer.instance;

  // @ts-ignore - accessing private property for testing
  const registeredTools = server._registeredTools;

  if (!registeredTools) {
    console.error('❌ Could not access registered tools');
    return;
  }

  console.log(`Found ${Object.keys(registeredTools).length} tools:\n`);

  // Inspect each tool
  for (const [toolName, toolDef] of Object.entries(registeredTools)) {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Tool: ${toolName}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    const tool = toolDef as any;

    console.log('Description:', tool.description);
    console.log('\nInput Schema (Zod):');

    if (tool.inputSchema) {
      try {
        // Inspect the Zod schema shape
        const shape = tool.inputSchema._def?.shape?.();

        console.log('\n📝 Schema Parameters:');
        if (shape) {
          for (const [key, value] of Object.entries(shape)) {
            const zodType = value as any;
            const typeName = zodType._def?.typeName || 'unknown';
            const description = zodType._def?.description;
            const isOptional = zodType.isOptional?.() || zodType._def?.typeName === 'ZodOptional';

            console.log(`\n  Parameter: ${key}`);
            console.log(`    Type: ${typeName}`);
            console.log(`    Description: ${description || '❌ MISSING'}`);
            console.log(`    Optional: ${isOptional}`);

            // For optional types, check inner type
            if (zodType._def?.innerType) {
              const innerType = zodType._def.innerType;
              console.log(`    Inner type description: ${innerType._def?.description || '❌ MISSING'}`);
            }
          }
        } else {
          console.log('  ❌ Could not extract shape');
        }

      } catch (error) {
        console.error('❌ Error inspecting schema:', error);
      }
    } else {
      console.log('  (No input schema)');
    }

    console.log('\n');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('✅ Test complete!\n');
}

testMcpTools().catch(console.error);
